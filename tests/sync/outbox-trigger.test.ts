// The write-trigger's discriminator.
//
// `sync/engine.ts` starts a sync when a local write is queued. It reads the outbox's
// high-water mark to decide that, and this file pins down why it cannot go back to
// reading the depth: `liveQuery` re-fires on **any** mutation to a table it observes,
// not only when the observed value changes. `settlePush` updates `attempts` on a
// rejected row, so a depth-based trigger re-armed itself on its own bookkeeping —
// sync, reject, bump, sync — one request per debounce interval for as long as the row
// stayed refused.
//
// The engine's own subscription cannot be tested here: `startSync` early-returns when
// `window` is undefined and the suite runs in node. What is testable is the property
// the trigger is built on, which is where the bug actually lived.

import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";

import { localDb } from "@/db/local/schema";
import { enqueue, getOutboxDepth, getOutboxHighWaterMark } from "@/db/local/queries";

const NOW = "2026-07-31T10:00:00";

async function reset() {
  await Promise.all(localDb.tables.map((t) => t.clear()));
}

/** What `sync/push.ts` does to a row the server refused. */
async function bumpAttempts(seq: number) {
  const row = await localDb.outbox.get(seq);
  await localDb.outbox.update(seq, { attempts: (row?.attempts ?? 0) + 1 });
}

describe("outbox high-water mark — the write trigger's discriminator", () => {
  beforeEach(reset);

  it("rises when a write is queued", async () => {
    expect(await getOutboxHighWaterMark()).toBe(0);

    await enqueue("goals", "put", "goal-1", { id: "goal-1" }, NOW);
    const afterFirst = await getOutboxHighWaterMark();
    expect(afterFirst).toBeGreaterThan(0);

    await enqueue("stages", "put", "stage-1", { id: "stage-1" }, NOW);
    expect(await getOutboxHighWaterMark()).toBeGreaterThan(afterFirst);
  });

  // The regression. Retrying a refused row must never look like a new write.
  it("does not move when a rejected row's attempts are bumped", async () => {
    await enqueue("goals", "put", "goal-1", { id: "goal-1" }, NOW);
    const [row] = await localDb.outbox.toArray();
    const before = await getOutboxHighWaterMark();

    await bumpAttempts(row.seq!);
    await bumpAttempts(row.seq!);
    await bumpAttempts(row.seq!);

    expect((await localDb.outbox.get(row.seq!))?.attempts).toBe(3);
    expect(await getOutboxHighWaterMark()).toBe(before);
    // Depth is unmoved too — which is exactly why depth could not tell the difference,
    // since `liveQuery` re-fires on the mutation regardless of the value.
    expect(await getOutboxDepth()).toBe(1);
  });

  // `++seq` is never reused, so a drained queue cannot re-arm the trigger by refilling
  // to a seq the engine has already reacted to.
  it("never reuses a seq after an ack", async () => {
    await enqueue("goals", "put", "goal-1", { id: "goal-1" }, NOW);
    const highest = await getOutboxHighWaterMark();

    await localDb.outbox.clear();
    expect(await getOutboxHighWaterMark()).toBe(0);

    await enqueue("goals", "put", "goal-2", { id: "goal-2" }, NOW);
    expect(await getOutboxHighWaterMark()).toBeGreaterThan(highest);
  });
});
