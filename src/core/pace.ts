// The two "on track" questions (D25, Architecture.md §4.1):
//   cadenceStatus — am I keeping up with how often I show up?
//   scopeStatus   — am I keeping up with how much ground I'm covering?
// Both compare a required line (pure arithmetic, exists day one) against an
// actual/measured line (starts empty, grows with logged data) — never a guess.
import type { Checkpoint, IsoDate, IsoDateTime, SessionLog, Stage } from "./types";
import { addDays, dateOnly, diffDays, isInRange, isoWeekStart } from "./dateUtils";
import { requiredSessionsInWindow, sessionsAvailableInRange } from "./score";
import { SCHEDULER_CONSTANTS } from "./constants";

export interface CadenceStatus {
  requiredPerDay: number; // sessions/day needed for the remainder of this week's window
  actualPerDay: number; // measured sessions/day since the stage's first logged session
  feasible: boolean; // can requiredPerDay still be met in the days and rest gaps left (D20, D64)
}

/**
 * `history` must be this stage's SessionLog rows only (any status/source — done
 * sessions count, planned vs voluntary both credit per D20).
 */
export function cadenceStatus(stage: Stage, history: readonly SessionLog[], now: IsoDateTime): CadenceStatus {
  const today = dateOnly(now);
  const windowStart = isoWeekStart(today);
  const windowEnd = addDays(windowStart, 6);

  const required = requiredSessionsInWindow(stage, windowStart, windowEnd);
  const doneInWindow = history.filter(
    (h) => h.status === "done" && isInRange(h.date, windowStart, windowEnd),
  ).length;
  const requiredRemaining = Math.max(required - doneInWindow, 0);
  const daysRemaining = Math.max(diffDays(windowEnd, today) + 1, 1);
  const requiredPerDay = requiredRemaining / daysRemaining;

  const doneDates = history.filter((h) => h.status === "done").map((h) => h.date);
  let actualPerDay = 0;
  if (doneDates.length > 0) {
    const firstDone = doneDates.reduce((earliest, d) => (diffDays(d, earliest) < 0 ? d : earliest));
    const elapsed = Math.max(diffDays(today, firstDone) + 1, 1);
    actualPerDay = doneDates.length / elapsed;
  }

  const feasible = isFeasible(stage, requiredRemaining, daysRemaining);

  return { requiredPerDay, actualPerDay, feasible };
}

/**
 * Feasibility is about the days and the rest gaps left in the window, and nothing else.
 *
 * `maxPerWeek` used to appear here as
 * `doneInWindow + requiredRemaining > stage.maxPerWeek`. It never said anything about
 * actual progress: the `requiredRemaining === 0` early return means any call that gets
 * past it has `doneInWindow < required`, so `doneInWindow + requiredRemaining` is
 * *exactly* `required` and the clause reduced to `required > maxPerWeek` — a check on
 * whether the stage's own two numbers contradict each other, reported through the
 * feasibility channel as "not reachable this week". D64 rejects that contradiction at
 * the form instead, so the clause is gone and `doneInWindow` went with it.
 *
 * The D60 gap is still open and is not this: `cadenceStatus` takes `(stage, history,
 * now)` and so cannot see the daypart cap, which needs the plan and the dayparts. A
 * stage starved by a full daypart is still under-placed with nothing said here.
 */
function isFeasible(stage: Stage, requiredRemaining: number, daysRemaining: number): boolean {
  if (requiredRemaining === 0) return true;
  if (requiredRemaining > daysRemaining) return false; // can't do 2 sessions in 1 day
  if (stage.minRestDays != null) {
    const maxPossible = Math.ceil(daysRemaining / (stage.minRestDays + 1));
    if (requiredRemaining > maxPossible) return false;
  }
  return true;
}

export interface ScopeProjection {
  finishDate: IsoDate;
  earliest: IsoDate;
  latest: IsoDate;
}

export interface ScopeStatus {
  requiredPerUnit: number | null; // sessions needed per remaining unit to finish by targetDate — pure arithmetic (D25)
  measuredPerUnit: number | null; // sessions actually spent per completed unit so far — null until any checkpoint exists (D17)
  projection: ScopeProjection | null; // narrowing range once measuredPerUnit exists — never a confident point (D25)
}

/**
 * `history` must be this stage's SessionLog rows only. Cadence-only stages
 * (no scopeUnitTotal/targetDate) return all-null — there's nothing to project.
 */
export function scopeStatus(
  stage: Stage,
  checkpoints: readonly Checkpoint[],
  history: readonly SessionLog[],
  now: IsoDateTime,
): ScopeStatus {
  if (stage.scopeUnitTotal == null || stage.targetDate == null) {
    return { requiredPerUnit: null, measuredPerUnit: null, projection: null };
  }

  const today = dateOnly(now);
  const sorted = [...checkpoints].sort((a, b) => a.loggedAt.localeCompare(b.loggedAt));
  const latestValue = sorted.length > 0 ? sorted[sorted.length - 1].value : 0;
  const remainingUnits = Math.max(stage.scopeUnitTotal - latestValue, 0);

  const sessionsAvailable = sessionsAvailableInRange(stage, today, stage.targetDate);
  const requiredPerUnit = remainingUnits > 0 ? sessionsAvailable / remainingUnits : 0;

  if (sorted.length === 0 || latestValue <= 0) {
    return { requiredPerUnit, measuredPerUnit: null, projection: null };
  }

  const doneSessions = history.filter((h) => h.status === "done").length;
  const measuredPerUnit = doneSessions / latestValue;

  let projection: ScopeProjection | null = null;
  if (remainingUnits === 0) {
    projection = { finishDate: today, earliest: today, latest: today };
  } else {
    const weeklyRate =
      stage.cadenceType === "fixed_days" ? (stage.cadenceDays?.length ?? 0) : stage.cadenceCount;
    if (weeklyRate > 0) {
      const sessionsNeeded = remainingUnits * measuredPerUnit;
      const daysNeeded = Math.ceil((sessionsNeeded / weeklyRate) * 7);
      const finishDate = addDays(today, daysNeeded);

      const { paceProjectionBaseUncertaintyDays, paceProjectionMinUncertaintyDays } = SCHEDULER_CONSTANTS;
      const uncertainty = Math.max(
        Math.round(paceProjectionBaseUncertaintyDays / sorted.length),
        paceProjectionMinUncertaintyDays,
      );
      projection = {
        finishDate,
        earliest: addDays(finishDate, -uncertainty),
        latest: addDays(finishDate, uncertainty),
      };
    }
  }

  return { requiredPerUnit, measuredPerUnit, projection };
}
