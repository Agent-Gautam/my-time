// Rolling-week placement (Architecture.md §4.1, §4.2; D9, D16, D26, D32).
//
// Signature note: the illustrative snippet in Architecture.md §4.1 lists only
// `goals`, `dayparts`, `history`, `existing`, `weekStart`. Two additions were
// necessary and are documented here rather than silently made:
//   - `stages`  — Goal has no embedded stages array (stages hang off goalId,
//                 §5.3); layout needs the actual scheduling units.
//   - `checkpoints` — required for the deadline-pressure signal (score.ts).
//   - `now` — D34: the clock is always a parameter, never read internally.
//             Layout needs "today" to know which dates are past (rule 3).
// Nothing here required a change to core/types.ts; every field already exists
// there. This is a corrected function signature, not a gap in the frozen contract.
import type { Checkpoint, Daypart, Goal, IsoDate, IsoDateTime, PlanSlot, SessionLog, Stage } from "./types";
import { addDays, dateOnly, datesInRange, diffDays, weekdayOf } from "./dateUtils";
import { requiredSessionsInWindow, scoreStage } from "./score";

interface StagePlan {
  stage: Stage;
  goal: Goal;
  eligibleDaypartsCount: number;
  requiredThisWeek: number;
  remainingNeeded: number;
  committedDates: IsoDate[]; // history done dates (any time) + accepted/placed dates this run
}

export function layoutWeek(input: {
  goals: readonly Goal[]; // active only
  stages: readonly Stage[]; // active only, across all goals
  dayparts: readonly Daypart[];
  history: readonly SessionLog[];
  checkpoints: readonly Checkpoint[];
  existing: readonly PlanSlot[]; // preferred, to minimise churn (D32)
  weekStart: IsoDate;
  now: IsoDateTime;
}): PlanSlot[] {
  const { goals, dayparts, history, checkpoints, weekStart, now } = input;
  const weekEnd = addDays(weekStart, 6);
  const today = dateOnly(now);

  const goalsById = new Map(goals.map((g) => [g.id, g]));
  const historyByStage = groupBy(history, (h) => h.stageId);
  const checkpointsByStage = groupBy(checkpoints, (c) => c.stageId);

  const stages = input.stages.filter((s) => s.state === "active" && goalsById.has(s.goalId));

  const plans = new Map<string, StagePlan>();
  for (const stage of stages) {
    const goal = goalsById.get(stage.goalId)!;
    const stageHistory = historyByStage.get(stage.id) ?? [];
    const doneDates = stageHistory.filter((h) => h.status === "done").map((h) => h.date);
    const doneThisWeek = doneDates.filter((d) => diffDays(d, weekStart) >= 0 && diffDays(d, weekEnd) <= 0).length;

    let required = requiredSessionsInWindow(stage, weekStart, weekEnd);
    if (stage.maxPerWeek != null) required = Math.min(required, stage.maxPerWeek);

    plans.set(stage.id, {
      stage,
      goal,
      eligibleDaypartsCount: dayparts.filter((dp) => stage.eligibleDayparts.includes(dp.id)).length,
      requiredThisWeek: required,
      remainingNeeded: Math.max(required - doneThisWeek, 0),
      committedDates: [...doneDates],
    });
  }

  const existingThisWeek = input.existing.filter((s) => s.weekStart === weekStart);
  const pastSlots = existingThisWeek.filter((s) => diffDays(s.date, today) < 0);
  const futureExisting = existingThisWeek.filter((s) => diffDays(s.date, today) >= 0);

  const retained = retainValidExisting(futureExisting, plans);

  const newSlots = placeRemaining({
    plans,
    dayparts,
    weekStart,
    weekEnd,
    today,
    historyByStage,
    checkpointsByStage,
  });

  return [...pastSlots, ...retained, ...newSlots].sort(compareSlots(dayparts));
}

/** Prefer existing future slots wherever still valid, up to each stage's remaining need (D32 rule 4). */
function retainValidExisting(futureExisting: readonly PlanSlot[], plans: Map<string, StagePlan>): PlanSlot[] {
  const byStage = groupBy(futureExisting, (s) => s.stageId);
  const retained: PlanSlot[] = [];

  for (const [stageId, slots] of byStage) {
    const plan = plans.get(stageId);
    if (!plan) continue; // stage no longer active/known — drop (unavoidable churn)

    const chronological = [...slots].sort((a, b) => diffDays(a.date, b.date));
    for (const slot of chronological) {
      if (plan.remainingNeeded <= 0) break;
      if (!plan.stage.eligibleDayparts.includes(slot.daypartId)) continue;
      if (!isLegalDay(plan.stage, slot.date)) continue;
      if (!respectsRest(plan.stage, slot.date, plan.committedDates)) continue;

      retained.push(slot);
      plan.committedDates.push(slot.date);
      plan.remainingNeeded -= 1;
    }
  }

  return retained;
}

function placeRemaining(args: {
  plans: Map<string, StagePlan>;
  dayparts: readonly Daypart[];
  weekStart: IsoDate;
  weekEnd: IsoDate;
  today: IsoDate;
  historyByStage: Map<string, SessionLog[]>;
  checkpointsByStage: Map<string, Checkpoint[]>;
}): PlanSlot[] {
  const { plans, dayparts, weekStart, weekEnd, today, historyByStage, checkpointsByStage } = args;
  const rangeStart = diffDays(today, weekStart) > 0 ? today : weekStart;
  if (diffDays(rangeStart, weekEnd) > 0) return []; // whole week already past

  const newSlots: PlanSlot[] = [];

  for (const day of datesInRange(rangeStart, weekEnd)) {
    const dayCounts = new Map<string, number>();

    const candidates = [...plans.values()].filter(
      (p) =>
        p.remainingNeeded > 0 &&
        p.eligibleDaypartsCount > 0 &&
        isLegalDay(p.stage, day) &&
        !p.committedDates.includes(day) && // at most one session per stage per date
        respectsRest(p.stage, day, p.committedDates) &&
        !reservedForMandatory(p, day, weekEnd),
    );

    const mandatory = candidates.filter(
      (p) => p.stage.cadenceType === "hybrid" && hybridMandatoryUnmet(p.stage, p.committedDates) && p.stage.cadenceDays!.includes(weekdayOf(day)),
    );
    const rest = candidates.filter((p) => !mandatory.includes(p));

    const scored = rest
      .map((p) => ({
        plan: p,
        score: scoreStage({
          goal: p.goal,
          stage: p.stage,
          history: historyByStage.get(p.stage.id) ?? [],
          checkpoints: checkpointsByStage.get(p.stage.id) ?? [],
          windowStart: weekStart,
          windowEnd: weekEnd,
          today: day,
          eligibleDaypartsRemainingToday: p.eligibleDaypartsCount,
        }),
      }))
      .sort((a, b) => {
        if (a.plan.eligibleDaypartsCount !== b.plan.eligibleDaypartsCount) {
          return a.plan.eligibleDaypartsCount - b.plan.eligibleDaypartsCount; // scarcest first (D9)
        }
        if (b.score.total !== a.score.total) return b.score.total - a.score.total;
        return a.plan.stage.id.localeCompare(b.plan.stage.id); // deterministic tiebreak
      })
      .map((s) => s.plan);

    const ordered = [...mandatory, ...scored];

    for (const plan of ordered) {
      if (plan.remainingNeeded <= 0) continue;
      const daypart = pickDaypart(plan.stage, dayparts, dayCounts);
      if (!daypart) continue;

      newSlots.push({
        id: `plan-${plan.stage.id}-${day}`,
        stageId: plan.stage.id,
        weekStart,
        date: day,
        daypartId: daypart.id,
        minutes: plan.stage.sessionMinutes,
      });

      dayCounts.set(daypart.id, (dayCounts.get(daypart.id) ?? 0) + 1);
      plan.committedDates.push(day);
      plan.remainingNeeded -= 1;
    }
  }

  return newSlots;
}

function isLegalDay(stage: Stage, date: IsoDate): boolean {
  if (stage.cadenceType === "fixed_days") {
    return stage.cadenceDays?.includes(weekdayOf(date)) ?? false;
  }
  return true; // frequency and hybrid: any day is structurally legal
}

/**
 * The optional rest gap (D20) only. **Not** the one-session-per-stage-per-date rule —
 * `minRestDays` is usually null, so this returns true for a date the stage is already
 * committed to. `placeRemaining` checks `committedDates.includes(day)` separately, and
 * must: without it a retained `existing` slot plus a fresh placement on the same date
 * both get id `plan-<stageId>-<date>`, `bulkPut` collapses them, and the week comes up
 * a session short with no error anywhere.
 */
function respectsRest(stage: Stage, date: IsoDate, committedDates: readonly IsoDate[]): boolean {
  if (stage.minRestDays == null) return true;
  return committedDates.every((c) => Math.abs(diffDays(date, c)) > stage.minRestDays!);
}

function hybridMandatoryUnmet(stage: Stage, committedDates: readonly IsoDate[]): boolean {
  if (!stage.cadenceDays || stage.cadenceDays.length === 0) return false;
  return !committedDates.some((d) => stage.cadenceDays!.includes(weekdayOf(d)));
}

/**
 * Reserve capacity so a hybrid stage's mandatory weekday (e.g. "one must be
 * Sunday") doesn't get spent away by frequency-style placements earlier in the
 * week. Blocks the stage from a non-mandatory day only when so little of its
 * remaining need is left that skipping today is required to still cover every
 * still-unmet mandatory occurrence later in the window.
 */
function reservedForMandatory(plan: StagePlan, day: IsoDate, weekEnd: IsoDate): boolean {
  if (plan.stage.cadenceType !== "hybrid" || !hybridMandatoryUnmet(plan.stage, plan.committedDates)) return false;
  if (plan.stage.cadenceDays!.includes(weekdayOf(day))) return false; // today is itself a mandatory day
  const futureOccurrences = futureMandatoryOccurrences(plan.stage, day, weekEnd);
  return plan.remainingNeeded <= futureOccurrences;
}

function futureMandatoryOccurrences(stage: Stage, afterDay: IsoDate, weekEnd: IsoDate): number {
  if (!stage.cadenceDays) return 0;
  let count = 0;
  for (let d = addDays(afterDay, 1); diffDays(d, weekEnd) <= 0; d = addDays(d, 1)) {
    if (stage.cadenceDays.includes(weekdayOf(d))) count++;
  }
  return count;
}

function pickDaypart(stage: Stage, dayparts: readonly Daypart[], todayCounts: Map<string, number>): Daypart | null {
  const eligible = dayparts.filter((dp) => stage.eligibleDayparts.includes(dp.id));
  if (eligible.length === 0) return null;
  return eligible.reduce((best, dp) => {
    const bestCount = todayCounts.get(best.id) ?? 0;
    const dpCount = todayCounts.get(dp.id) ?? 0;
    if (dpCount < bestCount) return dp;
    if (dpCount === bestCount && dp.sortOrder < best.sortOrder) return dp;
    return best;
  });
}

function compareSlots(dayparts: readonly Daypart[]) {
  const sortOrderById = new Map(dayparts.map((dp) => [dp.id, dp.sortOrder]));
  return (a: PlanSlot, b: PlanSlot): number => {
    const byDate = diffDays(a.date, b.date);
    if (byDate !== 0) return byDate;
    const byDaypart = (sortOrderById.get(a.daypartId) ?? 0) - (sortOrderById.get(b.daypartId) ?? 0);
    if (byDaypart !== 0) return byDaypart;
    return a.stageId.localeCompare(b.stageId);
  };
}

function groupBy<T, K>(items: readonly T[], key: (item: T) => K): Map<K, T[]> {
  const map = new Map<K, T[]>();
  for (const item of items) {
    const k = key(item);
    const list = map.get(k);
    if (list) list.push(item);
    else map.set(k, [item]);
  }
  return map;
}
