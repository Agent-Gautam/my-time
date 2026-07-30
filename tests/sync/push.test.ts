// PUSH against a real IndexedDB (`fake-indexeddb`, D55) — the outbox is the one place
// in this app where a bug means *silently losing something the user did*, so these
// tests are about exactly two properties: a queued row is never lost, and a queued row
// is never acked twice.

import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";

import { localDb } from "@/db/local/schema";
import { enqueue, getOutboxDepth } from "@/db/local/queries";
import { collectPush, recordPushFailure, settlePush } from "@/sync/push";

const NOW = "2026-07-30T10:00:00";

async function reset() {
  await Promise.all(localDb.tables.map((t) => t.clear()));
}

beforeEach(reset);

/** Queue `count` goal writes and return their seqs in FIFO order. */
async function queueGoals(count: number): Promise<number[]> {
  for (let i = 0; i < count; i += 1) {
    await enqueue("goals", "put", `goal-${i}`, { id: `goal-${i}`, updatedAt: NOW }, NOW);
  }
  const rows = await localDb.outbox.orderBy("seq").toArray();
  return rows.map((row) => row.seq!);
}

describe("collectPush", () => {
  it("returns the head of the queue in seq order", async () => {
    const seqs = await queueGoals(5);
    const batch = await collectPush(10);
    expect(batch.seqs).toEqual(seqs);
    expect(batch.changes.map((c) => c.rowId)).toEqual([
      "goal-0",
      "goal-1",
      "goal-2",
      "goal-3",
      "goal-4",
    ]);
  });

  it("is bounded — never the whole table (D47)", async () => {
    const seqs = await queueGoals(120);
    const batch = await collectPush(50);
    expect(batch.seqs).toEqual(seqs.slice(0, 50));
  });

  it("passes a plan week through as one change carrying its slots (D45)", async () => {
    const week = { id: "week-2026-07-27", weekStart: "2026-07-27", version: 3, updatedAt: NOW };
    const slots = [{ id: "plan-stage-1-2026-07-27" }, { id: "plan-stage-1-2026-07-28" }];
    await enqueue("planWeeks", "put", week.id, { week, slots }, NOW);

    const batch = await collectPush();
    expect(batch.changes).toHaveLength(1);
    expect(batch.changes[0].table).toBe("planWeeks");
    expect(batch.changes[0].payload).toEqual({ week, slots });
  });
});

describe("settlePush", () => {
  it("deletes exactly what the server confirmed and nothing else", async () => {
    const seqs = await queueGoals(4);
    const batch = await collectPush();

    const outcome = await settlePush(batch, { applied: seqs, rejected: [] });

    expect(outcome.acked).toBe(4);
    expect(await getOutboxDepth()).toBe(0);
  });

  it("leaves a rejected row queued, in place, with attempts incremented", async () => {
    const seqs = await queueGoals(3);
    const batch = await collectPush();

    await settlePush(batch, {
      applied: [seqs[0], seqs[2]],
      rejected: [{ seq: seqs[1], reason: "stage_id violates foreign key" }],
    });

    const remaining = await localDb.outbox.orderBy("seq").toArray();
    expect(remaining.map((row) => row.seq)).toEqual([seqs[1]]);
    expect(remaining[0].attempts).toBe(1);
    // Never dropped, however often it fails — a write the user made is not the app's
    // to discard.
    expect(remaining[0].rowId).toBe("goal-1");
  });

  it("will not ack a row that was queued after the batch was read", async () => {
    const first = await queueGoals(2);
    const batch = await collectPush();

    // A write lands mid-flight. It has never been to the server.
    await enqueue("goals", "put", "goal-late", { id: "goal-late", updatedAt: NOW }, NOW);
    const late = (await localDb.outbox.orderBy("seq").toArray()).at(-1)!.seq!;

    // A confused or replayed response claims it too.
    await settlePush(batch, { applied: [...first, late], rejected: [] });

    const remaining = await localDb.outbox.toArray();
    expect(remaining.map((row) => row.rowId)).toEqual(["goal-late"]);
  });

  it("acks each seq once — a duplicate in `applied` cannot delete twice", async () => {
    const seqs = await queueGoals(2);
    const batch = await collectPush();

    const outcome = await settlePush(batch, {
      applied: [seqs[0], seqs[0], seqs[1]],
      rejected: [],
    });

    // The duplicate is counted, but the delete is idempotent and nothing else went
    // with it.
    expect(outcome.acked).toBe(3);
    expect(await getOutboxDepth()).toBe(0);
  });
});

describe("recordPushFailure", () => {
  it("loses nothing when the whole request fails", async () => {
    await queueGoals(3);
    const batch = await collectPush();

    await recordPushFailure(batch);

    const rows = await localDb.outbox.orderBy("seq").toArray();
    expect(rows).toHaveLength(3);
    expect(rows.map((row) => row.attempts)).toEqual([1, 1, 1]);
    // Still FIFO, still the same rows.
    expect(rows.map((row) => row.rowId)).toEqual(["goal-0", "goal-1", "goal-2"]);
  });

  it("accumulates attempts across retries", async () => {
    await queueGoals(1);
    await recordPushFailure(await collectPush());
    await recordPushFailure(await collectPush());
    await recordPushFailure(await collectPush());

    const rows = await localDb.outbox.toArray();
    expect(rows[0].attempts).toBe(3);
  });
});
