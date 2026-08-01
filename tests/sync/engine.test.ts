// THE ENGINE — one run end to end, against a scripted server.
//
// The transport is injected (`configureSync`), so these tests exercise the real push,
// the real merge and the real Dexie mirror without a network or a Postgres. What they
// are actually checking is the part that is easy to get wrong and impossible to see
// from either half alone: that a run terminates, and that a failure costs nothing.

import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";

import { localDb, type LocalGoal } from "@/db/local/schema";
import { enqueue, getOutboxDepth } from "@/db/local/queries";
import { putGoal } from "@/db/local/mutations";
import {
  configureSync,
  getSyncEngineSnapshot,
  syncNow,
  type RelayoutAfterPull,
} from "@/sync/engine";
import { createMemoryMemoStore } from "@/sync/memo";
import { emptyPulledRows, type PulledRows, type SyncRequest } from "@/sync/protocol";
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

// ---------------------------------------------------------------------------
// Re-planning after a pull (D62)
// ---------------------------------------------------------------------------

/** A server that hands over `rows` on the first round only, then goes quiet. */
function serves(rows: Partial<PulledRows>): SyncTransport {
  let served = false;
  return async (request) => {
    const pulled = served ? emptyPulledRows() : { ...emptyPulledRows(), ...rows };
    served = true;
    return {
      applied: request.changes.map((change) => change.seq),
      rejected: [],
      pulled,
      cursors: {},
      hasMore: false,
      serverTime: "x",
    };
  };
}

function remoteGoal(over: Partial<LocalGoal> = {}): LocalGoal {
  return {
    id: "goal-remote",
    name: "Gym",
    purpose: "fitness",
    tier: 1,
    state: "active",
    updatedAt: NOW,
    deletedAt: null,
    ...over,
  };
}

/** Records every relayout the engine asks for, so tests can count them. */
function spyRelayout(): { hook: RelayoutAfterPull; calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    hook: async (now) => {
      calls.push(now);
    },
  };
}

describe("re-planning after a pull (D62)", () => {
  it("re-plans when a pull brings down a goal — the bug this exists for", async () => {
    // A device that receives someone else's goals kept whatever plan it already had:
    // the goals appeared and Today stayed empty, because nothing outside the four
    // editing screens ever called `relayoutWeek`.
    const { hook, calls } = spyRelayout();
    configureSync({
      transport: serves({ goals: [remoteGoal()] }),
      memo: createMemoryMemoStore(),
      now: () => NOW,
      batchSize: 3,
      onSchedulingInputsChanged: hook,
    });

    await syncNow();

    // Called with the engine's clock, not one of its own (D53).
    expect(calls).toEqual([NOW]);
  });

  it("does not re-plan when the pull was empty", async () => {
    const { hook, calls } = spyRelayout();
    configureSync({
      transport: acceptAll().transport,
      memo: createMemoryMemoStore(),
      now: () => NOW,
      batchSize: 3,
      onSchedulingInputsChanged: hook,
    });
    await queue(2);

    await syncNow();

    expect(calls).toEqual([]);
  });

  it("does not re-plan for session logs alone (D62's named exclusion)", async () => {
    const { hook, calls } = spyRelayout();
    configureSync({
      transport: serves({
        sessionLogs: [
          {
            id: "log-1",
            stageId: "stage-1",
            date: "2026-07-30",
            daypartId: "daypart-morning",
            minutes: 30,
            status: "done",
            source: "planned",
            loggedAt: NOW,
          },
        ],
      }),
      memo: createMemoryMemoStore(),
      now: () => NOW,
      batchSize: 3,
      onSchedulingInputsChanged: hook,
    });

    await syncNow();

    expect(calls).toEqual([]);
    expect(await localDb.sessionLogs.count()).toBe(1); // it did arrive
  });

  it("does not re-plan on an incoming plan week — that is layout's output, not its input", async () => {
    // The loop guard. If applying a week counted as an input change, two devices
    // would re-plan each other's plans forever.
    const { hook, calls } = spyRelayout();
    configureSync({
      transport: serves({
        planWeeks: [
          {
            week: {
              id: "week-2026-07-27",
              weekStart: "2026-07-27",
              version: 3,
              updatedAt: NOW,
            },
            slots: [],
          },
        ],
      }),
      memo: createMemoryMemoStore(),
      now: () => NOW,
      batchSize: 3,
      onSchedulingInputsChanged: hook,
    });

    const outcome = await syncNow();

    expect(outcome.weeksApplied).toBe(1); // the week really was applied
    expect(calls).toEqual([]);
  });

  it("does not re-plan for a goal that lost the LWW race — nothing was written", async () => {
    await putGoal(
      { id: "goal-remote", name: "Lifting", purpose: "fitness", tier: 1, state: "active" },
      "2026-07-30T11:00:00",
    );
    const { hook, calls } = spyRelayout();
    configureSync({
      transport: serves({ goals: [remoteGoal({ updatedAt: "2026-07-30T09:00:00" })] }),
      memo: createMemoryMemoStore(),
      now: () => NOW,
      batchSize: 3,
      onSchedulingInputsChanged: hook,
    });

    await syncNow();

    expect(calls).toEqual([]);
    expect((await localDb.goals.get("goal-remote"))!.name).toBe("Lifting");
  });

  it("re-plans once per run, not once per round", async () => {
    // Four queued rows at batchSize 3 is two rounds; the goal arrives in the first.
    const { hook, calls } = spyRelayout();
    configureSync({
      transport: serves({ goals: [remoteGoal()] }),
      memo: createMemoryMemoStore(),
      now: () => NOW,
      batchSize: 3,
      onSchedulingInputsChanged: hook,
    });
    await queue(4);

    await syncNow();

    expect(calls).toHaveLength(1);
  });

  it("re-plans exactly once across runs — a second sync does not re-plan", async () => {
    // What keeps the write-trigger from becoming a loop: the outbox row the relayout
    // leaves behind causes one more sync, and that sync pulls nothing new.
    const { hook, calls } = spyRelayout();
    configureSync({
      transport: serves({ goals: [remoteGoal()] }),
      memo: createMemoryMemoStore(),
      now: () => NOW,
      batchSize: 3,
      onSchedulingInputsChanged: hook,
    });

    await syncNow();
    await syncNow();
    await syncNow();

    expect(calls).toHaveLength(1);
  });

  it("retries on the next run when the relayout itself throws", async () => {
    // The debt outlives the failed attempt: no second pull is coming to re-raise it,
    // because the rows are already in the mirror.
    let failNext = true;
    const calls: string[] = [];
    configureSync({
      transport: serves({ goals: [remoteGoal()] }),
      memo: createMemoryMemoStore(),
      now: () => NOW,
      batchSize: 3,
      onSchedulingInputsChanged: async (now) => {
        if (failNext) {
          failNext = false;
          throw new Error("layout blew up");
        }
        calls.push(now);
      },
    });

    const first = await syncNow();
    expect(first.error).toBe("layout blew up");
    expect(calls).toEqual([]);

    await syncNow();

    expect(calls).toEqual([NOW]);
  });

  it("does not wedge when no relayout was ever registered", async () => {
    // `configureSync` without the hook is most of the existing suite.
    configureSync({
      transport: serves({ goals: [remoteGoal()] }),
      memo: createMemoryMemoStore(),
      now: () => NOW,
      batchSize: 3,
    });

    const outcome = await syncNow();

    expect(outcome.error).toBeNull();
  });
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

  it("stops pushing on a short batch rather than spending an empty round trip", async () => {
    const { transport, requests } = acceptAll();
    install(transport); // batchSize 3
    await queue(4);

    await syncNow();

    // 3 then 1 — and no third request just to be told the queue is empty.
    expect(requests).toHaveLength(2);
    expect(requests.map((r) => r.changes.length)).toEqual([3, 1]);
    expect(await getOutboxDepth()).toBe(0);
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

// ---------------------------------------------------------------------------
// A rejected sync key (D59)
// ---------------------------------------------------------------------------
//
// The failure this guards against is not the 401 itself — it is what the engine used to
// do with one. Every `!response.ok` becomes a `SyncTransportError`, and the catch
// treated them all as "worth retrying", so a wrong or rotated key meant an outbox that
// retried forever, never drained, and rendered as an ordinary `pending` the user had no
// way to interpret.
describe("when the server rejects the sync key", () => {
  // Note on what is checkable here: `scheduleRetry` early-returns when `window` is
  // undefined, and these tests run in node — so "no retry fired" is true in this
  // environment either way and a timer-based assertion would prove nothing. `blocked`
  // is the branch that decides it (`if (!blocked) scheduleRetry(...)`), so asserting
  // the flag is asserting the decision. The consequences that *are* observable — the
  // outbox surviving, and the flag clearing on a later success — are checked directly.

  /** Counts calls, so a repeated attempt would be visible rather than inferred. */
  function scripted(status: () => number | null) {
    let calls = 0;
    const accepting = acceptAll().transport;
    const transport: SyncTransport = async (request) => {
      calls += 1;
      const code = status();
      if (code === null) return accepting(request);
      throw new SyncTransportError(`sync failed: ${code}`, code);
    };
    return { transport, calls: () => calls };
  }

  it("marks the device blocked rather than backing off", async () => {
    const { transport, calls } = scripted(() => 401);
    install(transport);
    await queue(1);

    await syncNow();

    expect(getSyncEngineSnapshot().blocked).toBe(true);
    expect(getSyncEngineSnapshot().syncing).toBe(false);
    expect(calls()).toBe(1);
  });

  it("treats 403 the same as 401", async () => {
    const { transport } = scripted(() => 403);
    install(transport);
    await queue(1);

    await syncNow();

    expect(getSyncEngineSnapshot().blocked).toBe(true);
  });

  it("leaves an ordinary failure on the retry path, which a 500 is", async () => {
    const { transport } = scripted(() => 500);
    install(transport);
    await queue(1);

    await syncNow();

    expect(getSyncEngineSnapshot().blocked).toBe(false);
    expect(getSyncEngineSnapshot().lastError).not.toBeNull();
  });

  it("keeps the outbox intact — nothing is lost, only postponed", async () => {
    const { transport } = scripted(() => 401);
    install(transport);
    await queue(2);

    await syncNow();

    expect(await getOutboxDepth()).toBe(2);
  });

  it("clears once the key is accepted again, without reconfiguring", async () => {
    // Flipped on the *same* transport deliberately. Re-`install`ing would call
    // `configureSync`, which resets engine state — so the assertion would pass even if
    // a successful run never cleared `blocked`.
    let code: number | null = 401;
    const { transport } = scripted(() => code);
    install(transport);
    await queue(1);

    await syncNow();
    expect(getSyncEngineSnapshot().blocked).toBe(true);

    code = null;
    await syncNow();

    expect(getSyncEngineSnapshot().blocked).toBe(false);
    expect(await getOutboxDepth()).toBe(0);
  });
});
