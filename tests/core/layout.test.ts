import { describe, expect, it } from "vitest";
import { layoutWeek } from "@/core/layout";
import type { Checkpoint, Daypart, Goal, PlanSlot, SessionLog, Stage } from "@/core/types";

const morning: Daypart = { id: "morning", name: "morning", startTime: "06:00", endTime: "10:00", activeCap: 5, sortOrder: 0 };
const evening: Daypart = { id: "evening", name: "evening", startTime: "18:00", endTime: "22:00", activeCap: 5, sortOrder: 2 };
const DAYPARTS = [morning, evening];

const WEEK_START = "2026-07-27"; // a Monday
const MONDAY_NOW = "2026-07-27T07:00:00.000Z";

function goal(overrides: Partial<Goal> = {}): Goal {
  return { id: "goal-1", name: "Gym", purpose: "fitness", tier: 1, state: "active", ...overrides };
}

function stage(overrides: Partial<Stage> = {}): Stage {
  return {
    id: "stage-1",
    goalId: "goal-1",
    sessionMinutes: 30,
    cadenceType: "frequency",
    cadenceCount: 3,
    cadenceDays: null,
    eligibleDayparts: ["morning"],
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

function run(overrides: {
  goals?: Goal[];
  stages?: Stage[];
  dayparts?: Daypart[];
  history?: SessionLog[];
  checkpoints?: Checkpoint[];
  existing?: PlanSlot[];
  weekStart?: string;
  now?: string;
}) {
  return layoutWeek({
    goals: overrides.goals ?? [goal()],
    stages: overrides.stages ?? [stage()],
    dayparts: overrides.dayparts ?? DAYPARTS,
    history: overrides.history ?? [],
    checkpoints: overrides.checkpoints ?? [],
    existing: overrides.existing ?? [],
    weekStart: overrides.weekStart ?? WEEK_START,
    now: overrides.now ?? MONDAY_NOW,
  });
}

describe("layoutWeek — rule 1: deterministic", () => {
  it("produces byte-identical output for identical input", () => {
    const input = { stages: [stage({ cadenceCount: 4 })] };
    const a = run(input);
    const b = run(input);
    expect(a).toEqual(b);
  });
});

describe("layoutWeek — rule 2: recompute, never patch (idempotent)", () => {
  it("reaches a stable fixed point: feeding output back as existing changes nothing", () => {
    const st = stage({ cadenceCount: 4 });
    const first = run({ stages: [st] });
    const second = run({ stages: [st], existing: first });
    expect(second).toEqual(first);
  });
});

describe("layoutWeek — rule 3: the past is immutable", () => {
  it("carries past slots through untouched and never places anything on a past date", () => {
    const st = stage({ cadenceCount: 5, minRestDays: null });
    const pastSlot: PlanSlot = {
      id: "existing-past",
      stageId: st.id,
      weekStart: WEEK_START,
      date: "2026-07-27", // Monday, before "now" below (Thursday)
      daypartId: "morning",
      minutes: 30,
    };
    const thursdayNow = "2026-07-30T09:00:00.000Z";
    const result = run({ stages: [st], existing: [pastSlot], now: thursdayNow });

    expect(result).toContainEqual(pastSlot);
    for (const slot of result) {
      if (slot.id === pastSlot.id) continue; // the one deliberately-past slot, carried through unchanged
      expect(diffDaysUtil(slot.date, "2026-07-30")).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("layoutWeek — rule 4: minimise churn", () => {
  it("keeps a stage's still-valid existing slots unchanged when unrelated inputs change", () => {
    const st = stage({ id: "stage-a", cadenceCount: 2 });
    const existingForA: PlanSlot[] = [
      { id: "keep-1", stageId: "stage-a", weekStart: WEEK_START, date: "2026-07-28", daypartId: "morning", minutes: 30 },
      { id: "keep-2", stageId: "stage-a", weekStart: WEEK_START, date: "2026-07-30", daypartId: "morning", minutes: 30 },
    ];

    const before = run({ stages: [st], existing: existingForA });
    expect(before.filter((s) => s.stageId === "stage-a")).toEqual(existingForA);

    // add a second, unrelated goal/stage and rerun
    const otherGoal = goal({ id: "goal-2", name: "Reading" });
    const otherStage = stage({ id: "stage-b", goalId: "goal-2", cadenceCount: 1, eligibleDayparts: ["evening"] });

    const after = run({
      goals: [goal(), otherGoal],
      stages: [st, otherStage],
      existing: existingForA,
    });

    expect(after.filter((s) => s.stageId === "stage-a")).toEqual(existingForA);
  });
});

describe("layoutWeek — rule 5: scarcity first (D9)", () => {
  it("gives the scarcer stage (fewer eligible dayparts) its only slot before a more flexible one competes for it", () => {
    const yoga = stage({
      id: "yoga",
      goalId: "goal-yoga",
      cadenceCount: 7,
      eligibleDayparts: ["morning"], // morning-only — scarce
    });
    const meditation = stage({
      id: "meditation",
      goalId: "goal-med",
      cadenceCount: 7,
      eligibleDayparts: ["morning", "evening"], // flexible
    });

    const result = run({
      goals: [goal({ id: "goal-yoga", name: "Yoga" }), goal({ id: "goal-med", name: "Meditation" })],
      stages: [yoga, meditation],
    });

    const mondaySlots = result.filter((s) => s.date === WEEK_START);
    const yogaSlot = mondaySlots.find((s) => s.stageId === "yoga");
    const medSlot = mondaySlots.find((s) => s.stageId === "meditation");

    expect(yogaSlot?.daypartId).toBe("morning");
    expect(medSlot?.daypartId).toBe("evening");
  });
});

describe("layoutWeek — cadence types (D26)", () => {
  it("frequency: places exactly cadenceCount sessions across the week", () => {
    const st = stage({ cadenceType: "frequency", cadenceCount: 4 });
    const result = run({ stages: [st] });
    expect(result.filter((s) => s.stageId === st.id)).toHaveLength(4);
  });

  it("fixed_days: places sessions only on the specified weekdays", () => {
    const st = stage({ cadenceType: "fixed_days", cadenceCount: 0, cadenceDays: ["mon", "wed", "fri"] });
    const result = run({ stages: [st] });
    const dates = result.filter((s) => s.stageId === st.id).map((s) => s.date);
    expect(dates.sort()).toEqual(["2026-07-27", "2026-07-29", "2026-07-31"]);
  });

  it("hybrid: places cadenceCount total sessions and always includes the mandatory day", () => {
    const st = stage({
      cadenceType: "hybrid",
      cadenceCount: 4,
      cadenceDays: ["sun"],
      eligibleDayparts: ["morning", "evening"],
    });
    const result = run({ stages: [st] });
    const dates = result.filter((s) => s.stageId === st.id).map((s) => s.date);
    expect(dates).toHaveLength(4);
    expect(dates).toContain("2026-08-02"); // the mandatory Sunday
  });
});

describe("layoutWeek — recovery constraints (D20)", () => {
  it("respects min_rest_days spacing between sessions of the same stage", () => {
    const st = stage({ cadenceCount: 3, minRestDays: 2 });
    const result = run({ stages: [st] });
    const dates = result
      .filter((s) => s.stageId === st.id)
      .map((s) => s.date)
      .sort();
    for (let i = 1; i < dates.length; i++) {
      expect(diffDaysUtil(dates[i], dates[i - 1])).toBeGreaterThan(2);
    }
  });

  // D64. This replaces "caps total placements at max_per_week even when cadenceCount
  // asks for more", which asserted the opposite. `maxPerWeek` is a ceiling on the
  // week's *total* — planned plus voluntary catch-up (D20) — not an input to the
  // plan. The plan places the cadence the user stated (D26); nothing silently
  // reduces it.
  it("places the full stated cadence, and does not let max_per_week reduce it (D64)", () => {
    const st = stage({ cadenceCount: 5, maxPerWeek: 3 });
    const result = run({ stages: [st] });
    expect(result.filter((s) => s.stageId === st.id)).toHaveLength(5);
  });

  // The worst shape of the same bug: `Math.min(required, 0)` placed nothing at all,
  // so the goal vanished from the plan with no error anywhere.
  it("a max_per_week of zero does not erase the stage from the plan (D64)", () => {
    const st = stage({ cadenceCount: 3, maxPerWeek: 0 });
    const result = run({ stages: [st] });
    expect(result.filter((s) => s.stageId === st.id)).toHaveLength(3);
  });

  it("a max_per_week at or above the cadence changes nothing", () => {
    const st = stage({ cadenceCount: 3 });
    const uncapped = run({ stages: [st] });
    const capped = run({ stages: [stage({ cadenceCount: 3, maxPerWeek: 5 })] });
    expect(capped).toEqual(uncapped);
  });
});

describe("layoutWeek — one session per stage per date", () => {
  // Regression, reported by Wave 2.0. Slot ids are `plan-<stageId>-<date>` with no
  // daypart component, and `minRestDays` is usually null, so a retained `existing`
  // slot did not stop a fresh placement on the same date. Both carried the same id,
  // `bulkPut` collapsed them, and the week came up a session short with no error.
  it("does not place a second slot on a date the stage already has a retained slot on", () => {
    const st = stage({ cadenceCount: 2, minRestDays: null });
    // Canonical id, i.e. the slot a previous layoutWeek run produced — which is
    // always what `existing` actually contains.
    const existing: PlanSlot[] = [
      { id: `plan-${st.id}-2026-07-27`, stageId: st.id, weekStart: WEEK_START, date: "2026-07-27", daypartId: "morning", minutes: 30 },
    ];

    const result = run({ stages: [st], existing });
    const mine = result.filter((s) => s.stageId === st.id);

    expect(mine).toHaveLength(2);
    expect(new Set(mine.map((s) => s.id)).size).toBe(2);
    expect(new Set(mine.map((s) => s.date)).size).toBe(2);
  });

  it("does not retain an existing slot on a date whose session has since been logged", () => {
    const st = stage({ cadenceCount: 7, eligibleDayparts: ["morning"] });
    const thursday = "2026-07-30";
    const history: SessionLog[] = [
      { id: "h1", stageId: st.id, date: thursday, daypartId: "morning", minutes: 30, status: "done", source: "planned", loggedAt: `${thursday}T08:00:00` },
    ];
    // The plan as it stood before the session was logged — it had a Thursday slot.
    const priorPlan = run({ stages: [st], now: `${thursday}T22:00:00` });
    expect(priorPlan.map((s) => s.date)).toContain(thursday);

    const after = run({ stages: [st], history, existing: priorPlan, now: `${thursday}T22:00:00` });
    expect(after.map((s) => s.date)).not.toContain(thursday);
  });

  it("gives the same answer whether or not a prior plan is fed back in (§4.2 rule 2)", () => {
    const st = stage({ cadenceCount: 7, eligibleDayparts: ["morning"] });
    const thursday = "2026-07-30";
    const now = `${thursday}T22:00:00`;
    const history: SessionLog[] = [
      { id: "h1", stageId: st.id, date: thursday, daypartId: "morning", minutes: 30, status: "done", source: "planned", loggedAt: `${thursday}T08:00:00` },
    ];
    const priorPlan = run({ stages: [st], now });

    const fresh = run({ stages: [st], history, existing: [], now });
    const withPrior = run({ stages: [st], history, existing: priorPlan, now });

    expect(withPrior.map((s) => s.date)).toEqual(fresh.map((s) => s.date));
  });

  it("returns globally unique slot ids across several competing stages", () => {
    const stages = [
      stage({ id: "stage-a", cadenceCount: 4 }),
      stage({ id: "stage-b", goalId: "goal-2", cadenceCount: 3, eligibleDayparts: ["evening"] }),
      stage({ id: "stage-c", goalId: "goal-2", cadenceCount: 5, eligibleDayparts: ["morning", "evening"] }),
    ];
    const goals = [goal(), goal({ id: "goal-2", name: "Reading" })];

    const first = run({ goals, stages });
    // Feed it back and raise cadence — the path that made duplicates reachable.
    const second = run({
      goals,
      stages: stages.map((s) => (s.id === "stage-a" ? { ...s, cadenceCount: 6 } : s)),
      existing: first,
    });

    expect(new Set(second.map((s) => s.id)).size).toBe(second.length);
  });
});

describe("layoutWeek — general sanity", () => {
  it("never produces a slot with a different duration than the stage's fixed time-box (D12)", () => {
    const st = stage({ sessionMinutes: 45, cadenceCount: 3 });
    const result = run({ stages: [st] });
    for (const slot of result) {
      expect(slot.minutes).toBe(45);
    }
  });

  it("only ever places a stage into one of its own eligible dayparts", () => {
    const st = stage({ eligibleDayparts: ["evening"], cadenceCount: 3 });
    const result = run({ stages: [st] });
    for (const slot of result) {
      expect(slot.daypartId).toBe("evening");
    }
  });

  it("does not exceed the weekly requirement even when history already covers most of it", () => {
    const st = stage({ cadenceCount: 3 });
    const history: SessionLog[] = [
      { id: "h1", stageId: st.id, date: "2026-07-27", daypartId: "morning", minutes: 30, status: "done", source: "planned", loggedAt: "2026-07-27T08:00:00.000Z" },
      { id: "h2", stageId: st.id, date: "2026-07-28", daypartId: "morning", minutes: 30, status: "done", source: "voluntary", loggedAt: "2026-07-28T08:00:00.000Z" },
    ];
    const result = run({ stages: [st], history });
    expect(result.filter((s) => s.stageId === st.id)).toHaveLength(1);
  });
});

// D60. Before this, `activeCap` was enforced nowhere: layout ignored it entirely, and
// the goals screen counted a stage against every daypart it was *eligible* for, so two
// goals eligible everywhere reported all four dayparts full while no plan existed.
describe("layoutWeek — daypart active cap (D60)", () => {
  const cappedMorning: Daypart = { ...morning, activeCap: 2 };
  const cappedEvening: Daypart = { ...evening, activeCap: 2 };
  const CAPPED = [cappedMorning, cappedEvening];

  /** `count` distinct morning-only stages, each wanting a session every day. */
  function morningStages(count: number): { goals: Goal[]; stages: Stage[] } {
    const goals: Goal[] = [];
    const stages: Stage[] = [];
    for (let i = 0; i < count; i++) {
      goals.push(goal({ id: `goal-${i}`, name: `Goal ${i}` }));
      stages.push(
        stage({
          id: `stage-${i}`,
          goalId: `goal-${i}`,
          eligibleDayparts: ["morning"],
          cadenceCount: 7,
        }),
      );
    }
    return { goals, stages };
  }

  function countByDate(slots: PlanSlot[], daypartId: string): Map<string, number> {
    const counts = new Map<string, number>();
    for (const slot of slots) {
      if (slot.daypartId !== daypartId) continue;
      counts.set(slot.date, (counts.get(slot.date) ?? 0) + 1);
    }
    return counts;
  }

  it("never places more distinct stages in one daypart on one day than its cap", () => {
    const { goals, stages } = morningStages(4);
    const result = run({ goals, stages, dayparts: CAPPED });

    expect(result.length).toBeGreaterThan(0);
    for (const [, count] of countByDate(result, "morning")) {
      expect(count).toBeLessThanOrEqual(2);
    }
  });

  it("leaves the day short rather than dropping a session to make room (D21)", () => {
    // Capacity is a ceiling, not a target: the fourth stage does not evict anyone, it
    // simply does not get placed that morning.
    const { goals, stages } = morningStages(4);
    const result = run({ goals, stages, dayparts: CAPPED });
    const monday = result.filter((s) => s.date === "2026-07-27");
    expect(monday).toHaveLength(2);
  });

  it("gives the scarcest stage the slot when the cap binds (D9)", () => {
    // Two stages want morning; only one can have it. `flexible` could also run in the
    // evening, `morningOnly` could not — so morning must go to `morningOnly`.
    const tightMorning: Daypart = { ...morning, activeCap: 1 };
    const morningOnly = stage({
      id: "stage-scarce",
      goalId: "goal-scarce",
      eligibleDayparts: ["morning"],
      cadenceCount: 7,
    });
    const flexible = stage({
      id: "stage-flexible",
      goalId: "goal-flexible",
      eligibleDayparts: ["morning", "evening"],
      cadenceCount: 7,
    });

    const result = run({
      goals: [goal({ id: "goal-scarce" }), goal({ id: "goal-flexible" })],
      stages: [morningOnly, flexible],
      dayparts: [tightMorning, cappedEvening],
    });

    const mondayMorning = result.filter(
      (s) => s.date === "2026-07-27" && s.daypartId === "morning",
    );
    expect(mondayMorning).toHaveLength(1);
    expect(mondayMorning[0].stageId).toBe("stage-scarce");
  });

  // The D54 lesson, applied to the cap: a rule enforced only in `placeRemaining` is
  // silently exceeded by a week that was laid out under a looser cap.
  it("drops retained slots that no longer fit after the cap is lowered", () => {
    const { goals, stages } = morningStages(3);
    const underLooseCap = run({ goals, stages, dayparts: DAYPARTS }); // activeCap 5
    expect(countByDate(underLooseCap, "morning").get("2026-07-28")).toBe(3);

    const underTightCap = run({
      goals,
      stages,
      dayparts: CAPPED,
      existing: underLooseCap,
    });
    for (const [, count] of countByDate(underTightCap, "morning")) {
      expect(count).toBeLessThanOrEqual(2);
    }
  });

  it("stays idempotent and deterministic while the cap binds (§4.2 rules 1 and 2)", () => {
    const { goals, stages } = morningStages(4);
    const input = { goals, stages, dayparts: CAPPED };

    const first = run(input);
    expect(run(input)).toEqual(first);
    expect(run({ ...input, existing: first })).toEqual(first);
  });

  it("does not depend on the order `existing` is passed in", () => {
    const { goals, stages } = morningStages(4);
    const input = { goals, stages, dayparts: CAPPED };
    const first = run(input);

    const reversed = run({ ...input, existing: [...first].reverse() });
    expect(reversed).toEqual(run({ ...input, existing: first }));
  });

  it("treats a cap of zero as a closed daypart, and reroutes what it can", () => {
    const closedMorning: Daypart = { ...morning, activeCap: 0 };
    const flexible = stage({ eligibleDayparts: ["morning", "evening"], cadenceCount: 3 });

    const result = run({ stages: [flexible], dayparts: [closedMorning, cappedEvening] });

    expect(result.length).toBeGreaterThan(0);
    expect(result.every((s) => s.daypartId === "evening")).toBe(true);
  });
});

function diffDaysUtil(a: string, b: string): number {
  const toUtc = (d: string) => {
    const [y, m, day] = d.split("-").map(Number);
    return Date.UTC(y, m - 1, day);
  };
  return Math.round((toUtc(a) - toUtc(b)) / 86_400_000);
}
