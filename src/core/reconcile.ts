// Check-in reconciliation (D8): pack the day's planned sessions into the time the
// user actually states they have. An exact 0/1 knapsack, not a greedy truncation
// (Architecture.md §4.2 rule 6) — three 30-minute sessions may beat one 60-minute
// session in 90 minutes. No partial sessions (D12, D27): a box that doesn't fit
// isn't scheduled.
import type { IsoDateTime, PlanSlot } from "./types";

interface Cell {
  value: number;
  count: number;
}

function isBetter(a: Cell, b: Cell): boolean {
  if (a.value !== b.value) return a.value > b.value;
  return a.count > b.count; // among equal-value picks, use the available time more fully
}

/**
 * `slots` must already be in priority order (index 0 = most important). Rank
 * position, not a separate field, supplies the knapsack's value: earlier slots are
 * worth more, but several lower-ranked sessions can still outweigh one higher-ranked
 * session when they fit better.
 *
 * **The caller must impose that order.** `layoutWeek` sorts its output by date, then
 * daypart, then `stageId` — not by priority — and Dexie returns slots in index order,
 * so neither supplies it. `features/plan/planner.ts` re-scores with `scoreStage`
 * before calling here, which is correct: priority is a function of the day it is
 * asked on (staleness and cadence debt move), not of when the plan was laid out.
 */
export function reconcileDaypart(input: {
  slots: readonly PlanSlot[];
  availableMinutes: number;
  now: IsoDateTime;
}): { keep: PlanSlot[]; dropped: PlanSlot[] } {
  const { slots } = input;
  const n = slots.length;
  const capacity = Math.max(Math.floor(input.availableMinutes), 0);

  if (n === 0 || capacity === 0) {
    return { keep: [], dropped: [...slots] };
  }

  let dp: Cell[] = Array.from({ length: capacity + 1 }, () => ({ value: 0, count: 0 }));
  const choice: boolean[][] = slots.map(() => new Array(capacity + 1).fill(false));

  for (let i = 0; i < n; i++) {
    const weight = Math.max(Math.floor(slots[i].minutes), 0);
    const value = n - i;
    const next = dp.slice();
    for (let budget = capacity; budget >= weight; budget--) {
      const withItem: Cell = { value: dp[budget - weight].value + value, count: dp[budget - weight].count + 1 };
      if (isBetter(withItem, next[budget])) {
        next[budget] = withItem;
        choice[i][budget] = true;
      }
    }
    dp = next;
  }

  const keepIndexes = new Set<number>();
  let budget = capacity;
  for (let i = n - 1; i >= 0; i--) {
    if (choice[i][budget]) {
      keepIndexes.add(i);
      budget -= Math.max(Math.floor(slots[i].minutes), 0);
    }
  }

  return {
    keep: slots.filter((_, i) => keepIndexes.has(i)),
    dropped: slots.filter((_, i) => !keepIndexes.has(i)),
  };
}
