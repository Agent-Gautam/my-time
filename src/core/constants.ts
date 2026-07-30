// Every tunable coefficient the scheduler uses, in one place (Architecture.md §4.3).
// Values are deliberately unfixed guesses — DECISIONS.md "Scheduler design" says they
// get tuned once the app is in daily use. Tune here; never scatter a magic number
// through layout/score/pace/reconcile.
export const SCHEDULER_CONSTANTS = {
  // score.total = tierWeight(tier) * pressure * scarcityMultiplier(eligibleDaypartsLeftToday)
  // Coarse tiers (D10): 1 = critical, 2 = normal, 3 = background.
  tierWeight: { 1: 3, 2: 2, 3: 1 } as Record<number, number>,
  defaultTierWeight: 1,

  // pressure = cadenceDebtWeight * cadenceDebt
  //          + deadlinePressureWeight * deadlinePressure
  //          + stalenessWeight * staleness
  cadenceDebtWeight: 3,
  deadlinePressureWeight: 2,
  stalenessWeight: 1,

  // cadenceDebt = requiredRemaining / daysRemainingInWindow. >= 1.0 means "mandatory
  // today or the window's target is no longer reachable" (D15 reports this calmly).
  cadenceDebtInfeasibleThreshold: 1.0,

  // deadlinePressure is a ratio (required-per-day / sustained-rate); capped so one
  // wildly-behind stage can't blow out the whole score.
  deadlinePressureCap: 3,

  // staleness = min(daysSinceLastDone, stalenessCapDays) / stalenessCapDays.
  // Saturates so a goal that's been dormant for months doesn't dominate forever.
  stalenessCapDays: 14,
  // A stage never logged before is treated as this many days stale (high but finite).
  neverDoneStalenessDays: 14,

  // scarcityMultiplier(n) where n = count of remaining eligible dayparts today, n >= 1.
  // n = 1 (yoga, morning-only) must dominate n = 2+ (meditation) per D9.
  scarcityBase: 1,
  scarcityFactor: 3,

  // pace.ts scope projection (D25): the ± range starts wide and narrows as more
  // checkpoints accumulate ("no pace data yet" -> "±3 weeks" -> "±5 days").
  paceProjectionBaseUncertaintyDays: 21,
  paceProjectionMinUncertaintyDays: 3,

  // reconcile.ts: value assigned to the i-th slot (0-indexed) in a priority-ordered
  // input array, used as the knapsack's value function (Architecture.md §4.2 rule 6).
  reconcileRankValue: (index: number, total: number): number => total - index,
} as const;
