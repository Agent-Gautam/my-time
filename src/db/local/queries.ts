// Bounded read helpers over the Dexie mirror (D47).
//
// The standing rule: never `.toArray()` a growing table. `sessionLogs`,
// `checkpoints`, `checkIns` and `planSlots` are therefore only ever reached through
// an index range or an explicit page limit. `dayparts`, `goals` and `stages` are
// bounded by the active cap (D11) and a full read of those is fine.

import type { GoalState, IsoDate, IsoDateTime } from "@/core/types";
import { addDays, dateOnly, isoWeekStart, isoWeekStartFrom } from "@/core/dateUtils";

import {
  localDb,
  type LocalCheckIn,
  type LocalCheckpoint,
  type LocalDaypart,
  type LocalGoal,
  type LocalPlanSlot,
  type LocalPlanWeek,
  type LocalSessionLog,
  type LocalStage,
  type LocalTask,
  type OutboxRow,
  type SyncedTable,
} from "./schema";

/** Default page size for history and missed-session lists (D47). */
export const PAGE_SIZE = 50;

/** How much history the device keeps. The server keeps everything (D48). */
export const LOCAL_HISTORY_WINDOW_DAYS = 120;

// Sentinels for prefix ranges on compound indexes. IndexedDB orders strings
// lexicographically, so these bracket any ISO date or timestamp.
const MIN_KEY = "";
const MAX_KEY = "￿";

const alive = <T extends { deletedAt: IsoDateTime | null }>(rows: T[]): T[] =>
  rows.filter((row) => row.deletedAt === null);

// ---------------------------------------------------------------------------
// Dayparts, goals, stages — bounded tables
// ---------------------------------------------------------------------------

export async function getDayparts(): Promise<LocalDaypart[]> {
  return alive(await localDb.dayparts.orderBy("sortOrder").toArray());
}

export async function getGoals(): Promise<LocalGoal[]> {
  return alive(await localDb.goals.orderBy("tier").toArray());
}

export async function getActiveGoals(): Promise<LocalGoal[]> {
  return alive(await localDb.goals.where("state").equals("active").toArray());
}

export async function getStagesForGoal(goalId: string): Promise<LocalStage[]> {
  const rows = await localDb.stages.where("goalId").equals(goalId).toArray();
  return alive(rows).sort((a, b) => a.sortOrder - b.sortOrder);
}

export async function getActiveStages(): Promise<LocalStage[]> {
  return alive(await localDb.stages.where("state").equals("active").toArray());
}

/** Uses the multiEntry index — stages eligible for one daypart, for scarcity-first
 *  placement (D9). */
export async function getStagesEligibleForDaypart(
  daypartId: string,
): Promise<LocalStage[]> {
  const rows = await localDb.stages
    .where("eligibleDayparts")
    .equals(daypartId)
    .toArray();
  return alive(rows);
}

/**
 * A goal with its stage. Every goal has exactly one implicit stage (PRD §6.3) —
 * the protocol lives there, so a goal on its own can't be rendered or scheduled.
 * `stage` is undefined only for a malformed row; callers should skip those rather
 * than invent defaults.
 */
export interface GoalWithStage {
  goal: LocalGoal;
  stage: LocalStage | undefined;
}

/**
 * Goals with their stage, ordered by tier. Pass `states` to get one slice — the
 * goals list wants `["active", "planned"]`, and the planned backlog on its own is
 * `["planned"]` (D31). Bounded: goals and stages are capped by D11.
 */
export async function getGoalsWithStage(
  options: { states?: readonly GoalState[] } = {},
): Promise<GoalWithStage[]> {
  const goals = await getGoals();
  const wanted = options.states
    ? goals.filter((goal) => options.states!.includes(goal.state))
    : goals;
  if (wanted.length === 0) return [];

  // Indexed on `goalId` rather than a full scan: stages accumulate with every goal
  // ever created, dropped ones included, so the table outgrows the active cap (D47).
  const stages = alive(
    await localDb.stages
      .where("goalId")
      .anyOf(wanted.map((goal) => goal.id))
      .toArray(),
  );
  const byGoal = new Map<string, LocalStage>();
  for (const stage of stages.sort((a, b) => a.sortOrder - b.sortOrder)) {
    if (!byGoal.has(stage.goalId)) byGoal.set(stage.goalId, stage);
  }

  return wanted.map((goal) => ({ goal, stage: byGoal.get(goal.id) }));
}

/**
 * Per-daypart capacity against the active cap (D11), for the always-visible free-slot
 * counts (D31).
 *
 * **Read from the plan, not from eligibility (D60).** This used to count a stage
 * against every daypart it was *eligible* for, which is not what occupancy means:
 * eligibility is a set (D7) and a session lands in exactly one of its members. Two
 * goals eligible in all four dayparts therefore reported all four as fully used, before
 * a single session had been scheduled anywhere. Only the scheduler knows where sessions
 * actually go, so the answer comes from `planSlots` — the same rows `layoutWeek`
 * produced under the same cap.
 *
 * **`free` is a ceiling, never a target.** Show that a slot is free; never prompt the
 * user to fill it (D21, D31).
 *
 * Two numbers, because one is not enough to act on. `usedToday` is the concrete "what
 * does this evening look like"; `freeDays` is what actually answers *"can I start
 * another goal here?"* — a daypart can be full tonight and open on four other days.
 *
 * Bounded (D47): one indexed week of plan slots, which `layoutWeek` already caps in
 * size, plus the daypart table.
 */
export interface DaypartCapacity {
  daypartId: string;
  activeCap: number;
  /** Distinct stages the plan puts in this daypart today. */
  usedToday: number;
  /** Days in the current week where this daypart is still under its cap. */
  freeDays: number;
  /** Days the window covers, so `freeDays` can be rendered as "3 of 7". */
  windowDays: number;
}

export async function getDaypartCapacity(now: IsoDateTime): Promise<DaypartCapacity[]> {
  const today = dateOnly(now);
  const weekStart = isoWeekStart(today);
  const [dayparts, slots] = await Promise.all([
    getDayparts(),
    getPlanSlotsForWeek(weekStart),
  ]);

  // `${date}|${daypartId}` -> distinct stage ids. Distinct because the cap counts
  // *things being done*, and the same stage cannot legitimately appear twice in one
  // daypart on one day anyway (D54) — a Set makes that assumption explicit rather than
  // load-bearing.
  const byDaypartDay = new Map<string, Set<string>>();
  for (const slot of slots) {
    const key = `${slot.date}|${slot.daypartId}`;
    const seen = byDaypartDay.get(key);
    if (seen) seen.add(slot.stageId);
    else byDaypartDay.set(key, new Set([slot.stageId]));
  }

  const weekDates = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  return dayparts.map((daypart) => {
    const usedOn = (date: IsoDate) =>
      byDaypartDay.get(`${date}|${daypart.id}`)?.size ?? 0;

    return {
      daypartId: daypart.id,
      activeCap: daypart.activeCap,
      usedToday: usedOn(today),
      freeDays: weekDates.filter((date) => usedOn(date) < daypart.activeCap).length,
      windowDays: weekDates.length,
    };
  });
}

// ---------------------------------------------------------------------------
// Session logs — append-only, grows without bound
// ---------------------------------------------------------------------------

/** Inclusive date range for one stage. Cadence debt and staleness read this. */
export function getSessionLogsForStage(
  stageId: string,
  from: IsoDate,
  to: IsoDate,
): Promise<LocalSessionLog[]> {
  return localDb.sessionLogs
    .where("[stageId+date]")
    .between([stageId, from], [stageId, to], true, true)
    .toArray();
}

/** Inclusive date range across all stages — the layout input `history`. */
export function getSessionLogsBetween(
  from: IsoDate,
  to: IsoDate,
): Promise<LocalSessionLog[]> {
  return localDb.sessionLogs.where("date").between(from, to, true, true).toArray();
}

export function getSessionLogsForDate(date: IsoDate): Promise<LocalSessionLog[]> {
  return localDb.sessionLogs.where("date").equals(date).toArray();
}

export function getSessionLogsForDaypart(
  date: IsoDate,
  daypartId: string,
): Promise<LocalSessionLog[]> {
  return localDb.sessionLogs.where("[date+daypartId]").equals([date, daypartId]).toArray();
}

/**
 * One page of history, newest first. `cursor` is the last row of the previous page —
 * pass nothing for the first page. Keyset pagination on `[date+id]` rather than on
 * `date`, so a date spanning a page boundary doesn't lose its remaining rows (D47).
 */
export function getSessionLogPage(
  options: { cursor?: { date: IsoDate; id: string }; limit?: number } = {},
): Promise<LocalSessionLog[]> {
  const { cursor, limit = PAGE_SIZE } = options;
  const range = cursor
    ? localDb.sessionLogs.where("[date+id]").below([cursor.date, cursor.id])
    : localDb.sessionLogs.orderBy("[date+id]");
  return range.reverse().limit(limit).toArray();
}

// ---------------------------------------------------------------------------
// Checkpoints — append-only, grows without bound
// ---------------------------------------------------------------------------

/** Most recent checkpoint for a stage, or undefined. Feeds measured pace (D13, D25). */
export async function getLatestCheckpoint(
  stageId: string,
): Promise<LocalCheckpoint | undefined> {
  const rows = await localDb.checkpoints
    .where("[stageId+loggedAt]")
    .between([stageId, MIN_KEY], [stageId, MAX_KEY])
    .reverse()
    .limit(1)
    .toArray();
  return rows[0];
}

/** Checkpoints for one stage, oldest first — enough of them to fit a range (D25). */
export function getCheckpointsForStage(
  stageId: string,
  options: { limit?: number } = {},
): Promise<LocalCheckpoint[]> {
  const { limit = PAGE_SIZE } = options;
  return localDb.checkpoints
    .where("[stageId+loggedAt]")
    .between([stageId, MIN_KEY], [stageId, MAX_KEY])
    .reverse()
    .limit(limit)
    .toArray();
}

/**
 * Recent checkpoints for several stages at once — the `checkpoints` input to
 * `layoutWeek`.
 *
 * Deliberately **not** "the latest checkpoint per stage": `score.deadlinePressure`
 * needs at least two checkpoints to measure a sustained rate, and falls back to a
 * neutral 1.0 with fewer. Passing one per stage would leave deadline pressure
 * permanently neutral for every scoped goal, which looks like it works and quietly
 * doesn't. Bounded by `limitPerStage` over a stage set capped by D11.
 */
export async function getRecentCheckpointsForStages(
  stageIds: readonly string[],
  options: { limitPerStage?: number } = {},
): Promise<LocalCheckpoint[]> {
  const { limitPerStage = 10 } = options;
  const perStage = await Promise.all(
    stageIds.map((stageId) => getCheckpointsForStage(stageId, { limit: limitPerStage })),
  );
  return perStage.flat();
}

// ---------------------------------------------------------------------------
// Check-ins — append-only, grows without bound
// ---------------------------------------------------------------------------

export function getCheckInsForDate(date: IsoDate): Promise<LocalCheckIn[]> {
  return localDb.checkIns.where("date").equals(date).toArray();
}

/** The available minutes the user stated for this daypart, if they have checked in. */
export async function getLatestCheckIn(
  date: IsoDate,
  daypartId: string,
): Promise<LocalCheckIn | undefined> {
  // Bounded by construction — one date, one daypart.
  const rows = await localDb.checkIns
    .where("[date+daypartId]")
    .equals([date, daypartId])
    .sortBy("checkedInAt");
  return rows.at(-1);
}

// ---------------------------------------------------------------------------
// One-off tasks (D68) — mutable, and grows without bound
// ---------------------------------------------------------------------------
//
// Soft-deleted rows are filtered in JS (IndexedDB cannot index null), but unlike
// `dayparts`/`goals`/`stages` this happens *after* an indexed range rather than after
// a full read — the range is what keeps it bounded.

/** Every task anchored to one daypart occurrence. What Today renders. */
export async function getTasksForDaypart(
  date: IsoDate,
  daypartId: string,
): Promise<LocalTask[]> {
  const rows = await localDb.tasks
    .where("[date+daypartId]")
    .equals([date, daypartId])
    .toArray();
  return alive(rows).sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
}

/** Inclusive date range — the /missed week scan reads this. */
export async function getTasksBetween(from: IsoDate, to: IsoDate): Promise<LocalTask[]> {
  return alive(await localDb.tasks.where("date").between(from, to, true, true).toArray());
}

/**
 * One page of a stage's attached tasks, newest first — the `[stageId+date]` keyset
 * pagination cursor (D70), same shape as `getSessionLogPage`'s `[date+id]` cursor.
 * Backs the goal-detail history merge; never a full read of a growing table (D47).
 */
/**
 * Every task attached to one stage, newest first, capped generously (default 200).
 * Not keyset-paginated like `sessionLogs` — this reads through the `[stageId+date]`
 * index, which already narrows to one goal's own tasks rather than a whole growing
 * table (D47's concern is a table that grows without bound; a single goal's attached
 * tasks don't). Backs the goal-detail history merge (D70).
 */
export function getTasksForStage(
  stageId: string,
  options: { limit?: number } = {},
): Promise<LocalTask[]> {
  const { limit = 200 } = options;
  return localDb.tasks
    .where("[stageId+date]")
    .between([stageId, MIN_KEY], [stageId, MAX_KEY], true, true)
    .reverse()
    .limit(limit)
    .toArray()
    .then(alive);
}

// ---------------------------------------------------------------------------
// The plan — synced atomically per week (D45)
// ---------------------------------------------------------------------------

/** The week's version stamp, if the week has ever been laid out (D45). */
export async function getPlanWeek(
  weekStart: IsoDate,
): Promise<LocalPlanWeek | undefined> {
  const rows = await localDb.planWeeks.where("weekStart").equals(weekStart).toArray();
  return rows[0];
}

export function getPlanSlotsForWeek(weekStart: IsoDate): Promise<LocalPlanSlot[]> {
  return localDb.planSlots
    .where("[weekStart+date]")
    .between([weekStart, MIN_KEY], [weekStart, MAX_KEY])
    .toArray();
}

export function getPlanSlotsForDate(date: IsoDate): Promise<LocalPlanSlot[]> {
  return localDb.planSlots.where("date").equals(date).toArray();
}

export function getPlanSlotsForDaypart(
  date: IsoDate,
  daypartId: string,
): Promise<LocalPlanSlot[]> {
  return localDb.planSlots.where("[date+daypartId]").equals([date, daypartId]).toArray();
}

/**
 * Replace a week's plan wholesale — the local half of D45's atomic-per-week rule.
 * Per-slot updates would let two devices interleave into an incoherent plan, so the
 * week is always swapped as one transaction. The caller queues the outbox row; this
 * function only touches local state.
 */
export async function replacePlanWeek(
  week: { id: string; weekStart: IsoDate; version: number; updatedAt: IsoDateTime },
  slots: LocalPlanSlot[],
): Promise<void> {
  await localDb.transaction("rw", localDb.planWeeks, localDb.planSlots, async () => {
    const existing = await localDb.planWeeks
      .where("weekStart")
      .equals(week.weekStart)
      .toArray();

    for (const row of existing) {
      await localDb.planSlots.where("planWeekId").equals(row.id).delete();
      if (row.id !== week.id) await localDb.planWeeks.delete(row.id);
    }

    await localDb.planWeeks.put(week);
    await localDb.planSlots.bulkPut(slots);
  });
}

// ---------------------------------------------------------------------------
// Outbox — local-only (§5)
// ---------------------------------------------------------------------------

export async function enqueue(
  table: SyncedTable,
  op: OutboxRow["op"],
  rowId: string,
  payload: unknown,
  queuedAt: IsoDateTime,
): Promise<void> {
  await localDb.outbox.add({ table, op, rowId, payload, queuedAt, attempts: 0 });
}

/** Oldest pending writes first. Bounded — the outbox is drained in batches. */
export function peekOutbox(limit = PAGE_SIZE): Promise<OutboxRow[]> {
  return localDb.outbox.orderBy("seq").limit(limit).toArray();
}

/** Outbox depth, for the always-visible sync status (D46). Counted, never loaded. */
export function getOutboxDepth(): Promise<number> {
  return localDb.outbox.count();
}

/**
 * The highest `seq` currently queued, or 0 when the outbox is empty.
 *
 * This exists so the sync engine can tell **a new local write** from **its own
 * bookkeeping**. Dexie's `liveQuery` re-fires on any mutation to a table it observes,
 * not only when the observed value changes — so a depth-based trigger also fires when
 * `sync/push.ts` bumps `attempts` on a rejected row, which starts a sync, which rejects
 * it again, which bumps it again: a permanent request loop every debounce interval, on
 * battery, invisible except as an indicator that never settles.
 *
 * `seq` is `++seq` autoincrement and Dexie never reuses a value, so this is monotonic
 * per enqueue and **cannot** be moved by an `update` or by an ack (which only ever
 * removes rows, lowering it). "Strictly greater than last seen" is therefore exactly
 * "someone queued a new write".
 */
export async function getOutboxHighWaterMark(): Promise<number> {
  const newest = await localDb.outbox.orderBy("seq").last();
  return newest?.seq ?? 0;
}

export async function ackOutbox(seqs: number[]): Promise<void> {
  await localDb.outbox.bulkDelete(seqs);
}

// ---------------------------------------------------------------------------
// Device-local settings (never synced)
// ---------------------------------------------------------------------------

import type { Weekday } from "@/core/types";

/** The day-of-week the rolling plan window starts on. Defaults to Monday. */
export async function getWeekStartDay(): Promise<Weekday> {
  const row = await localDb.settings.get("weekStartDay");
  return (row?.value as Weekday | undefined) ?? "mon";
}

export async function setWeekStartDay(day: Weekday): Promise<void> {
  await localDb.settings.put({ key: "weekStartDay", value: day });
}

/**
 * Compute the start of the rolling week that contains `date`, using the
 * user-configured first day of the week.
 *
 * `isoWeekStart` in `core/dateUtils.ts` is always Monday-anchored because the
 * pure scheduler core has no access to device state. Callers that need the
 * configurable version go through here.
 */
export async function weekStartForDate(date: IsoDate): Promise<IsoDate> {
  const firstDay = await getWeekStartDay();
  return isoWeekStartFrom(date, firstDay);
}

// ---------------------------------------------------------------------------
// Retention — local keeps a bounded window, the server keeps everything (D48)
// ---------------------------------------------------------------------------

/** Drop local history older than `before`. Safe: these rows are already on the
 *  server, which prunes nothing (D48). */
export async function pruneHistoryBefore(before: IsoDate): Promise<void> {
  await localDb.transaction(
    "rw",
    localDb.sessionLogs,
    localDb.checkIns,
    localDb.tasks,
    async () => {
      await localDb.sessionLogs.where("date").below(before).delete();
      await localDb.checkIns.where("date").below(before).delete();
      // Tasks are dated and grow the same way (D68). Pruned here means the pull
      // must be floored on them too, or the next sync drags them all back down.
      await localDb.tasks.where("date").below(before).delete();
    },
  );
}
