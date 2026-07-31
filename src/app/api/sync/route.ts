// POST /api/sync — the one endpoint (Architecture.md §6). Push and pull in a single
// round trip: the request carries a bounded, FIFO batch from the client's outbox plus a
// cursor per table; the response says which of those changes are durable and hands back
// everything newer than the cursors.
//
// Route handlers under `src/app/api/**` are the only place that may import
// `db/server/**` (D33, D42). `src/sync/**` runs on the client and reaches Postgres
// exclusively through here — never Drizzle directly. The merge rules themselves are
// **not** in this file: they live in `sync/merge.ts`, which both sides import, so the
// server cannot quietly disagree with the client about who wins.
//
// ---------------------------------------------------------------------------
// TIME (D53) — the encoding this file turns on
// ---------------------------------------------------------------------------
// `IsoDateTime` is naive local wall-clock: "YYYY-MM-DDTHH:mm:ss", no Z, no offset.
// Postgres columns are `timestamptz`. Those two only round-trip if the naive string is
// **stored as though it were UTC** and read back the same way — `new Date(s + "Z")` in,
// `.toISOString().slice(0, 19)` out. Do not "fix" this to use the server's local zone:
// the point is that the string the client sent is the string the client gets back, byte
// for byte, and that Postgres's `<` on the column agrees with the client's `<` on the
// string. Vercel runs UTC, so the two happen to coincide today; this does not depend on
// that.
//
// `server_updated_at` is the exception and is a real instant on the server clock. It is
// the pull cursor, it is opaque to the client, and it is never an `IsoDateTime`.
//
// ---------------------------------------------------------------------------
// USER SCOPE
// ---------------------------------------------------------------------------
// v1 is single-user (Architecture.md §5): one `users` row, id `LOCAL_USER_ID` (D58).
// Tables carrying `user_id` are filtered on it; `stages`, `session_logs` and
// `checkpoints` do not carry one (they hang off `goals` / `stages`) and are read
// unscoped. When auth lands those three need a join, which is additive.

import { NextResponse } from "next/server";
import { and, eq, gt, gte, inArray, lt, type AnyColumn, type SQL } from "drizzle-orm";

import type { IsoDate, IsoDateTime, Weekday } from "@/core/types";
import { db } from "@/db/server/client";
import {
  checkIns,
  checkpoints,
  dayparts,
  goals,
  planSlots,
  planWeeks,
  pushSubscriptions,
  sessionLogs,
  stages,
  users,
} from "@/db/server/schema";
import { LOCAL_USER_ID } from "@/db/ids";
import { planWeekLineage, shouldApplyWeek } from "@/sync/merge";
import { SYNC_KEY_HEADER } from "@/sync/transport";
import {
  PULLED_TABLES,
  emptyPulledRows,
  type PulledRows,
  type PulledTable,
  type RejectedChange,
  type SyncChange,
  type SyncCursors,
  type SyncRequest,
  type SyncResponse,
  type WirePlanSlot,
  type WirePlanWeekBundle,
} from "@/sync/protocol";

const DEFAULT_PULL_LIMIT = 200;
const MAX_PULL_LIMIT = 500;
const MAX_CHANGES_PER_REQUEST = 200;

/**
 * How far the returned cursor is rewound from the newest row actually sent.
 *
 * `server_updated_at` is stamped when a statement is built, not when its transaction
 * commits, so two writes can commit out of order: stamp t=100 commits at t=105 while
 * stamp t=102 commits at t=103, and a pull in between would advance past t=100 and
 * never see it again. A one-second overlap covers that window. Re-delivery is free
 * because every apply path is idempotent — LWW ties change nothing and append-only
 * rows are insert-if-absent.
 */
const CURSOR_OVERLAP_MS = 1_000;

// ---------------------------------------------------------------------------
// Timestamp encoding — see the header
// ---------------------------------------------------------------------------

const toDb = (iso: IsoDateTime): Date => new Date(`${iso}Z`);
const toDbOrNull = (iso: IsoDateTime | null): Date | null =>
  iso === null ? null : toDb(iso);

const fromDb = (value: Date): IsoDateTime => value.toISOString().slice(0, 19);
const fromDbOrNull = (value: Date | null): IsoDateTime | null =>
  value === null ? null : fromDb(value);

/** Cursors are round-tripped as full ISO instants, `Z` and all — not `IsoDateTime`. */
const cursorOf = (value: Date): string => value.toISOString();
const parseCursor = (value: string | undefined): Date =>
  value ? new Date(value) : new Date(0);

// ---------------------------------------------------------------------------
// Request validation
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseRequest(body: unknown): SyncRequest | null {
  if (!isRecord(body)) return null;
  if (!Array.isArray(body.changes)) return null;
  if (body.since !== undefined && !isRecord(body.since)) return null;

  for (const change of body.changes) {
    if (!isRecord(change)) return null;
    if (typeof change.seq !== "number") return null;
    if (typeof change.table !== "string") return null;
    if (change.op !== "put" && change.op !== "delete") return null;
    if (typeof change.rowId !== "string") return null;
    if (typeof change.queuedAt !== "string") return null;
  }

  return {
    changes: (body.changes as SyncChange[]).slice(0, MAX_CHANGES_PER_REQUEST),
    since: (body.since ?? {}) as SyncCursors,
    historyFloor: typeof body.historyFloor === "string" ? body.historyFloor : null,
    limit: typeof body.limit === "number" ? body.limit : undefined,
  };
}

// ---------------------------------------------------------------------------
// Push — apply one change
// ---------------------------------------------------------------------------

/**
 * `users` holds one row in v1 and nothing else seeds it server-side (auth is deferred).
 * Same resolve-or-create as `api/push/subscribe`, and the same reason it is safe: the
 * id is deterministic (D58), so whichever side writes first, both converge on one row.
 */
async function ensureUser(): Promise<string> {
  await db.insert(users).values({ id: LOCAL_USER_ID }).onConflictDoNothing();
  return LOCAL_USER_ID;
}

/**
 * LWW guard for a conditional upsert: only overwrite if the incoming row is newer.
 *
 * Deliberately in the `ON CONFLICT ... WHERE` clause rather than read-compare-write in
 * JS. One statement, no race, and a row that loses is simply not written — which also
 * leaves its `server_updated_at` alone, so losing does not spuriously re-broadcast it
 * to every other device.
 *
 * **`lt(column, date)`, never ``sql`${column} < ${date}` ``.** This is not style. A raw
 * `sql` template interpolates its value as a bare parameter with no knowledge of the
 * column it is being compared against, so a JS `Date` never reaches the `timestamptz`
 * encoder and postgres.js rejects the whole statement with *"The `string` argument must
 * be of type string ... Received an instance of Date"*. `lt` binds the value **to the
 * column**, which is what applies the mapper.
 *
 * That bug shipped, and its blast radius is the reason this comment is long: every
 * mutable table upserts through here, so *every* `users`, `dayparts`, `goals`, `stages`
 * and `pushSubscriptions` push was refused, on every device, from the first sync. The
 * plan and the append-only tables do not use this guard and synced fine, which made it
 * look like a data problem rather than one broken helper. Nothing in `tests/sync/**`
 * could see it: the suite runs against a scripted transport, and the SQL is only wrong
 * once a real driver tries to encode it.
 */
const newerThanStored = (column: AnyColumn, updatedAt: IsoDateTime): SQL =>
  lt(column, toDb(updatedAt));

async function applyChange(change: SyncChange, userId: string): Promise<void> {
  const now = new Date();
  const payload = change.payload as Record<string, unknown>;

  // A tombstone (D48 soft-delete). Nothing enqueues one today — every lifecycle
  // change is a state field — but `OutboxOp` allows it, and a change the server
  // silently ignores would sit in the outbox forever. `queuedAt` is the client's
  // wall-clock at enqueue, which is exactly the `updatedAt` the delete would have
  // carried.
  if (change.op === "delete") {
    await applyDelete(change, now);
    return;
  }

  switch (change.table) {
    case "users": {
      const row = payload as { id: string; email: string | null; updatedAt: IsoDateTime };
      // No `deleted_at` column on `users` — the one row is never deleted.
      await db
        .insert(users)
        .values({
          id: row.id,
          email: row.email,
          updatedAt: toDb(row.updatedAt),
          serverUpdatedAt: now,
        })
        .onConflictDoUpdate({
          target: users.id,
          set: { email: row.email, updatedAt: toDb(row.updatedAt), serverUpdatedAt: now },
          setWhere: newerThanStored(users.updatedAt, row.updatedAt),
        });
      return;
    }

    case "dayparts": {
      const row = payload as {
        id: string;
        name: string;
        startTime: string;
        endTime: string;
        activeCap: number;
        sortOrder: number;
        updatedAt: IsoDateTime;
        deletedAt: IsoDateTime | null;
      };
      const set = {
        name: row.name,
        startTime: row.startTime,
        endTime: row.endTime,
        activeCap: row.activeCap,
        sortOrder: row.sortOrder,
        updatedAt: toDb(row.updatedAt),
        deletedAt: toDbOrNull(row.deletedAt),
        serverUpdatedAt: now,
      };
      await db
        .insert(dayparts)
        .values({ id: row.id, userId, ...set })
        .onConflictDoUpdate({
          target: dayparts.id,
          set,
          setWhere: newerThanStored(dayparts.updatedAt, row.updatedAt),
        });
      return;
    }

    case "goals": {
      const row = payload as {
        id: string;
        name: string;
        purpose: string;
        tier: number;
        state: "planned" | "active" | "dropped";
        updatedAt: IsoDateTime;
        deletedAt: IsoDateTime | null;
      };
      const set = {
        name: row.name,
        purpose: row.purpose,
        tier: row.tier,
        state: row.state,
        updatedAt: toDb(row.updatedAt),
        deletedAt: toDbOrNull(row.deletedAt),
        serverUpdatedAt: now,
      };
      await db
        .insert(goals)
        .values({ id: row.id, userId, ...set })
        .onConflictDoUpdate({
          target: goals.id,
          set,
          setWhere: newerThanStored(goals.updatedAt, row.updatedAt),
        });
      return;
    }

    case "stages": {
      const row = payload as {
        id: string;
        goalId: string;
        sessionMinutes: number;
        cadenceType: "frequency" | "fixed_days" | "hybrid";
        cadenceCount: number;
        cadenceDays: Weekday[] | null;
        eligibleDayparts: string[];
        maxPerWeek: number | null;
        minRestDays: number | null;
        scopeUnitLabel: string | null;
        scopeUnitTotal: number | null;
        targetDate: IsoDate | null;
        deadlineDerived: boolean;
        sortOrder: number;
        state: "pending" | "active" | "done";
        updatedAt: IsoDateTime;
        deletedAt: IsoDateTime | null;
      };
      const set = {
        goalId: row.goalId,
        sessionMinutes: row.sessionMinutes,
        cadenceType: row.cadenceType,
        cadenceCount: row.cadenceCount,
        cadenceDays: row.cadenceDays,
        eligibleDayparts: row.eligibleDayparts,
        maxPerWeek: row.maxPerWeek,
        minRestDays: row.minRestDays,
        scopeUnitLabel: row.scopeUnitLabel,
        scopeUnitTotal: row.scopeUnitTotal,
        targetDate: row.targetDate,
        deadlineDerived: row.deadlineDerived,
        sortOrder: row.sortOrder,
        state: row.state,
        updatedAt: toDb(row.updatedAt),
        deletedAt: toDbOrNull(row.deletedAt),
        serverUpdatedAt: now,
      };
      await db
        .insert(stages)
        .values({ id: row.id, ...set })
        .onConflictDoUpdate({
          target: stages.id,
          set,
          setWhere: newerThanStored(stages.updatedAt, row.updatedAt),
        });
      return;
    }

    // Upserts on `id`, but the table also has a unique `endpoint`. Two devices can
    // only collide there if they both author a row for the same browser endpoint under
    // different ids, which cannot happen today: nothing writes `pushSubscriptions`
    // locally — `api/push/subscribe` writes it server-side and pull brings it down.
    // If a local write path is ever added, it must reuse the server's id or this
    // becomes a permanently rejected row. Reported.
    case "pushSubscriptions": {
      const row = payload as {
        id: string;
        endpoint: string;
        p256dh: string;
        auth: string;
        deviceLabel: string | null;
        updatedAt: IsoDateTime;
        deletedAt: IsoDateTime | null;
      };
      const set = {
        endpoint: row.endpoint,
        p256dh: row.p256dh,
        auth: row.auth,
        deviceLabel: row.deviceLabel,
        updatedAt: toDb(row.updatedAt),
        deletedAt: toDbOrNull(row.deletedAt),
        serverUpdatedAt: now,
      };
      await db
        .insert(pushSubscriptions)
        .values({ id: row.id, userId, ...set })
        .onConflictDoUpdate({
          target: pushSubscriptions.id,
          set,
          setWhere: newerThanStored(pushSubscriptions.updatedAt, row.updatedAt),
        });
      return;
    }

    // --- append-only: union. Insert if absent, never overwrite (D32, merge.ts) ---

    case "sessionLogs": {
      const row = payload as {
        id: string;
        stageId: string;
        date: IsoDate;
        daypartId: string;
        minutes: number;
        status: "done" | "skipped";
        source: "planned" | "voluntary";
        loggedAt: IsoDateTime;
      };
      await db
        .insert(sessionLogs)
        .values({
          id: row.id,
          stageId: row.stageId,
          date: row.date,
          daypartId: row.daypartId,
          minutes: row.minutes,
          status: row.status,
          source: row.source,
          loggedAt: toDb(row.loggedAt),
          serverUpdatedAt: now,
        })
        .onConflictDoNothing();
      return;
    }

    case "checkpoints": {
      const row = payload as {
        id: string;
        stageId: string;
        value: number;
        loggedAt: IsoDateTime;
      };
      await db
        .insert(checkpoints)
        .values({
          id: row.id,
          stageId: row.stageId,
          value: row.value,
          loggedAt: toDb(row.loggedAt),
          serverUpdatedAt: now,
        })
        .onConflictDoNothing();
      return;
    }

    case "checkIns": {
      const row = payload as {
        id: string;
        daypartId: string;
        availableMinutes: number;
        date: IsoDate;
        checkedInAt: IsoDateTime;
      };
      await db
        .insert(checkIns)
        .values({
          id: row.id,
          userId,
          daypartId: row.daypartId,
          availableMinutes: row.availableMinutes,
          date: row.date,
          checkedInAt: toDb(row.checkedInAt),
          serverUpdatedAt: now,
        })
        .onConflictDoNothing();
      return;
    }

    // --- the plan: one week, wholesale, or nothing (D45) ---

    case "planWeeks":
      await applyPlanWeek(payload as unknown as WirePlanWeekBundle, userId, now);
      return;

    case "planSlots":
      // Unreachable by design. `planner.relayoutWeek` queues exactly one `planWeeks`
      // row carrying `{ week, slots }`; a bare slot row means something bypassed it,
      // and applying it would be the per-slot interleaving D45 forbids. Refused
      // loudly rather than merged.
      throw new Error(
        "plan slots never sync individually — the week is the unit (D45).",
      );

    default: {
      const exhaustive: never = change.table;
      throw new Error(`unknown table ${String(exhaustive)}`);
    }
  }
}

/**
 * Replace a week and every one of its slots, or leave both untouched. The read of the
 * stored week, the merge decision and the swap share one transaction so a concurrent
 * push cannot land between them.
 *
 * `shouldApplyWeek` is `sync/merge.ts` — the same function the client's pull calls, on
 * the same three keys (`updatedAt`, then `version`, then slot-id lineage). Two devices
 * asking "does this week win?" therefore always get the same answer.
 */
async function applyPlanWeek(
  bundle: WirePlanWeekBundle,
  userId: string,
  now: Date,
): Promise<void> {
  const { week, slots } = bundle;
  if (!week || typeof week.id !== "string") throw new Error("malformed plan week payload");

  await db.transaction(async (tx) => {
    const stored = await tx
      .select()
      .from(planWeeks)
      .where(eq(planWeeks.id, week.id))
      .for("update");

    if (stored.length > 0) {
      const storedSlots = await tx
        .select({ id: planSlots.id })
        .from(planSlots)
        .where(eq(planSlots.planWeekId, stored[0].id));

      const localRank = {
        updatedAt: fromDb(stored[0].updatedAt),
        version: stored[0].version,
        lineage: planWeekLineage(storedSlots),
      };
      const incomingRank = {
        updatedAt: week.updatedAt,
        version: week.version,
        lineage: planWeekLineage(slots ?? []),
      };
      if (!shouldApplyWeek(localRank, incomingRank)) return;
    }

    await tx
      .insert(planWeeks)
      .values({
        id: week.id,
        userId,
        weekStart: week.weekStart,
        version: week.version,
        updatedAt: toDb(week.updatedAt),
        serverUpdatedAt: now,
      })
      .onConflictDoUpdate({
        target: planWeeks.id,
        set: {
          weekStart: week.weekStart,
          version: week.version,
          updatedAt: toDb(week.updatedAt),
          serverUpdatedAt: now,
        },
      });

    // Wholesale: the old slots go, whatever they were. Not a diff.
    await tx.delete(planSlots).where(eq(planSlots.planWeekId, week.id));
    if (slots && slots.length > 0) {
      await tx.insert(planSlots).values(
        slots.map((slot) => ({
          id: slot.id,
          planWeekId: week.id,
          stageId: slot.stageId,
          date: slot.date,
          daypartId: slot.daypartId,
          minutes: slot.minutes,
        })),
      );
    }
  });
}

// Same `lt`-not-`sql` rule as `newerThanStored`, and for the same reason — see there.
// These four are unreachable today (nothing enqueues a delete), which is exactly why
// they are worth getting right now: an unreachable path carrying a known-fatal bug
// fails on the day someone makes it reachable, and looks like their change broke it.
async function applyDelete(change: SyncChange, now: Date): Promise<void> {
  const at = toDb(change.queuedAt);
  switch (change.table) {
    case "dayparts":
      await db
        .update(dayparts)
        .set({ deletedAt: at, updatedAt: at, serverUpdatedAt: now })
        .where(and(eq(dayparts.id, change.rowId), lt(dayparts.updatedAt, at)));
      return;
    case "goals":
      await db
        .update(goals)
        .set({ deletedAt: at, updatedAt: at, serverUpdatedAt: now })
        .where(and(eq(goals.id, change.rowId), lt(goals.updatedAt, at)));
      return;
    case "stages":
      await db
        .update(stages)
        .set({ deletedAt: at, updatedAt: at, serverUpdatedAt: now })
        .where(and(eq(stages.id, change.rowId), lt(stages.updatedAt, at)));
      return;
    case "pushSubscriptions":
      await db
        .update(pushSubscriptions)
        .set({ deletedAt: at, updatedAt: at, serverUpdatedAt: now })
        .where(
          and(
            eq(pushSubscriptions.id, change.rowId),
            lt(pushSubscriptions.updatedAt, at),
          ),
        );
      return;
    default:
      // `users` has no tombstone (one row, never deleted); append-only rows are facts
      // and the plan is replaced wholesale, never deleted piecemeal. Acked so the row
      // leaves the outbox rather than blocking it.
      return;
  }
}

// ---------------------------------------------------------------------------
// Pull
// ---------------------------------------------------------------------------

/**
 * A page of one table, plus the cursor to resume from.
 *
 * `limit + 1` is fetched to learn `hasMore` without a second count. The cursor is the
 * newest row **actually returned**, rewound by `CURSOR_OVERLAP_MS` and clamped so it
 * can never move backwards — an unclamped rewind past the caller's own cursor would
 * re-send the same page forever.
 */
function page<T extends { serverUpdatedAt: Date }>(
  rows: T[],
  limit: number,
  since: Date,
): { rows: T[]; cursor: string; hasMore: boolean } {
  const hasMore = rows.length > limit;
  const sent = hasMore ? rows.slice(0, limit) : rows;

  let newest = since;
  let cursor = since;
  for (const row of sent) {
    if (row.serverUpdatedAt > newest) newest = row.serverUpdatedAt;
    const rewound = new Date(row.serverUpdatedAt.getTime() - CURSOR_OVERLAP_MS);
    if (rewound > cursor) cursor = rewound;
  }

  // The rewind is a safety margin, but it must never cost forward progress. If a full
  // page's rows all sit inside the overlap window, the rewound cursor lands back at
  // `since`, the identical page is returned on every sync, and anything past position
  // `limit` in that window is never delivered at all — silently. When there is more to
  // come and the rewind has bought nothing, take the un-rewound newest instead:
  // re-delivery is cheap, a wedged cursor is not.
  if (hasMore && cursor <= since) cursor = newest;

  return { rows: sent, cursor: cursorOf(cursor), hasMore };
}

async function pull(
  since: SyncCursors,
  limit: number,
  historyFloor: IsoDate | null,
  userId: string,
): Promise<{ rows: PulledRows; cursors: SyncCursors; hasMore: boolean }> {
  const rows = emptyPulledRows();
  const cursors: SyncCursors = {};
  let hasMore = false;

  const record = (table: PulledTable, result: { cursor: string; hasMore: boolean }) => {
    cursors[table] = result.cursor;
    hasMore = hasMore || result.hasMore;
  };

  // --- users ---
  {
    const at = parseCursor(since.users);
    const raw = await db
      .select()
      .from(users)
      .where(and(eq(users.id, userId), gt(users.serverUpdatedAt, at)))
      .orderBy(users.serverUpdatedAt)
      .limit(limit + 1);
    const result = page(raw, limit, at);
    rows.users = result.rows.map((row) => ({
      id: row.id,
      email: row.email,
      updatedAt: fromDb(row.updatedAt),
      deletedAt: null,
    }));
    record("users", result);
  }

  // --- dayparts ---
  {
    const at = parseCursor(since.dayparts);
    const raw = await db
      .select()
      .from(dayparts)
      .where(and(eq(dayparts.userId, userId), gt(dayparts.serverUpdatedAt, at)))
      .orderBy(dayparts.serverUpdatedAt)
      .limit(limit + 1);
    const result = page(raw, limit, at);
    rows.dayparts = result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      startTime: row.startTime,
      endTime: row.endTime,
      activeCap: row.activeCap,
      sortOrder: row.sortOrder,
      updatedAt: fromDb(row.updatedAt),
      deletedAt: fromDbOrNull(row.deletedAt),
    }));
    record("dayparts", result);
  }

  // --- goals ---
  {
    const at = parseCursor(since.goals);
    const raw = await db
      .select()
      .from(goals)
      .where(and(eq(goals.userId, userId), gt(goals.serverUpdatedAt, at)))
      .orderBy(goals.serverUpdatedAt)
      .limit(limit + 1);
    const result = page(raw, limit, at);
    rows.goals = result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      purpose: row.purpose,
      tier: row.tier,
      state: row.state,
      updatedAt: fromDb(row.updatedAt),
      deletedAt: fromDbOrNull(row.deletedAt),
    }));
    record("goals", result);
  }

  // --- stages (no user_id — hangs off goals; see the header) ---
  {
    const at = parseCursor(since.stages);
    const raw = await db
      .select()
      .from(stages)
      .where(gt(stages.serverUpdatedAt, at))
      .orderBy(stages.serverUpdatedAt)
      .limit(limit + 1);
    const result = page(raw, limit, at);
    rows.stages = result.rows.map((row) => ({
      id: row.id,
      goalId: row.goalId,
      sessionMinutes: row.sessionMinutes,
      cadenceType: row.cadenceType,
      cadenceCount: row.cadenceCount,
      cadenceDays: row.cadenceDays,
      eligibleDayparts: row.eligibleDayparts,
      maxPerWeek: row.maxPerWeek,
      minRestDays: row.minRestDays,
      scopeUnitLabel: row.scopeUnitLabel,
      scopeUnitTotal: row.scopeUnitTotal,
      targetDate: row.targetDate,
      deadlineDerived: row.deadlineDerived,
      sortOrder: row.sortOrder,
      state: row.state,
      updatedAt: fromDb(row.updatedAt),
      deletedAt: fromDbOrNull(row.deletedAt),
    }));
    record("stages", result);
  }

  // --- session logs (floored: the device keeps a bounded window, D47/D48) ---
  {
    const at = parseCursor(since.sessionLogs);
    const raw = await db
      .select()
      .from(sessionLogs)
      .where(
        historyFloor
          ? and(gt(sessionLogs.serverUpdatedAt, at), gte(sessionLogs.date, historyFloor))
          : gt(sessionLogs.serverUpdatedAt, at),
      )
      .orderBy(sessionLogs.serverUpdatedAt)
      .limit(limit + 1);
    const result = page(raw, limit, at);
    rows.sessionLogs = result.rows.map((row) => ({
      id: row.id,
      stageId: row.stageId,
      date: row.date,
      daypartId: row.daypartId,
      minutes: row.minutes,
      status: row.status,
      source: row.source,
      loggedAt: fromDb(row.loggedAt),
    }));
    record("sessionLogs", result);
  }

  // --- checkpoints (never floored — `pruneHistoryBefore` does not touch them) ---
  {
    const at = parseCursor(since.checkpoints);
    const raw = await db
      .select()
      .from(checkpoints)
      .where(gt(checkpoints.serverUpdatedAt, at))
      .orderBy(checkpoints.serverUpdatedAt)
      .limit(limit + 1);
    const result = page(raw, limit, at);
    rows.checkpoints = result.rows.map((row) => ({
      id: row.id,
      stageId: row.stageId,
      value: row.value,
      loggedAt: fromDb(row.loggedAt),
    }));
    record("checkpoints", result);
  }

  // --- check-ins (floored, same as session logs) ---
  {
    const at = parseCursor(since.checkIns);
    const raw = await db
      .select()
      .from(checkIns)
      .where(
        historyFloor
          ? and(
              eq(checkIns.userId, userId),
              gt(checkIns.serverUpdatedAt, at),
              gte(checkIns.date, historyFloor),
            )
          : and(eq(checkIns.userId, userId), gt(checkIns.serverUpdatedAt, at)),
      )
      .orderBy(checkIns.serverUpdatedAt)
      .limit(limit + 1);
    const result = page(raw, limit, at);
    rows.checkIns = result.rows.map((row) => ({
      id: row.id,
      daypartId: row.daypartId,
      availableMinutes: row.availableMinutes,
      date: row.date,
      checkedInAt: fromDb(row.checkedInAt),
    }));
    record("checkIns", result);
  }

  // --- push subscriptions ---
  {
    const at = parseCursor(since.pushSubscriptions);
    const raw = await db
      .select()
      .from(pushSubscriptions)
      .where(
        and(eq(pushSubscriptions.userId, userId), gt(pushSubscriptions.serverUpdatedAt, at)),
      )
      .orderBy(pushSubscriptions.serverUpdatedAt)
      .limit(limit + 1);
    const result = page(raw, limit, at);
    rows.pushSubscriptions = result.rows.map((row) => ({
      id: row.id,
      endpoint: row.endpoint,
      p256dh: row.p256dh,
      auth: row.auth,
      deviceLabel: row.deviceLabel,
      updatedAt: fromDb(row.updatedAt),
      deletedAt: fromDbOrNull(row.deletedAt),
    }));
    record("pushSubscriptions", result);
  }

  // --- the plan: weeks page on their own cursor and carry their slots down with them.
  //     `plan_slots` has no cursor column at all, which is D45 in the schema (§5.2).
  {
    const at = parseCursor(since.planWeeks);
    const raw = await db
      .select()
      .from(planWeeks)
      .where(and(eq(planWeeks.userId, userId), gt(planWeeks.serverUpdatedAt, at)))
      .orderBy(planWeeks.serverUpdatedAt)
      .limit(limit + 1);
    const result = page(raw, limit, at);

    const weekIds = result.rows.map((week) => week.id);
    const slotRows =
      weekIds.length === 0
        ? []
        : await db.select().from(planSlots).where(inArray(planSlots.planWeekId, weekIds));

    const byWeek = new Map<string, WirePlanSlot[]>(weekIds.map((id) => [id, []]));
    const weekStartOf = new Map(result.rows.map((week) => [week.id, week.weekStart]));
    for (const slot of slotRows) {
      byWeek.get(slot.planWeekId)?.push({
        id: slot.id,
        stageId: slot.stageId,
        // `weekStart` lives on `plan_weeks`, not on the slot (Postgres side), but
        // `PlanSlot` carries it and the local mirror indexes on it. Restored from the
        // week the slot came down with — never guessed.
        weekStart: weekStartOf.get(slot.planWeekId)!,
        date: slot.date,
        daypartId: slot.daypartId,
        minutes: slot.minutes,
        planWeekId: slot.planWeekId,
      });
    }

    rows.planWeeks = result.rows.map(
      (week): WirePlanWeekBundle => ({
        week: {
          id: week.id,
          weekStart: week.weekStart,
          version: week.version,
          updatedAt: fromDb(week.updatedAt),
        },
        slots: byWeek.get(week.id) ?? [],
      }),
    );
    record("planWeeks", result);
  }

  // Any table the caller had no cursor for and that returned nothing still needs one
  // back, or it re-scans from zero on every sync.
  for (const table of PULLED_TABLES) {
    cursors[table] ??= since[table] ?? cursorOf(new Date(0));
  }

  return { rows, cursors, hasMore };
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

/**
 * A shared key, not authentication (D59) — the client half is in `sync/transport.ts`
 * and explains why a browser cannot hold a real secret.
 *
 * **Fails open when `SYNC_KEY` is unset**, deliberately. That is exactly the behaviour
 * this endpoint already had, so an unset variable is not a regression; whereas failing
 * closed would brick sync on any deployment that missed the variable, and a wedged
 * outbox is the harder failure to notice. The variable being present is what turns the
 * check on.
 */
function keyAccepted(request: Request): boolean {
  const expected = process.env.SYNC_KEY;
  if (!expected) return true;
  return request.headers.get(SYNC_KEY_HEADER) === expected;
}

export async function POST(request: Request) {
  if (!keyAccepted(request)) {
    return NextResponse.json({ error: "Rejected." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = parseRequest(body);
  if (!parsed) {
    return NextResponse.json(
      { error: "Expected { changes: [], since?: {}, historyFloor?, limit? }." },
      { status: 400 },
    );
  }

  const userId = await ensureUser();

  // Push first, in `seq` order, **one change at a time**.
  //
  // Not one transaction for the whole batch: a single row the server can never accept
  // — a foreign key to a goal that was dropped before it was ever pushed, say — would
  // fail every other change with it, forever, and the outbox would never drain. Per
  // change, a failure is isolated: it is reported, its row stays queued, and everything
  // after it still lands. Sequential rather than parallel because FIFO is what
  // satisfies the foreign keys (a goal before its stage).
  const applied: number[] = [];
  const rejected: RejectedChange[] = [];

  for (const change of parsed.changes) {
    try {
      await applyChange(change, userId);
      applied.push(change.seq);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      // The full text is a Drizzle error carrying the failing SQL — column list and
      // all. Nothing on the client branches on `reason` (only `seq` is read, in
      // `push.ts`), so the wire copy is trimmed to the table and operation and the
      // detail goes to the server log, where debugging a wedged outbox actually
      // happens.
      console.error(`sync: change ${change.seq} (${change.table}) failed —`, detail);
      rejected.push({
        seq: change.seq,
        reason: `${change.op} on ${change.table} was refused`,
      });
    }
  }

  const limit = Math.min(parsed.limit ?? DEFAULT_PULL_LIMIT, MAX_PULL_LIMIT);
  const pulled = await pull(parsed.since, limit, parsed.historyFloor, userId);

  const response: SyncResponse = {
    applied,
    rejected,
    pulled: pulled.rows,
    cursors: pulled.cursors,
    hasMore: pulled.hasMore,
    serverTime: new Date().toISOString(),
  };

  return NextResponse.json(response);
}
