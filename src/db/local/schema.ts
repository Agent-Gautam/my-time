// Dexie / IndexedDB — the source of truth for every read the UI makes (D33).
//
// This mirrors `db/server/schema.ts` but is deliberately independent of it: nothing
// here imports Drizzle, so the domain contract stays `core/types.ts` and no server
// code reaches the client bundle. Row shapes are the core types plus the sync
// bookkeeping the mirror needs.
//
// Indexes exist to serve bounded queries (D47). Never `.toArray()` a growing table —
// `session_logs`, `checkpoints`, `check_ins` and `plan_slots` all grow without bound,
// so each one is indexed for the date-range and pagination queries in `queries.ts`.

import Dexie, { type Table } from "dexie";

import type {
  CheckIn,
  Checkpoint,
  Daypart,
  Goal,
  IsoDate,
  IsoDateTime,
  PlanSlot,
  SessionLog,
  Stage,
  Task,
} from "@/core/types";

/** Carried by every mutable synced row. LWW on `updatedAt` resolves edits (§6);
 *  `deletedAt` is the tombstone that lets a delete propagate. */
interface Mutable {
  updatedAt: IsoDateTime;
  /** `null`, not absent — IndexedDB cannot index null, so this is filtered in JS
   *  and only ever on the small bounded tables. */
  deletedAt: IsoDateTime | null;
}

export interface LocalUser extends Mutable {
  id: string;
  email: string | null;
}

export type LocalDaypart = Daypart & Mutable;
export type LocalGoal = Goal & Mutable;
export type LocalStage = Stage & Mutable;

/** Append-only. Facts, never rewritten (D32) — so no `updatedAt`, no tombstone. */
export type LocalSessionLog = SessionLog;
export type LocalCheckpoint = Checkpoint;
export type LocalCheckIn = CheckIn;

/**
 * Mutable, not append-only: a task is created pending and later answered, so the row
 * is rewritten once and LWW on `updatedAt` is what resolves two devices answering it.
 * That is the difference from a `SessionLog`, which is a fact the moment it exists.
 * It is also a *growing* table — every read below goes through a date range (D47).
 */
export type LocalTask = Task & Mutable;

export interface LocalPushSubscription extends Mutable {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  deviceLabel: string | null;
}

/** One version stamp for the whole week — the plan syncs atomically (D45, §5.2). */
export interface LocalPlanWeek {
  id: string;
  weekStart: IsoDate;
  version: number;
  updatedAt: IsoDateTime;
}

/**
 * `weekStart` is denormalised here even though Postgres keeps it only on
 * `plan_weeks`. That is intentional: the mirror exists for join-free indexed reads,
 * and the week is the unit both the UI and D45's atomic replace work in.
 */
export type LocalPlanSlot = PlanSlot & { planWeekId: string };

/** The tables that sync. `outbox` is the one local-only table (§5). */
export const SYNCED_TABLES = [
  "users",
  "dayparts",
  "goals",
  "stages",
  "sessionLogs",
  "checkpoints",
  "checkIns",
  "tasks",
  "pushSubscriptions",
  "planWeeks",
  "planSlots",
] as const;

export type SyncedTable = (typeof SYNCED_TABLES)[number];

export type OutboxOp = "put" | "delete";

/**
 * Local-only transport detail (§5). Never leaves the device — what leaves is the
 * payload, sent by `sync/`. Auto-incrementing `seq` gives FIFO ordering for free.
 */
export interface OutboxRow {
  seq?: number;
  table: SyncedTable;
  op: OutboxOp;
  rowId: string;
  /** The full row for `put`; `null` for `delete`. */
  payload: unknown;
  queuedAt: IsoDateTime;
  attempts: number;
}

/**
 * Device-local preferences that are never synced. Only a handful of small values
 * live here — everything user-facing that must round-trip to the server goes through
 * the normal synced tables instead.
 */
export interface LocalSetting {
  key: string;
  value: unknown;
}

export class MyTimeDB extends Dexie {
  users!: Table<LocalUser, string>;
  dayparts!: Table<LocalDaypart, string>;
  goals!: Table<LocalGoal, string>;
  stages!: Table<LocalStage, string>;
  sessionLogs!: Table<LocalSessionLog, string>;
  checkpoints!: Table<LocalCheckpoint, string>;
  checkIns!: Table<LocalCheckIn, string>;
  tasks!: Table<LocalTask, string>;
  pushSubscriptions!: Table<LocalPushSubscription, string>;
  planWeeks!: Table<LocalPlanWeek, string>;
  planSlots!: Table<LocalPlanSlot, string>;
  outbox!: Table<OutboxRow, number>;
  settings!: Table<LocalSetting, string>;

  constructor() {
    super("my-time");

    this.version(1).stores({
      users: "id",

      // Bounded, small tables: a full read is fine, so they carry only the
      // indexes that ordering and lookup need.
      dayparts: "id, sortOrder",
      goals: "id, state, tier",
      // `*eligibleDayparts` is multiEntry — scarcity-first layout filters stages by
      // eligible daypart (D9), and an array field is otherwise unindexable.
      stages: "id, goalId, state, *eligibleDayparts",

      // Growing tables. Every read against these goes through a range on one of
      // these indexes (D47).
      // `[date+id]` is the keyset-pagination cursor: paging on `date` alone would
      // silently drop the rest of a shared date at the page boundary.
      sessionLogs: "id, [stageId+date], [date+daypartId], [date+id], date, loggedAt",
      checkpoints: "id, [stageId+loggedAt], loggedAt",
      checkIns: "id, [date+daypartId], date, checkedInAt",

      pushSubscriptions: "id, endpoint",

      planWeeks: "id, weekStart",
      planSlots: "id, planWeekId, stageId, date, [date+daypartId], [weekStart+date]",

      outbox: "++seq, table, queuedAt",
    });

    // A **new version block**, never an edit to `version(1)` above. Editing v1 in
    // place does nothing on a device that already opened v1 — Dexie only runs an
    // upgrade when the declared version number rises — so the object store would
    // never be created and the first `localDb.tasks` read would throw on exactly the
    // installed PWAs this app is for. Only the changed store is listed; everything
    // declared in v1 carries forward untouched.
    //
    // `[date+daypartId]` serves Today (one occurrence), `date` serves the /missed
    // week scan and `pruneHistoryBefore` — both ranges, never a full read (D47).
    this.version(2).stores({
      tasks: "id, date, [date+daypartId]",
    });

    // Another new block, not an edit to version(2) — same reason as above: Dexie
    // only knows a store's index shape from the version it was declared in, and a
    // device that already opened v2 needs an upgrade path to see the new index.
    //
    // `[stageId+date]` backs the goal-detail history page (D70): tasks attached to a
    // stage, paginated the same keyset way `sessionLogs`'s own `[stageId+date]`
    // already is. `stageId` alone (not multiEntry — every task has at most one)
    // serves the "does this stage have any attached tasks at all" existence check.
    this.version(3).stores({
      tasks: "id, stageId, date, [stageId+date], [date+daypartId]",
    });

    // Device-local key-value settings (never synced). A plain `key` primary index
    // is all that's needed — the table is tiny and only ever read by key.
    this.version(4).stores({
      settings: "key",
    });

    // `status` index — required by `resetTracking` which queries pending tasks via
    // `.where("status").equals("pending")`. Missing from v1–v3; added here as v5
    // so existing devices get an upgrade path without losing their task history.
    // Only the changed store is listed; all other stores carry forward from v4.
    this.version(5).stores({
      tasks: "id, stageId, status, date, [stageId+date], [date+daypartId]",
    });
  }
}

export const localDb = new MyTimeDB();
