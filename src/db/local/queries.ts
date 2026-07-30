// Bounded read helpers over the Dexie mirror (D47).
//
// The standing rule: never `.toArray()` a growing table. `sessionLogs`,
// `checkpoints`, `checkIns` and `planSlots` are therefore only ever reached through
// an index range or an explicit page limit. `dayparts`, `goals` and `stages` are
// bounded by the active cap (D11) and a full read of those is fine.

import type { GoalState, IsoDate, IsoDateTime } from "@/core/types";

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
 * Per-daypart capacity against the active cap (D11), for the always-visible
 * free-slot counts (D31).
 *
 * **`free` is a ceiling, never a target.** Show that a slot is free; never prompt
 * the user to fill it (D21, D31).
 *
 * One bounded read of active stages rather than a `.count()` per daypart, because
 * the count has to join goal state: dropping a goal leaves its stages `active`
 * (`StageState` has no "dropped" member), so counting stages alone would keep
 * reserving capacity for goals the user has already dropped. Stages and goals are
 * both capped by D11, so a full read of them is the sanctioned case (D47).
 */
export interface DaypartCapacity {
  daypartId: string;
  activeCap: number;
  used: number;
  free: number;
}

export async function getDaypartCapacity(): Promise<DaypartCapacity[]> {
  const [dayparts, activeGoals, activeStages] = await Promise.all([
    getDayparts(),
    getActiveGoals(),
    getActiveStages(),
  ]);

  const activeGoalIds = new Set(activeGoals.map((goal) => goal.id));
  const live = activeStages.filter((stage) => activeGoalIds.has(stage.goalId));

  return dayparts.map((daypart) => {
    const used = live.filter((stage) =>
      stage.eligibleDayparts.includes(daypart.id),
    ).length;
    return {
      daypartId: daypart.id,
      activeCap: daypart.activeCap,
      used,
      free: Math.max(daypart.activeCap - used, 0),
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

export async function ackOutbox(seqs: number[]): Promise<void> {
  await localDb.outbox.bulkDelete(seqs);
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
    async () => {
      await localDb.sessionLogs.where("date").below(before).delete();
      await localDb.checkIns.where("date").below(before).delete();
    },
  );
}
