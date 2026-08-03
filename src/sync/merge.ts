// The merge rules. **Both sides import this file** — `sync/pull.ts` on the client and
// `app/api/sync/route.ts` on the server. That is the whole reason it exists as its own
// module: if the client and the server each carried their own copy of "does the
// incoming row win?", they would drift, and the symptom would be two devices that
// quietly never converge rather than an error anyone can see.
//
// Pure by construction: no Dexie, no Drizzle, no clock. Comparisons are on
// `IsoDateTime` **strings** (D53 — naive local wall-clock, so lexicographic order is
// chronological order, and it is the same order on both sides).
//
// Three rules, one per class of table (Architecture.md §6):
//
//   append-only  sessionLogs, checkpoints, checkIns   union — insert if absent, never
//                                                     overwrite. They are facts (D32).
//   mutable      users, dayparts, goals, stages,      last-write-wins on `updatedAt`
//                tasks, pushSubscriptions             (a task is created pending and
//                                                     answered later, so it is rewritten
//                                                     once — not a fact like a log, D68)
//   the plan     planWeeks (+ its slots)              LWW wholesale per week (D45)

import type { IsoDateTime } from "@/core/types";
import type { SyncedTable } from "@/db/local/schema";

// ---------------------------------------------------------------------------
// Append-only
// ---------------------------------------------------------------------------

const APPEND_ONLY: ReadonlySet<SyncedTable> = new Set<SyncedTable>([
  "sessionLogs",
  "checkpoints",
  "checkIns",
]);

/** True for the tables that are never rewritten — insert if absent, and stop (D32). */
export function isAppendOnly(table: SyncedTable): boolean {
  return APPEND_ONLY.has(table);
}

// ---------------------------------------------------------------------------
// Mutable rows — LWW on `updatedAt`
// ---------------------------------------------------------------------------

export interface MutableRank {
  updatedAt: IsoDateTime;
}

/**
 * Does `incoming` beat what we already hold?
 *
 * Strictly greater, so a **tie keeps the existing row** — on the client that means the
 * local row, on the server the stored one. That is not a convergence guarantee and is
 * not pretending to be: two devices that edit the same goal within the same wall-clock
 * second, offline, will each keep their own version until the next edit on either
 * device breaks the tie. Accepted for v1 (single user, small rare edits — D35); the
 * plan is the only table where a permanent split would actually be visible, and it
 * gets a real tie-break below.
 */
export function shouldApplyMutable(
  local: MutableRank | null | undefined,
  incoming: MutableRank,
): boolean {
  return local == null || incoming.updatedAt > local.updatedAt;
}

// ---------------------------------------------------------------------------
// The plan — LWW wholesale per week (D45)
// ---------------------------------------------------------------------------

export interface PlanWeekRank {
  updatedAt: IsoDateTime;
  /** Monotonic per `weekStart`, per device. Deliberately not unique across devices —
   *  see `features/plan/planner.ts`. */
  version: number;
  /** See `planWeekLineage`. */
  lineage: string;
}

/**
 * A content fingerprint for a week's slots, used only as the last tie-break.
 *
 * `planner.ts` fixes the first two keys — `updatedAt`, then `version` — and both can
 * tie for real: two devices that open the app in the same second and relayout the same
 * week both produce version N+1 with the same stamp. Stopping there and "keeping local"
 * leaves device A on A's week and device B on B's, permanently, with no error and no
 * way for the user to notice. So there is a third key, and it is deterministic: slot
 * ids sorted and joined, lexicographically greater wins. Both sides compute it from the
 * same input and agree.
 *
 * Slot ids are `plan-<stageId>-<date>` (D58), so this is a genuine description of the
 * week's shape rather than an arbitrary hash.
 */
export function planWeekLineage(slots: readonly { id: string }[]): string {
  return slots
    .map((slot) => slot.id)
    .sort()
    .join("|");
}

export function comparePlanWeek(a: PlanWeekRank, b: PlanWeekRank): number {
  if (a.updatedAt !== b.updatedAt) return a.updatedAt < b.updatedAt ? -1 : 1;
  if (a.version !== b.version) return a.version < b.version ? -1 : 1;
  if (a.lineage !== b.lineage) return a.lineage < b.lineage ? -1 : 1;
  return 0;
}

/**
 * Whether to swap in the incoming week **in its entirety**. There is no partial
 * outcome here on purpose: the caller either replaces the week and all of its slots or
 * touches nothing. Per-slot merging is the failure D45 exists to prevent.
 */
export function shouldApplyWeek(
  local: PlanWeekRank | null | undefined,
  incoming: PlanWeekRank,
): boolean {
  return local == null || comparePlanWeek(incoming, local) > 0;
}
