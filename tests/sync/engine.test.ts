// THE ENGINE — one run end to end, against a scripted server.
//
// The transport is injected (`configureSync`), so these tests exercise the real push,
// the real merge and the real Dexie mirror without a network or a Postgres. What they
// are actually checking is the part that is easy to get wrong and impossible to see
// from either half alone: that a run terminates, and that a failure costs nothing.

import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";

import { localDb } from "@/db/local/schema";
import { enqueue, getOutboxDepth } from "@/db/local/queries";
import { configureSync, getSyncEngineSnapshot, syncNow } from "@/sync/engine";
import { createMemoryMemoStore } from "@/sync/memo";
import { emptyPulledRows, type SyncRequest } from "@/sync/protocol";
import { SyncTransportError, type SyncTransport } from "@/sync/transport";

const NOW = "2026-07-30T10:00:00";

async function reset() {
  await Promise.all(localDb.tables.map((t) => t.clear()));
}

/** A server that accepts everything and has nothing to send back. */
function acceptAll(): { transport: SyncTransport; requests: SyncRequest[] } {
  const requests: SyncRequest[] = [];
  const transport: SyncTransport = async (request) => {
    requests.push(request);
    return {
      applied: request.changes.map((change) => change.seq),
      rejected: [],
      pulled: emptyPulledRows(),
      cursors: {},
      hasMore: false,
      serverTime: "2026-07-30T10:00:00.000Z",
    };
  };
  return { transport, requests };
}

function install(transport: SyncTransport) {
  configureSync({
    transport,
    memo: createMemoryMemoStore(),
    now: () => NOW,
    batchSize: 3,
  });
}

async function queue(count: number, prefix = "goal") {
  for (let i = 0; i < count; i += 1) {
    await enqueue(
      "goals",
      "put",
      `${prefix}-${i}`,
      { id: `${prefix}-${i}`, updatedAt: NOW },
      NOW,
    );
  }
}

beforeEach(async () => {
  await reset();
  install(acceptAll().transport);
});

describe("a successful run", () => {
  it("drains the outbox, sending every row exactly once", async () => {
    const { transport, requests } = acceptAll();
    install(transport);
    await queue(7);

    const outcome = await syncNow();

    expect(outcome.error).toBeNull();
    expect(outcome.pushed).toBe(7);
    expect(await getOutboxDepth()).toBe(0);

    const sent = requests.flatMap((request) => request.changes.map((c) => c.seq));
    expect(new Set(sent).size).toBe(sent.length); // no row sent twice
    expect(sent).toHaveLength(7);
    // FIFO across batches, not just within one.
    expect([...sent]).toEqual([...sent].sort((a, b) => a - b));
  });

  it("does nothing but a pull when the outbox is empty", async () => {
    const { transport, requests } = acceptAll();
    install(transport);

    const outcome = await syncNow();

    expect(outcome.pushed).toBe(0);
    expect(requests).toHaveLength(1);
    expect(requests[0].changes).toEqual([]);
  });

  it("sends a history floor so a fresh cursor cannot re-inflate the device (D47/D48)", async () => {
    const { transport, requests } = acceptAll();
    install(transport);

    await syncNow();

    // 120 days back from 2026-07-30 — LOCAL_HISTORY_WINDOW_DAYS, not a second copy
    // of the number.
    expect(requests[0].historyFloor).toBe("2026-04-01");
  });

  it("carries the cursors it was given back to the server on the next run", async () => {
    const requests: SyncRequest[] = [];
    const memo = createMemoryMemoStore();
    const transport: SyncTransport = async (request) => {
      requests.push(request);
      return {
        applied: [],
        rejected: [],
        pulled: emptyPulledRows(),
        cursors: { goals: "2026-07-30T10:00:00.000Z" },
        hasMore: false,
        serverTime: "x",
      };
    };
    configureSync({ transport, memo, now: () => NOW, batchSize: 3 });

    await syncNow();
    await syncNow();

    expect(requests[0].since).toEqual({});
    expect(requests[1].since).toEqual({ goals: "2026-07-30T10:00:00.000Z" });
  });

  it("publishes lastPullAt and clears syncing when it finishes", async () => {
    await syncNow();
    const state = getSyncEngineSnapshot();
    expect(state.syncing).toBe(false);
    expect(state.lastPullAt).toBe(NOW);
    expect(state.lastError).toBeNull();
  });
});

describe("a failed push", () => {
  it("keeps every row, records the attempt, and does not throw", async () => {
    const transport: SyncTransport = async () => {
      throw new SyncTransportError("network request failed");
    };
    install(transport);
    await queue(3);

    const outcome = await syncNow();

    expect(outcome.error).toBe("network request failed");
    expect(outcome.pushed).toBe(0);
    expect(await getOutboxDepth()).toBe(3);

    const rows = await localDb.outbox.orderBy("seq").toArray();
    expect(rows.map((row) => row.attempts)).toEqual([1, 1, 1]);
    expect(rows.map((row) => row.rowId)).toEqual(["goal-0", "goal-1", "goal-2"]);
  });

  it("drains on the retry once the server comes back", async () => {
    let failNext = true;
    const transport: SyncTransport = async (request) => {
      if (failNext) {
        failNext = false;
        throw new SyncTransportError("offline");
      }
      return {
        applied: request.changes.map((c) => c.seq),
        rejected: [],
        pulled: emptyPulledRows(),
        cursors: {},
        hasMore: false,
        serverTime: "x",
      };
    };
    install(transport);
    await queue(2);

    expect((await syncNow()).error).toBe("offline");
    expect(await getOutboxDepth()).toBe(2);

    const second = await syncNow();
    expect(second.error).toBeNull();
    expect(await getOutboxDepth()).toBe(0);
  });

  it("surfaces the failure as status, never as something to act on (D46)", async () => {
    install(async () => {
      throw new SyncTransportError("offline");
    });
    await syncNow();
    expect(getSyncEngineSnapshot().lastError).toBe("offline");
    expect(getSyncEngineSnapshot().syncing).toBe(false);
  });
});

describe("termination", () => {
  it("stops instead of re-peeking a head the server keeps refusing", async () => {
    let calls = 0;
    const transport: SyncTransport = async (request) => {
      calls += 1;
      return {
        applied: [],
        rejected: request.changes.map((change) => ({
          seq: change.seq,
          reason: "violates foreign key constraint",
        })),
        pulled: emptyPulledRows(),
        cursors: {},
        hasMore: false,
        serverTime: "x",
      };
    };
    install(transport);
    await queue(3);

    const outcome = await syncNow();

    // One round, then it gives up until the next trigger — not a loop over the same
    // three rows.
    expect(calls).toBe(1);
    expect(outcome.rejected).toBe(3);
    expect(await getOutboxDepth()).toBe(3);
    expect((await localDb.outbox.toArray()).every((row) => row.attempts === 1)).toBe(true);
  });

  it("pages a pull until the server says it is done, and no further", async () => {
    let page = 0;
    const transport: SyncTransport = async () => {
      page += 1;
      return {
        applied: [],
        rejected: [],
        pulled: {
          ...emptyPulledRows(),
          goals: [
            {
              id: `goal-page-${page}`,
              name: `page ${page}`,
              purpose: "p",
              tier: 1,
              state: "active" as const,
              updatedAt: NOW,
              deletedAt: null,
            },
          ],
        },
        cursors: { goals: `cursor-${page}` },
        // Three pages, then done. If the loop keyed off "rows arrived" instead of
        // this flag it would never stop — the server re-sends an overlap by design.
        hasMore: page < 3,
        serverTime: "x",
      };
    };
    install(transport);

    const outcome = await syncNow();

    expect(page).toBe(3);
    expect(outcome.pulled).toBe(3);
    expect(await localDb.goals.count()).toBe(3);
  });

  it("cannot spin forever even if the server always says hasMore", async () => {
    let calls = 0;
    install(async () => {
      calls += 1;
      return {
        applied: [],
        rejected: [],
        pulled: emptyPulledRows(),
        cursors: {},
        hasMore: true,
        serverTime: "x",
      };
    });

    const outcome = await syncNow();

    expect(outcome.rounds).toBe(20); // MAX_ROUNDS
    expect(calls).toBe(20);
  });
});

describe("concurrent triggers", () => {
  it("coalesce into one run rather than pushing the same batch twice", async () => {
    const { transport, requests } = acceptAll();
    install(transport);
    await queue(4);

    const [a, b, c] = await Promise.all([syncNow(), syncNow(), syncNow()]);

    expect(a).toBe(b);
    expect(b).toBe(c);
    const sent = requests.flatMap((request) => request.changes.map((change) => change.seq));
    expect(new Set(sent).size).toBe(sent.length);
    expect(await getOutboxDepth()).toBe(0);
  });
});

describe("push and pull in one round trip", () => {
  it("applies the server's changes and drains the outbox together", async () => {
    const transport: SyncTransport = async (request) => ({
      applied: request.changes.map((change) => change.seq),
      rejected: [],
      pulled: {
        ...emptyPulledRows(),
        planWeeks: [
          {
            week: {
              id: "week-2026-07-27",
              weekStart: "2026-07-27",
              version: 3,
              updatedAt: "2026-07-30T11:00:00",
            },
            slots: [
              {
                id: "plan-stage-1-2026-07-27",
                stageId: "stage-1",
                weekStart: "2026-07-27",
                date: "2026-07-27",
                daypartId: "daypart-morning",
                minutes: 30,
                planWeekId: "week-2026-07-27",
              },
            ],
          },
        ],
      },
      cursors: {},
      hasMore: false,
      serverTime: "x",
    });
    install(transport);
    await queue(2);

    const outcome = await syncNow();

    expect(outcome.pushed).toBe(2);
    expect(outcome.weeksApplied).toBeGreaterThanOrEqual(1);
    expect(await getOutboxDepth()).toBe(0);
    expect(await localDb.planSlots.count()).toBe(1);
  });
});
