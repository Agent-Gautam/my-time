// Scoring signals for layout.ts (Architecture.md §4.3): cadence debt, deadline
// pressure, staleness, scarcity, combined as tier * pressure * scarcity.
import type { Checkpoint, Goal, SessionLog, Stage, IsoDate } from "./types";
import { addDays, diffDays, isInRange, weekdayOf } from "./dateUtils";
import { SCHEDULER_CONSTANTS } from "./constants";

/** Required sessions in a window sized to exactly one cadence period (a week). */
export function requiredSessionsInWindow(stage: Stage, windowStart: IsoDate, windowEnd: IsoDate): number {
  if (stage.cadenceType === "fixed_days") {
    if (!stage.cadenceDays) return 0;
    return datesMatchingWeekdays(windowStart, windowEnd, stage.cadenceDays);
  }
  // frequency and hybrid both target cadenceCount total sessions in the window.
  return stage.cadenceCount;
}

/**
 * Sessions available over an arbitrary-length range (e.g. today..targetDate),
 * scaling frequency/hybrid cadence by the number of weeks the range spans —
 * unlike requiredSessionsInWindow, which assumes a single week.
 */
export function sessionsAvailableInRange(stage: Stage, start: IsoDate, end: IsoDate): number {
  if (diffDays(end, start) < 0) return 0;
  if (stage.cadenceType === "fixed_days") {
    return stage.cadenceDays ? datesMatchingWeekdays(start, end, stage.cadenceDays) : 0;
  }
  const totalDays = diffDays(end, start) + 1;
  return (totalDays / 7) * stage.cadenceCount;
}

export function datesMatchingWeekdays(start: IsoDate, end: IsoDate, days: readonly string[]): number {
  let count = 0;
  for (let d = start; diffDays(d, end) <= 0; d = addDays(d, 1)) {
    if (days.includes(weekdayOf(d))) count++;
  }
  return count;
}

/**
 * required_remaining ÷ days_remaining_in_window. >= cadenceDebtInfeasibleThreshold
 * means the window's target can no longer be reached without today's session.
 */
export function cadenceDebt(input: {
  stage: Stage;
  history: readonly SessionLog[]; // this stage's logs only
  windowStart: IsoDate;
  windowEnd: IsoDate; // inclusive
  today: IsoDate;
}): number {
  const { stage, history, windowStart, windowEnd, today } = input;
  const required = requiredSessionsInWindow(stage, windowStart, windowEnd);
  if (required <= 0) return 0;

  const done = history.filter(
    (h) => h.status === "done" && isInRange(h.date, windowStart, windowEnd),
  ).length;
  const requiredRemaining = Math.max(required - done, 0);
  if (requiredRemaining === 0) return 0;

  const daysRemaining = Math.max(diffDays(windowEnd, today) + 1, 1);
  return requiredRemaining / daysRemaining;
}

/**
 * Days since the stage's last done session, saturating at stalenessCapDays so a
 * long-dormant goal doesn't dominate the score forever. A never-done stage is
 * treated as neverDoneStalenessDays stale (high but finite).
 */
export function staleness(stage: Stage, history: readonly SessionLog[], today: IsoDate): number {
  const doneDates = history.filter((h) => h.status === "done").map((h) => h.date);
  const { stalenessCapDays, neverDoneStalenessDays } = SCHEDULER_CONSTANTS;

  if (doneDates.length === 0) {
    return Math.min(neverDoneStalenessDays, stalenessCapDays) / stalenessCapDays;
  }
  const lastDone = doneDates.reduce((latest, d) => (diffDays(d, latest) > 0 ? d : latest));
  const daysSince = Math.max(diffDays(today, lastDone), 0);
  return Math.min(daysSince, stalenessCapDays) / stalenessCapDays;
}

/**
 * remaining ÷ days_left, normalised against the rate actually sustained (D17, D19).
 * Cadence-only stages (no scope/target) carry no deadline pressure. Stages with a
 * deadline but not yet enough checkpoint data to measure a rate score as neutral
 * (1.0) rather than zero or infinite — matching D25's "no invented confidence."
 */
export function deadlinePressure(
  stage: Stage,
  checkpoints: readonly Checkpoint[],
  today: IsoDate,
): number {
  if (stage.scopeUnitTotal == null || stage.targetDate == null) return 0;

  const sorted = [...checkpoints].sort((a, b) => a.loggedAt.localeCompare(b.loggedAt));
  const latestValue = sorted.length > 0 ? sorted[sorted.length - 1].value : 0;
  const remaining = Math.max(stage.scopeUnitTotal - latestValue, 0);
  if (remaining === 0) return 0;

  const daysLeft = diffDays(stage.targetDate, today);
  if (daysLeft <= 0) return SCHEDULER_CONSTANTS.deadlinePressureCap;

  const requiredPerDay = remaining / daysLeft;

  let sustainedRate: number | null = null;
  if (sorted.length >= 2) {
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    const elapsedDays = diffDays(last.loggedAt.slice(0, 10), first.loggedAt.slice(0, 10));
    if (elapsedDays > 0) {
      sustainedRate = (last.value - first.value) / elapsedDays;
    }
  }

  if (sustainedRate === null || sustainedRate <= 0) {
    return 1; // neutral: no measured evidence either way
  }
  const ratio = requiredPerDay / sustainedRate;
  return Math.min(ratio, SCHEDULER_CONSTANTS.deadlinePressureCap);
}

/** Higher when fewer eligible dayparts remain today — D9. n is clamped to >= 1. */
export function scarcityMultiplier(eligibleDaypartsRemainingToday: number): number {
  const n = Math.max(eligibleDaypartsRemainingToday, 1);
  const { scarcityBase, scarcityFactor } = SCHEDULER_CONSTANTS;
  return scarcityBase + scarcityFactor / n;
}

export interface StageScore {
  cadenceDebt: number;
  deadlinePressure: number;
  staleness: number;
  pressure: number;
  scarcity: number;
  total: number;
}

export function scoreStage(input: {
  goal: Goal;
  stage: Stage;
  history: readonly SessionLog[]; // this stage's logs only
  checkpoints: readonly Checkpoint[]; // this stage's checkpoints only
  windowStart: IsoDate;
  windowEnd: IsoDate;
  today: IsoDate;
  eligibleDaypartsRemainingToday: number;
}): StageScore {
  const { goal, stage, history, checkpoints, windowStart, windowEnd, today, eligibleDaypartsRemainingToday } =
    input;

  const debt = cadenceDebt({ stage, history, windowStart, windowEnd, today });
  const deadline = deadlinePressure(stage, checkpoints, today);
  const stale = staleness(stage, history, today);
  const scarcity = scarcityMultiplier(eligibleDaypartsRemainingToday);

  const { cadenceDebtWeight, deadlinePressureWeight, stalenessWeight, tierWeight, defaultTierWeight } =
    SCHEDULER_CONSTANTS;
  const pressure = cadenceDebtWeight * debt + deadlinePressureWeight * deadline + stalenessWeight * stale;
  const tw = tierWeight[goal.tier] ?? defaultTierWeight;

  return {
    cadenceDebt: debt,
    deadlinePressure: deadline,
    staleness: stale,
    pressure,
    scarcity,
    total: tw * pressure * scarcity,
  };
}
