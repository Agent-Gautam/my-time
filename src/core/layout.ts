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

// ---------------------------------------------------------------------------
// Daypart occupancy — D7/D11's `activeCap`, enforced here (D60)
// ---------------------------------------------------------------------------
//
// `activeCap` is "how many different things may occupy this daypart". It used to be
// enforced nowhere: layout ignored it, and the UI counted a stage against **every**
// daypart it was *eligible* for. That reading cannot be right, because eligibility is a
// set (D7) and a session lands in exactly one of them — two goals eligible everywhere
// made all four dayparts read "2 of 2 used" while no plan existed at all.
//
// Only the scheduler knows where a session actually goes, so the cap lives here, keyed
// by `(date, daypartId)`: at most `activeCap` **distinct stages** may be placed in one
// daypart on one day. The attention constraint D11 describes is a daily one — "how many
// separate things am I doing this evening" — not a weekly or lifetime one.

type OccupancyMap = Map<string, number>;

const occupancyKey = (date: IsoDate, daypartId: string): string => `${date}|${daypartId}`;

function occupancyOf(occupancy: OccupancyMap, date: IsoDate, daypartId: string): number {
  return occupancy.get(occupancyKey(date, daypartId)) ?? 0;
}

function occupy(occupancy: OccupancyMap, date: IsoDate, daypartId: string): void {
  occupancy.set(occupancyKey(date, daypartId), occupancyOf(occupancy, date, daypartId) + 1);
}

/**
 * An unknown daypart id is uncapped rather than unusable. It means a slot references a
 * daypart that has since been deleted — rare, already tolerated elsewhere (D44 keeps a
 * logged session's `daypartId` forever), and dropping the slot silently would be worse
 * than letting it sit.
 */
function hasRoom(
  occupancy: OccupancyMap,
  caps: ReadonlyMap<string, number>,
  date: IsoDate,
  daypartId: string,
): boolean {
  const cap = caps.get(daypartId);
  if (cap === undefined) return true;
  return occupancyOf(occupancy, date, daypartId) < cap;
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

  // Placement only ever touches `today..weekEnd`, and `pastSlots` is strictly before
  // today, so past days can never collide with a new placement — the map is seeded from
  // what is retained, and nothing else.
  const caps = new Map(dayparts.map((dp) => [dp.id, dp.activeCap]));
  const occupancy: OccupancyMap = new Map();

  const retained = retainValidExisting(futureExisting, plans, caps, occupancy);

  const newSlots = placeRemaining({
    plans,
    dayparts,
    weekStart,
    weekEnd,
    today,
    historyByStage,
    checkpointsByStage,
    caps,
    occupancy,
  });

  return [...pastSlots, ...retained, ...newSlots].sort(compareSlots(dayparts));
}

/**
 * Prefer existing future slots wherever still valid, up to each stage's remaining need
 * (D32 rule 4).
 *
 * **The daypart cap is enforced here as well as in `placeRemaining`, and it has to be.**
 * A retained slot occupies its daypart just as surely as a fresh one, so a cap checked
 * only on placement would be silently exceeded by any week that was laid out before the
 * cap was lowered. That is the exact shape of the D54 bug — one-session-per-date was
 * enforced in `placeRemaining` and not here — and it stayed invisible until a test ran
 * a fresh layout and a fed-back one side by side.
 *
 * Stages are processed scarcest-first (D9) rather than in map-insertion order, so when
 * the cap binds it is the stage with the fewest alternatives that keeps its slot, and
 * the outcome does not depend on the order the caller happened to pass `existing` in
 * (§4.2 rule 2 — determinism).
 */
function retainValidExisting(
  futureExisting: readonly PlanSlot[],
  plans: Map<string, StagePlan>,
  caps: ReadonlyMap<string, number>,
  occupancy: OccupancyMap,
): PlanSlot[] {
  const byStage = groupBy(futureExisting, (s) => s.stageId);
  const retained: PlanSlot[] = [];

  const scarcestFirst = [...byStage.entries()].sort(([aId], [bId]) => {
    const a = plans.get(aId)?.eligibleDaypartsCount ?? 0;
    const b = plans.get(bId)?.eligibleDaypartsCount ?? 0;
    if (a !== b) return a - b;
    return aId.localeCompare(bId);
  });

  for (const [stageId, slots] of scarcestFirst) {
    const plan = plans.get(stageId);
    if (!plan) continue; // stage no longer active/known — drop (unavoidable churn)

    const chronological = [...slots].sort((a, b) => diffDays(a.date, b.date));
    for (const slot of chronological) {
      if (plan.remainingNeeded <= 0) break;
      if (!plan.stage.eligibleDayparts.includes(slot.daypartId)) continue;
      if (!isLegalDay(plan.stage, slot.date)) continue;
      if (!hasRoom(occupancy, caps, slot.date, slot.daypartId)) continue;
      // D54, and the same rule `placeRemaining` applies. `committedDates` starts as
      // the stage's done dates, so this also drops a slot whose session has since
      // been logged — otherwise the day the user just completed keeps showing an
      // outstanding session, and the output would depend on whether `existing` was
      // passed at all (breaking §4.2 rule 2).
      if (plan.committedDates.includes(slot.date)) continue;
      if (!respectsRest(plan.stage, slot.date, plan.committedDates)) continue;

      retained.push(slot);
      occupy(occupancy, slot.date, slot.daypartId);
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
  caps: ReadonlyMap<string, number>;
  occupancy: OccupancyMap;
}): PlanSlot[] {
  const { plans, dayparts, weekStart, weekEnd, today, historyByStage, checkpointsByStage, caps, occupancy } = args;
  const rangeStart = diffDays(today, weekStart) > 0 ? today : weekStart;
  if (diffDays(rangeStart, weekEnd) > 0) return []; // whole week already past

  const newSlots: PlanSlot[] = [];

  for (const day of datesInRange(rangeStart, weekEnd)) {
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
      // `null` now also means "every eligible daypart is at its cap today" — the stage
      // simply isn't placed today and tries again tomorrow, exactly as it already did
      // when it had no eligible daypart at all. Capacity is a ceiling, not a target
      // (D21): the day stays as it is, and nothing is dropped to make room.
      const daypart = pickDaypart(plan.stage, dayparts, day, caps, occupancy);
      if (!daypart) continue;

      newSlots.push({
        id: `plan-${plan.stage.id}-${day}`,
        stageId: plan.stage.id,
        weekStart,
        date: day,
        daypartId: daypart.id,
        minutes: plan.stage.sessionMinutes,
      });

      occupy(occupancy, day, daypart.id);
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

/**
 * The least-loaded eligible daypart that still has room today, or `null`.
 *
 * Load-balancing now reads the same occupancy map the cap does, which means a retained
 * slot counts toward balance as well as toward the cap. It did not before — the old
 * per-day counter started empty and saw only fresh placements, so a day that already
 * held two retained evening slots still looked like an empty evening.
 */
function pickDaypart(
  stage: Stage,
  dayparts: readonly Daypart[],
  day: IsoDate,
  caps: ReadonlyMap<string, number>,
  occupancy: OccupancyMap,
): Daypart | null {
  const eligible = dayparts.filter(
    (dp) => stage.eligibleDayparts.includes(dp.id) && hasRoom(occupancy, caps, day, dp.id),
  );
  if (eligible.length === 0) return null;
  return eligible.reduce((best, dp) => {
    const bestCount = occupancyOf(occupancy, day, best.id);
    const dpCount = occupancyOf(occupancy, day, dp.id);
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
