// PUSH — drain the outbox.
//
// The invariant this file exists to hold: **a queued write is never lost and never
// acked twice.** `peekOutbox` reads a bounded FIFO batch by `seq`, the server reports
// per-change what it durably stored, and only those seqs are deleted. A row the server
// refused stays exactly where it was, keeps its place in the queue, and is counted by
// the always-visible pending indicator (D46).
//
// Bounded by construction (D47): `peekOutbox(limit)` is an indexed range with a limit,
// never `.toArray()` on the table.

import { localDb, type OutboxRow, type SyncedTable } from "@/db/local/schema";
import { ackOutbox, peekOutbox } from "@/db/local/queries";

import type { RejectedChange, SyncChange, SyncResponse } from "./protocol";

/** One request's worth of outbox. Small: pushes are frequent and mostly empty. */
export const PUSH_BATCH_SIZE = 50;

export interface PushBatch {
  changes: SyncChange[];
  /** The seqs in this batch, so `settlePush` can only ever ack what it actually sent. */
  seqs: number[];
}

/**
 * The head of the queue, in `seq` order.
 *
 * Order is not a nicety — it is what satisfies the server's foreign keys. A goal is
 * enqueued before its stage (`mutations.putGoalWithStage`), a stage before the plan
 * that references it, and the server applies changes in the order they arrive.
 *
 * A `planWeeks` row already carries `{ week, slots }` as its payload (D45,
 * `planner.relayoutWeek`) — it is passed through untouched. Nothing here ever splits a
 * week into slots, and `planSlots` never appears in the outbox at all.
 */
export async function collectPush(limit = PUSH_BATCH_SIZE): Promise<PushBatch> {
  const rows = await peekOutbox(limit);
  const changes = rows.filter(hasSeq).map(
    (row): SyncChange => ({
      seq: row.seq,
      table: row.table,
      op: row.op,
      rowId: row.rowId,
      payload: row.payload,
      queuedAt: row.queuedAt,
    }),
  );
  return { changes, seqs: changes.map((change) => change.seq) };
}

function hasSeq(row: OutboxRow): row is OutboxRow & { seq: number } {
  return typeof row.seq === "number";
}

export interface PushOutcome {
  sent: number;
  acked: number;
  rejected: RejectedChange[];
}

/**
 * Delete what the server confirmed; leave everything else queued.
 *
 * Two guards, both against the same class of bug:
 *
 *   - `applied` is intersected with the seqs we actually sent, so a malformed or
 *     replayed response cannot delete a row that was queued *after* this batch was
 *     read. That row has never been to the server.
 *   - Rejected rows get `attempts + 1` and stay. Nothing is ever dropped for having
 *     failed too often — a write the user made is not the app's to discard. It stays
 *     visible in the pending count until it lands (D46).
 */
export async function settlePush(
  batch: PushBatch,
  response: Pick<SyncResponse, "applied" | "rejected">,
): Promise<PushOutcome> {
  const sentSeqs = new Set(batch.seqs);
  // Deduplicated as well as filtered. `bulkDelete` would shrug off a repeat, but the
  // count is summed into the run's `pushed` total, and a run reporting that it drained
  // more rows than the outbox ever held is exactly the kind of thing that hides a real
  // double-ack later.
  const acked = [...new Set(response.applied.filter((seq) => sentSeqs.has(seq)))];
  const rejected = response.rejected.filter((row) => sentSeqs.has(row.seq));

  if (acked.length > 0) await ackOutbox(acked);
  if (rejected.length > 0) await bumpAttempts(rejected.map((row) => row.seq));

  return { sent: batch.seqs.length, acked: acked.length, rejected };
}

/** Retry bookkeeping after a whole request failed — nothing reached the server. */
export async function recordPushFailure(batch: PushBatch): Promise<void> {
  if (batch.seqs.length > 0) await bumpAttempts(batch.seqs);
}

/**
 * `attempts` is on `OutboxRow` and nothing increments it — there is no
 * `bumpOutboxAttempts` in `db/local/queries.ts`, and adding one is not this track's to
 * do, so the update happens here. Reported as a query gap.
 */
async function bumpAttempts(seqs: number[]): Promise<void> {
  await localDb.transaction("rw", localDb.outbox, async () => {
    for (const seq of seqs) {
      const row = await localDb.outbox.get(seq);
      if (row) await localDb.outbox.update(seq, { attempts: row.attempts + 1 });
    }
  });
}

/** For diagnostics: which tables are stuck, if the queue stops draining. */
export function tablesIn(batch: PushBatch): SyncedTable[] {
  return [...new Set(batch.changes.map((change) => change.table))];
}
