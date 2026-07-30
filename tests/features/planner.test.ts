// The `core/` ⇄ Dexie seam. Everything either side of it is already covered — 91 tests
// over the pure scheduler and over `lib/daypart.ts` — and the seam itself was where both
// of Wave 2.0's real bugs lived. Unit tests over `daypart.ts` alone structurally cannot
// see a seam bug: the midnight wrap was handled correctly *inside* daypart.ts and lost at
// the call site.
//
// Needs a real IndexedDB, hence `fake-indexeddb` (devDependency, D50). Imported for its
// side effect before anything touches Dexie.
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";

import type { Goal, Stage } from "@/core/types";
import { localDb } from "@/db/local/schema";
import { putGoalWithStage, logSession } from "@/db/local/mutations";
import { DEFAULT_DAYPARTS, seedIfEmpty } from "@/db/local/seed";
import { getOutboxDepth, getPlanSlotsForDaypart } from "@/db/local/queries";
import { planWeekId, relayoutWeek, reconcileNow } from "@/features/plan/planner";

const NIGHT = DEFAULT_DAYPARTS.find((d) => d.name === "night")!;
const MORNING = DEFAULT_DAYPARTS.find((d) => d.name === "morning")!;

// Local wall-clock, no Z — D53. Thursday.
const THURSDAY_EVENING = "2026-07-30T22:00:00";
const FRIDAY_SMALL_HOURS = "2026-07-31T01:00:00";
const WEEK_START = "2026-07-27"; // the Monday

function goal(overrides: Partial<Goal> = {}): Goal {
  return { id: "goal-1", name: "Gym", purpose: "fitness", tier: 1, state: "active", ...overrides };
}

function stage(overrides: Partial<Stage> = {}): Stage {
  return {
    id: "stage-1",
    goalId: "goal-1",
    sessionMinutes: 30,
    cadenceType: "frequency",
    cadenceCount: 7, // every day, so there is a slot on whichever date we ask about
    cadenceDays: null,
    eligibleDayparts: [NIGHT.id],
    maxPerWeek: null,
    minRestDays: null,
    scopeUnitLabel: null,
    scopeUnitTotal: null,
    targetDate: null,
    deadlineDerived: false,
    sortOrder: 0,
    state: "active",
    ...overrides,
  };
}

async function reset() {
  await Promise.all(localDb.tables.map((t) => t.clear()));
}

beforeEach(reset);

describe("seedIfEmpty", () => {
  it("writes the dayparts and queues them, and is idempotent", async () => {
    expect(await seedIfEmpty(THURSDAY_EVENING)).toBe(true);
    expect(await localDb.dayparts.count()).toBe(DEFAULT_DAYPARTS.length);
    const afterFirst = await getOutboxDepth();

    expect(await seedIfEmpty(THURSDAY_EVENING)).toBe(false);
    expect(await localDb.dayparts.count()).toBe(DEFAULT_DAYPARTS.length);
    expect(await getOutboxDepth()).toBe(afterFirst);
  });
});

describe("relayoutWeek", () => {
  it("keeps exactly one planWeek row and one outbox row per week, however often it runs", async () => {
    await seedIfEmpty(THURSDAY_EVENING);
    await putGoalWithStage(goal(), stage(), THURSDAY_EVENING);
    const before = await getOutboxDepth();

    await relayoutWeek({ now: THURSDAY_EVENING });
    await relayoutWeek({ now: THURSDAY_EVENING });
    await relayoutWeek({ now: THURSDAY_EVENING });

    // The week is the atomic sync unit (D45): three relayouts, three outbox rows,
    // never one per slot.
    expect(await getOutboxDepth()).toBe(before + 3);
    expect(await localDb.planWeeks.count()).toBe(1);

    const queued = await localDb.outbox.orderBy("seq").last();
    expect(queued!.table).toBe("planWeeks");
    expect(queued!.rowId).toBe(planWeekId(WEEK_START));
  });

  it("increments version monotonically per week, starting at 1", async () => {
    await seedIfEmpty(THURSDAY_EVENING);
    await putGoalWithStage(goal(), stage(), THURSDAY_EVENING);

    const first = await relayoutWeek({ now: THURSDAY_EVENING });
    const second = await relayoutWeek({ now: THURSDAY_EVENING });

    expect(first.version).toBe(1);
    expect(second.version).toBe(2);
    expect((await localDb.planWeeks.get(planWeekId(WEEK_START)))!.version).toBe(2);
  });

  it("stores every slot exactly once — no id collision silently collapsing the week (D54)", async () => {
    await seedIfEmpty(THURSDAY_EVENING);
    await putGoalWithStage(goal(), stage({ cadenceCount: 4 }), THURSDAY_EVENING);

    const { slots } = await relayoutWeek({ now: THURSDAY_EVENING });
    const stored = await localDb.planSlots.toArray();

    expect(stored).toHaveLength(slots.length);
    expect(new Set(stored.map((s) => s.id)).size).toBe(stored.length);
  });

  it("does not schedule a stage whose goal has been dropped", async () => {
    await seedIfEmpty(THURSDAY_EVENING);
    await putGoalWithStage(goal({ state: "dropped" }), stage(), THURSDAY_EVENING);

    const { slots } = await relayoutWeek({ now: THURSDAY_EVENING });
    expect(slots).toHaveLength(0);
  });
});

describe("reconcileNow", () => {
  it("writes nothing — reconciliation is a view-time operation (D32, PRD §6.4)", async () => {
    await seedIfEmpty(THURSDAY_EVENING);
    await putGoalWithStage(goal(), stage(), THURSDAY_EVENING);
    await relayoutWeek({ now: THURSDAY_EVENING });

    const depthBefore = await getOutboxDepth();
    const weekBefore = await localDb.planWeeks.get(planWeekId(WEEK_START));
    const slotsBefore = await localDb.planSlots.count();

    await reconcileNow({ now: THURSDAY_EVENING, daypartId: NIGHT.id, availableMinutes: 60 });

    expect(await getOutboxDepth()).toBe(depthBefore);
    expect(await localDb.planWeeks.get(planWeekId(WEEK_START))).toEqual(weekBefore);
    expect(await localDb.planSlots.count()).toBe(slotsBefore);
  });

  it("still finds the night session after midnight — the anchor bug (D53)", async () => {
    await seedIfEmpty(THURSDAY_EVENING);
    await putGoalWithStage(goal(), stage(), THURSDAY_EVENING);
    await relayoutWeek({ now: THURSDAY_EVENING });

    const before = await reconcileNow({
      now: THURSDAY_EVENING,
      daypartId: NIGHT.id,
      availableMinutes: 120,
    });
    // 01:00 Friday is still inside Thursday's night occurrence. Keying off
    // `dateOnly(now)` here shows an empty plan; `daypartDate` is what makes it work.
    const after = await reconcileNow({
      now: FRIDAY_SMALL_HOURS,
      daypartId: NIGHT.id,
      availableMinutes: 120,
    });

    expect(before.keep.length).toBeGreaterThan(0);
    expect(after.keep.map((r) => r.slot.id)).toEqual(before.keep.map((r) => r.slot.id));
  });

  it("drops what does not fit rather than shortening it — no partial sessions (D27)", async () => {
    await seedIfEmpty(THURSDAY_EVENING);
    await putGoalWithStage(
      goal(),
      stage({ sessionMinutes: 45, eligibleDayparts: [NIGHT.id] }),
      THURSDAY_EVENING,
    );
    await relayoutWeek({ now: THURSDAY_EVENING });

    const { keep, dropped } = await reconcileNow({
      now: THURSDAY_EVENING,
      daypartId: NIGHT.id,
      availableMinutes: 30, // less than one box
    });

    expect(keep).toHaveLength(0);
    expect(dropped.length).toBeGreaterThan(0);
    for (const r of [...keep, ...dropped]) expect(r.slot.minutes).toBe(45);
  });

  it("carries a one-line reason per slot (D14)", async () => {
    await seedIfEmpty(THURSDAY_EVENING);
    await putGoalWithStage(goal(), stage(), THURSDAY_EVENING);
    await relayoutWeek({ now: THURSDAY_EVENING });

    const { keep } = await reconcileNow({
      now: THURSDAY_EVENING,
      daypartId: NIGHT.id,
      availableMinutes: 120,
    });

    expect(keep.length).toBeGreaterThan(0);
    for (const r of keep) expect(r.reason.trim().length).toBeGreaterThan(0);
  });
});

describe("logSession", () => {
  it("writes the log and queues it in one go — a write is never unqueued", async () => {
    await seedIfEmpty(THURSDAY_EVENING);
    const before = await getOutboxDepth();

    await logSession(
      {
        stageId: "stage-1",
        date: "2026-07-30",
        daypartId: MORNING.id,
        minutes: 30,
        status: "done",
        source: "voluntary",
      },
      THURSDAY_EVENING,
    );

    expect(await localDb.sessionLogs.count()).toBe(1);
    expect(await getOutboxDepth()).toBe(before + 1);
  });

  it("counts against the plan, so the next relayout stops asking for that session", async () => {
    await seedIfEmpty(THURSDAY_EVENING);
    await putGoalWithStage(goal(), stage({ cadenceCount: 7 }), THURSDAY_EVENING);
    await relayoutWeek({ now: THURSDAY_EVENING });

    const thursdayBefore = await getPlanSlotsForDaypart("2026-07-30", NIGHT.id);
    expect(thursdayBefore.length).toBe(1);

    await logSession(
      {
        stageId: "stage-1",
        date: "2026-07-30",
        daypartId: NIGHT.id,
        minutes: 30,
        status: "done",
        source: "planned",
      },
      THURSDAY_EVENING,
    );
    await relayoutWeek({ now: THURSDAY_EVENING });

    // D54: one session per stage per date. The day is already satisfied, so it must
    // not be handed back as still-to-do.
    const thursdayAfter = await getPlanSlotsForDaypart("2026-07-30", NIGHT.id);
    expect(thursdayAfter).toHaveLength(0);
  });
});
