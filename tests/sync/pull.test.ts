// PULL — the convergence tests. Two devices, one mirror, and the three rules from
// `merge.ts` applied against a real IndexedDB (`fake-indexeddb`, D55).
//
// "Device B" here is whatever arrives in the pull payload; "device A" is what this
// device already holds. The question every test asks is the one the user would ask:
// after both devices have synced, do they show the same thing?

import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";

import type { Goal, Stage } from "@/core/types";
import { localDb, type LocalGoal } from "@/db/local/schema";
import {
  getOutboxDepth,
  getPlanSlotsForWeek,
  getPlanWeek,
  replacePlanWeek,
} from "@/db/local/queries";
import { logSession, putGoal } from "@/db/local/mutations";
import { applyPull } from "@/sync/pull";
import { emptyPulledRows, type PulledRows, type WirePlanSlot } from "@/sync/protocol";

const WEEK_START = "2026-07-27";
const EARLY = "2026-07-30T09:00:00";
const LATE = "2026-07-30T11:00:00";

async function reset() {
  await Promise.all(localDb.tables.map((t) => t.clear()));
}

beforeEach(reset);

const pulled = (over: Partial<PulledRows>): PulledRows => ({
  ...emptyPulledRows(),
  ...over,
});

function goal(over: Partial<Goal> = {}): Goal {
  return { id: "goal-1", name: "Gym", purpose: "fitness", tier: 1, state: "active", ...over };
}

function slot(over: Partial<WirePlanSlot> & { id: string }): WirePlanSlot {
  return {
    stageId: "stage-1",
    weekStart: WEEK_START,
    date: WEEK_START,
    daypartId: "daypart-morning",
    minutes: 30,
    planWeekId: `week-${WEEK_START}`,
    ...over,
  };
}

// ---------------------------------------------------------------------------
// Mutable rows — last-write-wins on `updatedAt`
// ---------------------------------------------------------------------------

describe("mutable rows converge on the later updatedAt", () => {
  it("takes the remote edit when it is newer", async () => {
    // Device A renamed the goal at 09:00 and has already pushed it.
    await putGoal(goal({ name: "Gym" }), EARLY);
    // Device B renamed it at 11:00; that is what comes back down.
    const remote: LocalGoal = { ...goal({ name: "Lifting" }), updatedAt: LATE, deletedAt: null };

    const outcome = await applyPull(pulled({ goals: [remote] }));

    expect(outcome.applied).toBe(1);
    expect((await localDb.goals.get("goal-1"))!.name).toBe("Lifting");
  });

  it("keeps the local edit when the remote copy is older", async () => {
    // The reason offline-first is safe: an unpushed local edit is not clobbered by a
    // pull that happens to arrive first.
    await putGoal(goal({ name: "Lifting" }), LATE);
    const remote: LocalGoal = { ...goal({ name: "Gym" }), updatedAt: EARLY, deletedAt: null };

    const outcome = await applyPull(pulled({ goals: [remote] }));

    expect(outcome.applied).toBe(0);
    expect((await localDb.goals.get("goal-1"))!.name).toBe("Lifting");
  });

  it("is a no-op for the echo of this device's own write", async () => {
    await putGoal(goal({ name: "Gym" }), LATE);
    const echo: LocalGoal = { ...goal({ name: "Gym" }), updatedAt: LATE, deletedAt: null };

    // The server re-sends a small overlap on every pull by design, so this is the
    // common case, not an edge one.
    expect((await applyPull(pulled({ goals: [echo] }))).applied).toBe(0);
  });

  it("accepts a row this device has never seen", async () => {
    const remote: LocalGoal = {
      ...goal({ id: "goal-from-phone", name: "Reading" }),
      updatedAt: EARLY,
      deletedAt: null,
    };

    expect((await applyPull(pulled({ goals: [remote] }))).applied).toBe(1);
    expect(await localDb.goals.count()).toBe(1);
  });

  it("propagates a tombstone as an ordinary later write (D48)", async () => {
    await putGoal(goal(), EARLY);
    const remote: LocalGoal = { ...goal(), updatedAt: LATE, deletedAt: LATE };

    await applyPull(pulled({ goals: [remote] }));

    // Soft-deleted, still present — nothing is ever hard-deleted.
    expect((await localDb.goals.get("goal-1"))!.deletedAt).toBe(LATE);
  });

  it("never enqueues — applying a pull must not push it back", async () => {
    const remote: LocalGoal = { ...goal(), updatedAt: LATE, deletedAt: null };
    await applyPull(pulled({ goals: [remote] }));
    expect(await getOutboxDepth()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Append-only — facts, never rewritten (D32)
// ---------------------------------------------------------------------------

describe("append-only rows are never overwritten by a pull", () => {
  it("keeps the local row when the same id arrives with different content", async () => {
    const local = await logSession(
      {
        id: "log-1",
        stageId: "stage-1",
        date: "2026-07-30",
        daypartId: "daypart-morning",
        minutes: 30,
        status: "done",
        source: "planned",
      },
      EARLY,
    );

    const outcome = await applyPull(
      pulled({
        sessionLogs: [{ ...local, minutes: 999, status: "skipped", loggedAt: LATE }],
      }),
    );

    expect(outcome.applied).toBe(0);
    const stored = (await localDb.sessionLogs.get("log-1"))!;
    expect(stored.minutes).toBe(30);
    expect(stored.status).toBe("done");
    expect(stored.loggedAt).toBe(EARLY);
  });

  it("unions in a row this device has not got", async () => {
    await applyPull(
      pulled({
        sessionLogs: [
          {
            id: "log-from-phone",
            stageId: "stage-1",
            date: "2026-07-29",
            daypartId: "daypart-evening",
            minutes: 45,
            status: "done",
            source: "voluntary",
            loggedAt: EARLY,
            taskId: null,
          },
        ],
        checkIns: [
          {
            id: "checkin-1",
            daypartId: "daypart-evening",
            availableMinutes: 60,
            date: "2026-07-29",
            checkedInAt: EARLY,
          },
        ],
        checkpoints: [{ id: "cp-1", stageId: "stage-1", value: 7, loggedAt: EARLY }],
      }),
    );

    expect(await localDb.sessionLogs.count()).toBe(1);
    expect(await localDb.checkIns.count()).toBe(1);
    expect(await localDb.checkpoints.count()).toBe(1);
  });

  it("is idempotent across the cursor overlap the server deliberately re-sends", async () => {
    const row = {
      id: "cp-1",
      stageId: "stage-1",
      value: 7,
      loggedAt: EARLY,
    };
    await applyPull(pulled({ checkpoints: [row] }));
    await applyPull(pulled({ checkpoints: [row] }));
    await applyPull(pulled({ checkpoints: [row] }));

    expect(await localDb.checkpoints.count()).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// The plan — wholesale per week (D45)
// ---------------------------------------------------------------------------

describe("two devices planning the same week converge on one week, wholesale", () => {
  /** Device A's week: two sessions, Monday and Tuesday, version 4 at 09:00. */
  async function seedLocalWeek() {
    await replacePlanWeek(
      { id: `week-${WEEK_START}`, weekStart: WEEK_START, version: 4, updatedAt: EARLY },
      [
        slot({ id: "plan-stage-1-2026-07-27", date: "2026-07-27" }),
        slot({ id: "plan-stage-1-2026-07-28", date: "2026-07-28" }),
      ],
    );
  }

  it("replaces the whole week and never interleaves slots", async () => {
    await seedLocalWeek();

    // Device B laid the same week out differently — one session, on Thursday.
    const remoteSlots = [slot({ id: "plan-stage-1-2026-07-30", date: "2026-07-30" })];
    const outcome = await applyPull(
      pulled({
        planWeeks: [
          {
            week: {
              id: `week-${WEEK_START}`,
              weekStart: WEEK_START,
              version: 2,
              updatedAt: LATE,
            },
            slots: remoteSlots,
          },
        ],
      }),
    );

    expect(outcome.weeksApplied).toBe(1);

    const slots = await getPlanSlotsForWeek(WEEK_START);
    // Device A's Monday and Tuesday are gone — not merged, not kept alongside. A
    // three-slot result here would be the incoherent plan D45 exists to prevent.
    expect(slots.map((s) => s.id)).toEqual(["plan-stage-1-2026-07-30"]);
    expect(await localDb.planWeeks.count()).toBe(1);
  });

  it("adopts the remote version and stamp verbatim, so the week stops moving", async () => {
    await seedLocalWeek();

    await applyPull(
      pulled({
        planWeeks: [
          {
            week: {
              id: `week-${WEEK_START}`,
              weekStart: WEEK_START,
              // Lower than the local 4 on purpose: version is a per-device edit
              // counter, not a clock, and `updatedAt` outranks it.
              version: 2,
              updatedAt: LATE,
            },
            slots: [slot({ id: "plan-stage-1-2026-07-30", date: "2026-07-30" })],
          },
        ],
      }),
    );

    const week = (await getPlanWeek(WEEK_START))!;
    expect(week.version).toBe(2);
    expect(week.updatedAt).toBe(LATE);

    // And the second pull of the same week changes nothing — if apply had bumped
    // either field, the two devices would trade this week back and forth forever.
    const again = await applyPull(
      pulled({
        planWeeks: [
          {
            week: { id: `week-${WEEK_START}`, weekStart: WEEK_START, version: 2, updatedAt: LATE },
            slots: [slot({ id: "plan-stage-1-2026-07-30", date: "2026-07-30" })],
          },
        ],
      }),
    );
    expect(again.weeksApplied).toBe(0);
  });

  it("does not queue the applied week for push", async () => {
    await seedLocalWeek();
    const before = await getOutboxDepth();

    await applyPull(
      pulled({
        planWeeks: [
          {
            week: { id: `week-${WEEK_START}`, weekStart: WEEK_START, version: 9, updatedAt: LATE },
            slots: [slot({ id: "plan-stage-1-2026-07-30", date: "2026-07-30" })],
          },
        ],
      }),
    );

    expect(await getOutboxDepth()).toBe(before);
  });

  it("keeps the local week when it is the later one", async () => {
    await replacePlanWeek(
      { id: `week-${WEEK_START}`, weekStart: WEEK_START, version: 2, updatedAt: LATE },
      [slot({ id: "plan-stage-1-2026-07-29", date: "2026-07-29" })],
    );

    const outcome = await applyPull(
      pulled({
        planWeeks: [
          {
            week: { id: `week-${WEEK_START}`, weekStart: WEEK_START, version: 8, updatedAt: EARLY },
            slots: [slot({ id: "plan-stage-1-2026-07-27", date: "2026-07-27" })],
          },
        ],
      }),
    );

    expect(outcome.weeksApplied).toBe(0);
    expect((await getPlanSlotsForWeek(WEEK_START)).map((s) => s.id)).toEqual([
      "plan-stage-1-2026-07-29",
    ]);
  });

  it("breaks a full updatedAt + version tie the same way on both devices", async () => {
    // Both devices relayout in the same second and both land on version 5. Whichever
    // device applies which week, they must end up on the same one.
    const weekA = {
      week: { id: `week-${WEEK_START}`, weekStart: WEEK_START, version: 5, updatedAt: LATE },
      slots: [slot({ id: "plan-stage-1-2026-07-27", date: "2026-07-27" })],
    };
    const weekB = {
      week: { id: `week-${WEEK_START}`, weekStart: WEEK_START, version: 5, updatedAt: LATE },
      slots: [slot({ id: "plan-stage-2-2026-07-27", stageId: "stage-2", date: "2026-07-27" })],
    };

    // Device holding A pulls B.
    await replacePlanWeek(weekA.week, weekA.slots);
    await applyPull(pulled({ planWeeks: [weekB] }));
    const fromA = (await getPlanSlotsForWeek(WEEK_START)).map((s) => s.id);

    // Device holding B pulls A.
    await reset();
    await replacePlanWeek(weekB.week, weekB.slots);
    await applyPull(pulled({ planWeeks: [weekA] }));
    const fromB = (await getPlanSlotsForWeek(WEEK_START)).map((s) => s.id);

    expect(fromA).toEqual(fromB);
    expect(fromA).toEqual(["plan-stage-2-2026-07-27"]); // the greater lineage wins
  });

  it("accepts a week for a start this device has never planned", async () => {
    const outcome = await applyPull(
      pulled({
        planWeeks: [
          {
            week: { id: "week-2026-08-03", weekStart: "2026-08-03", version: 1, updatedAt: LATE },
            slots: [
              slot({
                id: "plan-stage-1-2026-08-03",
                date: "2026-08-03",
                weekStart: "2026-08-03",
                planWeekId: "week-2026-08-03",
              }),
            ],
          },
        ],
      }),
    );

    expect(outcome.weeksApplied).toBe(1);
    expect(await getPlanSlotsForWeek("2026-08-03")).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Everything at once
// ---------------------------------------------------------------------------

describe("a mixed pull", () => {
  it("applies each table by its own rule in one pass", async () => {
    const stage: Stage = {
      id: "stage-1",
      goalId: "goal-1",
      sessionMinutes: 30,
      cadenceType: "frequency",
      cadenceCount: 3,
      cadenceDays: null,
      eligibleDayparts: ["daypart-morning"],
      maxPerWeek: null,
      minRestDays: null,
      scopeUnitLabel: null,
      scopeUnitTotal: null,
      targetDate: null,
      deadlineDerived: false,
      sortOrder: 0,
      state: "active",
    };

    const outcome = await applyPull(
      pulled({
        goals: [{ ...goal(), updatedAt: LATE, deletedAt: null }],
        stages: [{ ...stage, updatedAt: LATE, deletedAt: null }],
        sessionLogs: [
          {
            id: "log-1",
            stageId: "stage-1",
            date: "2026-07-29",
            daypartId: "daypart-morning",
            minutes: 30,
            status: "done",
            source: "planned",
            loggedAt: EARLY,
            taskId: null,
          },
        ],
        planWeeks: [
          {
            week: { id: `week-${WEEK_START}`, weekStart: WEEK_START, version: 1, updatedAt: LATE },
            slots: [slot({ id: "plan-stage-1-2026-07-27" })],
          },
        ],
      }),
    );

    expect(outcome.applied).toBe(4);
    expect(outcome.weeksApplied).toBe(1);
    expect(await getOutboxDepth()).toBe(0);
  });
});
