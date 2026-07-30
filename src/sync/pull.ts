// PULL — apply what the server sent, by the rules in `merge.ts`.
//
// Three classes of table, three rules, and the differences between them are the whole
// substance of this file:
//
//   append-only   sessionLogs · checkpoints · checkIns
//                 Insert if absent. **Never overwrite.** These are facts (D32) — a
//                 pull that rewrote a logged session would be the app editing history.
//
//   mutable       users · dayparts · goals · stages · pushSubscriptions
//                 Last-write-wins on `updatedAt`, compared as strings (D53). A local
//                 row edited more recently than the server's copy survives the pull,
//                 which is what makes an unsynced local edit safe.
//
//   the plan      planWeeks (+ every slot it carries)
//                 Wholesale per week (D45). Either the incoming week replaces the local
//                 one entirely — via `replacePlanWeek`, one transaction — or nothing is
//                 touched. There is no code path here that merges slots.
//
// **Nothing in this file enqueues.** Applying a pull writes to the mirror only; it must
// not put anything back in the outbox, or two devices would push each other's plans
// back and forth forever. That is why `replacePlanWeek` leaves queueing to its caller
// and why the mutable tables are written through Dexie directly rather than through
// `db/local/mutations.ts` (whose entire contract is "write *and* enqueue").

import { getPlanSlotsForWeek, getPlanWeek, replacePlanWeek } from "@/db/local/queries";
import {
  localDb,
  type LocalCheckIn,
  type LocalCheckpoint,
  type LocalDaypart,
  type LocalGoal,
  type LocalPlanSlot,
  type LocalSessionLog,
  type LocalStage,
  type LocalUser,
} from "@/db/local/schema";
import type { Table } from "dexie";

import { planWeekLineage, shouldApplyMutable, shouldApplyWeek } from "./merge";
import type {
  PulledRows,
  WireCheckIn,
  WireCheckpoint,
  WireDaypart,
  WireGoal,
  WirePlanSlot,
  WirePlanWeekBundle,
  WireSessionLog,
  WireStage,
  WireUser,
} from "./protocol";

export interface ApplyOutcome {
  /** Rows written. Not rows received — a pull that loses every LWW race writes zero. */
  applied: number;
  /** Weeks swapped wholesale. */
  weeksApplied: number;
}

export async function applyPull(pulled: PulledRows): Promise<ApplyOutcome> {
  let applied = 0;

  applied += await applyMutable(localDb.users, pulled.users);
  applied += await applyMutable(localDb.dayparts, pulled.dayparts as LocalDaypart[]);
  applied += await applyMutable(localDb.goals, pulled.goals as LocalGoal[]);
  applied += await applyMutable(localDb.stages, pulled.stages as LocalStage[]);
  applied += await applyMutable(localDb.pushSubscriptions, pulled.pushSubscriptions);

  applied += await applyAppendOnly(localDb.sessionLogs, pulled.sessionLogs);
  applied += await applyAppendOnly(localDb.checkpoints, pulled.checkpoints);
  applied += await applyAppendOnly(localDb.checkIns, pulled.checkIns);

  let weeksApplied = 0;
  for (const bundle of pulled.planWeeks) {
    if (await applyPlanWeek(bundle)) weeksApplied += 1;
  }

  return { applied: applied + weeksApplied, weeksApplied };
}

// ---------------------------------------------------------------------------
// Mutable — last-write-wins on `updatedAt`
// ---------------------------------------------------------------------------

type MutableRow = { id: string; updatedAt: string };

/**
 * One `bulkGet` and one `bulkPut` per table rather than a read/write pair per row: the
 * incoming page is already bounded by the server's limit, and the local lookup is by
 * primary key.
 *
 * The compare-then-write pair sits inside one transaction so a local write landing
 * mid-apply cannot be overwritten by a decision taken before it existed.
 */
async function applyMutable<T extends MutableRow>(
  table: Table<T, string>,
  incoming: T[],
): Promise<number> {
  if (incoming.length === 0) return 0;

  return localDb.transaction("rw", table, async () => {
    const existing = await table.bulkGet(incoming.map((row) => row.id));
    const winners = incoming.filter((row, index) =>
      shouldApplyMutable(existing[index] ?? null, row),
    );
    if (winners.length > 0) await table.bulkPut(winners);
    return winners.length;
  });
}

// ---------------------------------------------------------------------------
// Append-only — union, insert if absent
// ---------------------------------------------------------------------------

/**
 * `bulkAdd` with `allKeys` would throw on the first collision; `put` would overwrite,
 * which is the bug this rule exists to prevent. So: read the ids, keep the ones that
 * are absent, add only those.
 *
 * The re-check happens inside the transaction because the server deliberately re-sends
 * a small overlap of rows on every pull (see the cursor rewind in the route handler) —
 * so collisions here are the normal case, not an anomaly.
 */
async function applyAppendOnly<T extends { id: string }>(
  table: Table<T, string>,
  incoming: T[],
): Promise<number> {
  if (incoming.length === 0) return 0;

  return localDb.transaction("rw", table, async () => {
    const existing = await table.bulkGet(incoming.map((row) => row.id));
    const fresh = incoming.filter((_, index) => existing[index] === undefined);
    if (fresh.length > 0) await table.bulkAdd(fresh);
    return fresh.length;
  });
}

// ---------------------------------------------------------------------------
// The plan — wholesale per week (D45)
// ---------------------------------------------------------------------------

/**
 * Swap in a whole week, or leave the local one alone.
 *
 * The comparison keys are `planner.relayoutWeek`'s, not new ones: `updatedAt` first,
 * `version` as the tie-break and as the signal that the remote week is a *different
 * lineage* rather than a no-op, then the slot-id fingerprint so a true double tie still
 * resolves the same way on both devices (`merge.ts`).
 *
 * The remote week is written **verbatim** — its `version` and `updatedAt` are adopted
 * as they arrived, not bumped. Bumping would make the applying device look like the
 * later writer, and the two devices would trade the week back and forth on every sync.
 */
async function applyPlanWeek(bundle: WirePlanWeekBundle): Promise<boolean> {
  const { week, slots } = bundle;

  const local = await getPlanWeek(week.weekStart);
  if (local) {
    const localSlots = await getPlanSlotsForWeek(week.weekStart);
    const decision = shouldApplyWeek(
      {
        updatedAt: local.updatedAt,
        version: local.version,
        lineage: planWeekLineage(localSlots),
      },
      { updatedAt: week.updatedAt, version: week.version, lineage: planWeekLineage(slots) },
    );
    if (!decision) return false;
  }

  await replacePlanWeek(
    {
      id: week.id,
      weekStart: week.weekStart,
      version: week.version,
      updatedAt: week.updatedAt,
    },
    slots as LocalPlanSlot[],
  );
  return true;
}

// The wire shapes must stay assignable to the local ones, or a pull would silently
// write rows the UI's queries cannot read. Compile-time only, zero runtime cost — and
// it fails the build rather than the app if `protocol.ts` and `db/local/schema.ts` drift
// apart.
type MustExtend<Local, Wire extends Local> = Wire;

export type WireRowsMatchLocalRows = [
  MustExtend<LocalUser, WireUser>,
  MustExtend<LocalDaypart, WireDaypart>,
  MustExtend<LocalGoal, WireGoal>,
  MustExtend<LocalStage, WireStage>,
  MustExtend<LocalSessionLog, WireSessionLog>,
  MustExtend<LocalCheckpoint, WireCheckpoint>,
  MustExtend<LocalCheckIn, WireCheckIn>,
  MustExtend<LocalPlanSlot, WirePlanSlot>,
];
