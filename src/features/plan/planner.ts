// The `core/` ⇄ Dexie seam. `core/` is pure and cannot read the database (D34), so
// this is the only module that loads inputs, calls the scheduler, and writes results
// back. Everything above it (screens) calls these two functions and nothing else.
//
// `now` is a **local wall-clock** `IsoDateTime` — see the convention in
// `lib/daypart.ts`. Use `localNow()`; never `new Date().toISOString()`.

import { layoutWeek } from "@/core/layout";
import { reconcileDaypart } from "@/core/reconcile";
import { explainSlot, type ExplainContext } from "@/core/explain";
import { scoreStage } from "@/core/score";
import { SCHEDULER_CONSTANTS } from "@/core/constants";
import { addDays, dateOnly, diffDays, isoWeekStart } from "@/core/dateUtils";
import type { IsoDate, IsoDateTime, PlanSlot } from "@/core/types";

import {
  enqueue,
  getActiveGoals,
  getActiveStages,
  getDayparts,
  getPlanSlotsForDaypart,
  getPlanSlotsForWeek,
  getPlanWeek,
  getRecentCheckpointsForStages,
  getSessionLogsBetween,
  getSessionLogsForStage,
  replacePlanWeek,
} from "@/db/local/queries";
import {
  localDb,
  type LocalDaypart,
  type LocalGoal,
  type LocalPlanSlot,
  type LocalStage,
} from "@/db/local/schema";
import {
  daypartDate,
  daypartsRemainingToday,
  eligibleDaypartsRemainingToday,
} from "@/lib/daypart";

/**
 * How far back layout needs history to reach. Derived rather than hardcoded:
 * `score.staleness` saturates at `stalenessCapDays`, so nothing older can change
 * an output, and the extra week covers a `weekStart` that is already in the past.
 */
const HISTORY_LOOKBACK_DAYS = SCHEDULER_CONSTANTS.stalenessCapDays + 7;

/** Deterministic, so two devices name the same week the same row (D45). */
export const planWeekId = (weekStart: IsoDate): string => `week-${weekStart}`;

// ---------------------------------------------------------------------------
// relayoutWeek
// ---------------------------------------------------------------------------

export interface RelayoutResult {
  weekStart: IsoDate;
  version: number;
  slots: LocalPlanSlot[];
}

/**
 * Recompute a week's plan from current inputs and swap it in wholesale.
 *
 * Called on every input change — goal activated, cadence edited, daypart boundary
 * moved, session logged. It is a recompute, never a patch, and it is idempotent,
 * so racing calls are harmless (D32).
 *
 * ### Decision 1 — the outbox row covers the whole week, never a slot
 *
 * `replacePlanWeek`'s own doc leaves queueing to the caller, so it is queued here.
 * D45 makes the week the atomic unit: **one** outbox row, on `planWeeks`, whose
 * payload carries the week stamp *and* all its slots. Per-slot rows would let two
 * devices interleave halves of two different plans into something coherent in
 * neither. Wave 3's push must send this payload as one unit and apply it the same
 * way.
 *
 * ### Decision 2 — how `LocalPlanWeek.version` is assigned
 *
 * **Monotonic per `weekStart`, incremented on every local relayout**, starting at
 * 1. It is a local edit counter, not a clock and not a global sequence: the read
 * of the previous version and the write of the new one happen inside the same
 * transaction as the replace, so two concurrent relayouts on one device cannot
 * mint the same number.
 *
 * Across devices it is deliberately *not* unique — two offline devices can both
 * produce version 4 for the same week. That is fine and is what D45 already
 * accepts: the plan is derived, not precious, and the week resolves last-write-wins
 * wholesale on `updatedAt`, with `version` as the tie-break and the signal that the
 * remote week is a different lineage rather than a no-op. This is merge semantics,
 * so it is fixed here rather than left to a UI session.
 */
export async function relayoutWeek(input: {
  now: IsoDateTime;
  weekStart?: IsoDate;
}): Promise<RelayoutResult> {
  const { now } = input;
  const today = dateOnly(now);
  const weekStart = input.weekStart ?? isoWeekStart(today);
  const weekEnd = addDays(weekStart, 6);

  const [dayparts, goals, allActiveStages, existing] = await Promise.all([
    getDayparts(),
    getActiveGoals(),
    getActiveStages(),
    getPlanSlotsForWeek(weekStart),
  ]);

  // A stage is only live if its goal is: dropping a goal leaves its stages
  // `active`, since `StageState` has no "dropped" member.
  const activeGoalIds = new Set(goals.map((goal) => goal.id));
  const stages = allActiveStages.filter((stage) => activeGoalIds.has(stage.goalId));

  // Bounded window (D47): back far enough that staleness has saturated, forward to
  // the end of the week being laid out.
  const historyFrom = addDays(today, -HISTORY_LOOKBACK_DAYS);
  const [history, checkpoints] = await Promise.all([
    getSessionLogsBetween(
      diffDays(weekStart, historyFrom) < 0 ? weekStart : historyFrom,
      weekEnd,
    ),
    getRecentCheckpointsForStages(stages.map((stage) => stage.id)),
  ]);

  const laidOut = layoutWeek({
    goals,
    stages,
    dayparts,
    history,
    checkpoints,
    existing,
    weekStart,
    now,
  });

  const weekId = planWeekId(weekStart);
  // Slot ids are unique per week: `layoutWeek` places at most one session per stage
  // per date, and ids are `plan-<stageId>-<date>`. That was not true when this module
  // was written — a retained slot plus a fresh placement on the same date collided and
  // `bulkPut` silently collapsed them. Fixed in `core/layout.ts` and covered by
  // "layoutWeek — one session per stage per date" in tests/core/layout.test.ts.
  const slots: LocalPlanSlot[] = laidOut.map((slot) => ({
    ...slot,
    planWeekId: weekId,
  }));

  // One transaction spanning the version read, the replace and the enqueue.
  // `replacePlanWeek` opens its own `rw` over a subset of this scope, which Dexie
  // nests. Reading the previous version outside this would let two relayouts race
  // onto the same number.
  let version = 1;
  await localDb.transaction(
    "rw",
    localDb.planWeeks,
    localDb.planSlots,
    localDb.outbox,
    async () => {
      const previous = await getPlanWeek(weekStart);
      version = (previous?.version ?? 0) + 1;
      const week = { id: weekId, weekStart, version, updatedAt: now };

      await replacePlanWeek(week, slots);
      await enqueue("planWeeks", "put", weekId, { week, slots }, now);
    },
  );

  return { weekStart, version, slots };
}

// ---------------------------------------------------------------------------
// reconcileNow
// ---------------------------------------------------------------------------

/** A slot plus everything needed to render it, including its one-line reason (D14). */
export interface ReconciledSlot {
  slot: LocalPlanSlot;
  goal: LocalGoal;
  stage: LocalStage;
  daypart: LocalDaypart;
  reason: string;
}

/**
 * Pack this daypart's planned sessions into the time the user says they have (D8).
 *
 * **This does not rewrite the plan.** Reconciliation is a view-time operation: a
 * full re-layout after reconciling is explicitly `[later]` (PRD §6.4), and D32 says
 * recompute from inputs, never patch an output. Nothing here writes.
 *
 * **`availableMinutes: null` means "no limit stated"** — Today's default since D63,
 * where the screen opens on the proposed list and stating a time is an explicit,
 * occasional action. Everything is returned in `keep` and `dropped` is empty.
 *
 * Null is a real branch rather than a very large number, and that is not style.
 * `reconcileDaypart` allocates a knapsack table of `availableMinutes + 1` cells
 * (`core/reconcile.ts`), so `Infinity` throws outright and a "big enough" sentinel
 * silently allocates a huge array on a budget phone — the exact shape D47 exists to
 * prevent. There is also nothing to decide when no limit was given: every slot is
 * kept, so the packing pass has no work to do.
 *
 * Ordering note: `reconcileDaypart` documents that its input arrives "in priority
 * order — the order layout.ts produces", but `layoutWeek` sorts by date, then
 * daypart, then `stageId` alphabetically, and `getPlanSlotsForDaypart` returns
 * index order regardless. So priority order is imposed here by re-scoring with the
 * same `scoreStage` layout uses. That ordering still applies when nothing is
 * dropped: it is what puts the most pressing session at the top of the list.
 */
export async function reconcileNow(input: {
  now: IsoDateTime;
  daypartId: string;
  availableMinutes: number | null;
}): Promise<{ keep: ReconciledSlot[]; dropped: ReconciledSlot[] }> {
  const { now, daypartId, availableMinutes } = input;

  const dayparts = await getDayparts();
  const daypart = dayparts.find((dp) => dp.id === daypartId);
  if (!daypart) return { keep: [], dropped: [] };

  // The occurrence's own date, which is yesterday's when a wrapping night daypart
  // has crossed midnight — see `daypartDate`. Everything below keys off this, not
  // `dateOnly(now)`: the cadence window follows the slot, so a Sunday-night session
  // is still counted in Sunday's week at 01:00 on Monday.
  const today = daypartDate(daypart, now);
  const weekStart = isoWeekStart(today);
  const weekEnd = addDays(weekStart, 6);

  const [goals, activeStages, daypartSlots, weekSlots] = await Promise.all([
    getActiveGoals(),
    getActiveStages(),
    getPlanSlotsForDaypart(today, daypartId),
    getPlanSlotsForWeek(weekStart),
  ]);
  const goalsById = new Map(goals.map((goal) => [goal.id, goal]));
  const stagesById = new Map(activeStages.map((stage) => [stage.id, stage]));

  // Slots whose stage or goal has since gone away can't be rendered or reasoned
  // about; they disappear at the next relayout.
  const renderable = daypartSlots.filter((slot) => {
    const stage = stagesById.get(slot.stageId);
    return stage != null && goalsById.has(stage.goalId);
  });

  if (renderable.length === 0) return { keep: [], dropped: [] };

  const stageIds = [...new Set(renderable.map((slot) => slot.stageId))];
  const [historyPerStage, checkpoints] = await Promise.all([
    Promise.all(
      stageIds.map((stageId) =>
        getSessionLogsForStage(stageId, addDays(today, -HISTORY_LOOKBACK_DAYS), weekEnd),
      ),
    ),
    getRecentCheckpointsForStages(stageIds),
  ]);

  const historyByStage = new Map(stageIds.map((id, i) => [id, historyPerStage[i]]));

  const ordered = [...renderable].sort((a, b) => {
    const scoreOf = (slot: LocalPlanSlot) => {
      const stage = stagesById.get(slot.stageId)!;
      return scoreStage({
        goal: goalsById.get(stage.goalId)!,
        stage,
        history: historyByStage.get(stage.id) ?? [],
        checkpoints: checkpoints.filter((c) => c.stageId === stage.id),
        windowStart: weekStart,
        windowEnd: weekEnd,
        today,
        eligibleDaypartsRemainingToday: eligibleDaypartsRemainingToday(
          dayparts,
          stage,
          now,
        ),
      }).total;
    };
    const byScore = scoreOf(b) - scoreOf(a);
    if (byScore !== 0) return byScore;
    return a.stageId.localeCompare(b.stageId); // deterministic tiebreak
  });

  const { keep, dropped } =
    availableMinutes == null
      ? { keep: ordered as PlanSlot[], dropped: [] as PlanSlot[] }
      : reconcileDaypart({ slots: ordered, availableMinutes, now });

  const enrich = (slot: PlanSlot): ReconciledSlot => {
    const local = slot as LocalPlanSlot;
    const stage = stagesById.get(slot.stageId)!;
    const goal = goalsById.get(stage.goalId)!;

    const stageWeekSlots = weekSlots
      .filter((s) => s.stageId === stage.id)
      .sort((a, b) => diffDays(a.date, b.date) || a.id.localeCompare(b.id));
    const position = stageWeekSlots.findIndex((s) => s.id === slot.id);

    const context: ExplainContext = {
      goal,
      stage,
      daypart,
      ordinal: position >= 0 ? position + 1 : 1,
      totalThisWindow: Math.max(stageWeekSlots.length, 1),
      daysLeftInWindow: Math.max(diffDays(weekEnd, today) + 1, 1),
      eligibleDaypartsToday: daypartsRemainingToday(dayparts, now).filter((dp) =>
        stage.eligibleDayparts.includes(dp.id),
      ),
    };

    return { slot: local, goal, stage, daypart, reason: explainSlot(slot, context) };
  };

  return { keep: keep.map(enrich), dropped: dropped.map(enrich) };
}
