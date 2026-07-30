// Domain writes against the Dexie mirror. `queries.ts` is the read half; this is
// the write half, and it is the only sanctioned way the UI changes anything.
//
// ---------------------------------------------------------------------------
// THE RULE THIS FILE EXISTS TO ENFORCE
// ---------------------------------------------------------------------------
// **Every mutation writes the row and enqueues its outbox row in one `rw`
// transaction.** A local write that never reached the outbox is a silent
// data-loss bug: the device shows it, the server never hears about it, and the
// next pull quietly reverts it. The two writes must not be separable, so they are
// not exposed separately — there is no "write now, queue later" entry point here.
//
// `now` is a parameter rather than a clock read (the D34 habit outside `core/`),
// which keeps callers testable. It must be a **local wall-clock** `IsoDateTime` —
// see the convention in `lib/daypart.ts`; use `localNow()`.
//
// Nothing here hard-deletes. Lifecycle is a state change, and history is
// append-only (D48).

import type {
  CheckIn,
  Checkpoint,
  Daypart,
  Goal,
  IsoDateTime,
  SessionLog,
  Stage,
} from "@/core/types";

import {
  localDb,
  type LocalCheckIn,
  type LocalCheckpoint,
  type LocalDaypart,
  type LocalGoal,
  type LocalSessionLog,
  type LocalStage,
  type LocalUser,
} from "./schema";
import { enqueue } from "./queries";

/** Ids are generated on the device that creates the row and never reassigned. */
export function newId(): string {
  return crypto.randomUUID();
}

/** Bookkeeping carried by every mutable synced row (schema.ts `Mutable`). */
const mutable = (now: IsoDateTime) => ({ updatedAt: now, deletedAt: null });

// ---------------------------------------------------------------------------
// Mutable rows — small, rarely edited, last-write-wins on `updatedAt` (§6)
// ---------------------------------------------------------------------------

export async function putUser(
  user: { id: string; email: string | null },
  now: IsoDateTime,
): Promise<LocalUser> {
  const row: LocalUser = { ...user, ...mutable(now) };
  await localDb.transaction("rw", localDb.users, localDb.outbox, async () => {
    await localDb.users.put(row);
    await enqueue("users", "put", row.id, row, now);
  });
  return row;
}

export async function putDaypart(
  daypart: Daypart,
  now: IsoDateTime,
): Promise<LocalDaypart> {
  const row: LocalDaypart = { ...daypart, ...mutable(now) };
  await localDb.transaction("rw", localDb.dayparts, localDb.outbox, async () => {
    await localDb.dayparts.put(row);
    await enqueue("dayparts", "put", row.id, row, now);
  });
  return row;
}

export async function putGoal(goal: Goal, now: IsoDateTime): Promise<LocalGoal> {
  const row: LocalGoal = { ...goal, ...mutable(now) };
  await localDb.transaction("rw", localDb.goals, localDb.outbox, async () => {
    await localDb.goals.put(row);
    await enqueue("goals", "put", row.id, row, now);
  });
  return row;
}

export async function putStage(stage: Stage, now: IsoDateTime): Promise<LocalStage> {
  const row: LocalStage = { ...stage, ...mutable(now) };
  await localDb.transaction("rw", localDb.stages, localDb.outbox, async () => {
    await localDb.stages.put(row);
    await enqueue("stages", "put", row.id, row, now);
  });
  return row;
}

/**
 * A goal and its one implicit stage save together (PRD §6.3) — the protocol fields
 * live on the stage, and a half-saved goal would be a goal the scheduler cannot
 * see. One transaction, two rows, two outbox entries.
 */
export async function putGoalWithStage(
  goal: Goal,
  stage: Stage,
  now: IsoDateTime,
): Promise<{ goal: LocalGoal; stage: LocalStage }> {
  const goalRow: LocalGoal = { ...goal, ...mutable(now) };
  const stageRow: LocalStage = { ...stage, goalId: goal.id, ...mutable(now) };

  await localDb.transaction(
    "rw",
    localDb.goals,
    localDb.stages,
    localDb.outbox,
    async () => {
      await localDb.goals.put(goalRow);
      await localDb.stages.put(stageRow);
      await enqueue("goals", "put", goalRow.id, goalRow, now);
      await enqueue("stages", "put", stageRow.id, stageRow, now);
    },
  );

  return { goal: goalRow, stage: stageRow };
}

/**
 * Drop a goal (D48: **never a hard delete**). The goal keeps its history and its
 * stages; it simply stops being scheduled, because `layoutWeek` only ever sees
 * active goals.
 *
 * Note for callers: this does **not** change the stages' own `state`, since
 * `StageState` has no "dropped" member — a stage's liveness is its goal's. Any
 * read that counts active stages must therefore join goal state, which is what
 * `queries.getDaypartCapacity` does.
 *
 * The caller re-lays-out afterwards (`planner.relayoutWeek`) to clear the dropped
 * goal's future slots.
 */
export async function dropGoal(goalId: string, now: IsoDateTime): Promise<void> {
  await localDb.transaction("rw", localDb.goals, localDb.outbox, async () => {
    const existing = await localDb.goals.get(goalId);
    if (!existing) return;
    const row: LocalGoal = { ...existing, state: "dropped", ...mutable(now) };
    await localDb.goals.put(row);
    await enqueue("goals", "put", row.id, row, now);
  });
}

// ---------------------------------------------------------------------------
// Append-only facts — union on sync, no conflict possible (§6)
// ---------------------------------------------------------------------------

/**
 * Record what actually happened. `source: "voluntary"` is how catch-up gets
 * credited against the ideal line without ever being imposed as debt (D20) —
 * `"planned"` is the one-tap done/skipped on a scheduled session.
 */
export async function logSession(
  log: Omit<SessionLog, "id" | "loggedAt"> & { id?: string },
  now: IsoDateTime,
): Promise<LocalSessionLog> {
  const row: LocalSessionLog = { ...log, id: log.id ?? newId(), loggedAt: now };
  await localDb.transaction("rw", localDb.sessionLogs, localDb.outbox, async () => {
    await localDb.sessionLogs.put(row);
    await enqueue("sessionLogs", "put", row.id, row, now);
  });
  return row;
}

/** Coarse progress — "which chapter are you on?" Never what was inside a session (D12). */
export async function putCheckpoint(
  checkpoint: Omit<Checkpoint, "id" | "loggedAt"> & { id?: string },
  now: IsoDateTime,
): Promise<LocalCheckpoint> {
  const row: LocalCheckpoint = {
    ...checkpoint,
    id: checkpoint.id ?? newId(),
    loggedAt: now,
  };
  await localDb.transaction("rw", localDb.checkpoints, localDb.outbox, async () => {
    await localDb.checkpoints.put(row);
    await enqueue("checkpoints", "put", row.id, row, now);
  });
  return row;
}

/** The daypart and available minutes the user stated on arrival (D8). */
export async function putCheckIn(
  checkIn: Omit<CheckIn, "id" | "checkedInAt"> & { id?: string },
  now: IsoDateTime,
): Promise<LocalCheckIn> {
  const row: LocalCheckIn = {
    ...checkIn,
    id: checkIn.id ?? newId(),
    checkedInAt: now,
  };
  await localDb.transaction("rw", localDb.checkIns, localDb.outbox, async () => {
    await localDb.checkIns.put(row);
    await enqueue("checkIns", "put", row.id, row, now);
  });
  return row;
}
