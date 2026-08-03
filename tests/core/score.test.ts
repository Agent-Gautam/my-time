import { describe, expect, it } from "vitest";
import { cadenceDebt, deadlinePressure, scarcityMultiplier, scoreStage, staleness } from "@/core/score";
import type { Checkpoint, Goal, SessionLog, Stage } from "@/core/types";

function makeStage(overrides: Partial<Stage> = {}): Stage {
  return {
    id: "stage-1",
    goalId: "goal-1",
    sessionMinutes: 30,
    cadenceType: "frequency",
    cadenceCount: 4,
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

function makeGoal(overrides: Partial<Goal> = {}): Goal {
  return { id: "goal-1", name: "Gym", purpose: "fitness", tier: 1, state: "active", ...overrides };
}

function log(overrides: Partial<SessionLog> = {}): SessionLog {
  return {
    id: "s1",
    stageId: "stage-1",
    date: "2026-07-27",
    daypartId: "morning",
    minutes: 30,
    status: "done",
    source: "planned",
    loggedAt: "2026-07-27T08:00:00.000Z",
    taskId: null,
    ...overrides,
  };
}

describe("cadenceDebt", () => {
  it("is zero when the week's target is already met", () => {
    const stage = makeStage({ cadenceCount: 2 });
    const history = [log({ date: "2026-07-27" }), log({ date: "2026-07-28" })];
    const debt = cadenceDebt({
      stage,
      history,
      windowStart: "2026-07-27",
      windowEnd: "2026-08-02",
      today: "2026-07-29",
    });
    expect(debt).toBe(0);
  });

  it("rises as days remaining shrink for the same remaining requirement", () => {
    const stage = makeStage({ cadenceCount: 3 });
    const early = cadenceDebt({
      stage,
      history: [],
      windowStart: "2026-07-27",
      windowEnd: "2026-08-02",
      today: "2026-07-27",
    });
    const late = cadenceDebt({
      stage,
      history: [],
      windowStart: "2026-07-27",
      windowEnd: "2026-08-02",
      today: "2026-08-01",
    });
    expect(late).toBeGreaterThan(early);
  });

  it(">= 1.0 signals the window is no longer reachable without today", () => {
    const stage = makeStage({ cadenceCount: 1 });
    const debt = cadenceDebt({
      stage,
      history: [],
      windowStart: "2026-07-27",
      windowEnd: "2026-07-27",
      today: "2026-07-27",
    });
    expect(debt).toBeGreaterThanOrEqual(1);
  });

  it("counts only weekdays in cadenceDays for fixed_days stages", () => {
    const stage = makeStage({ cadenceType: "fixed_days", cadenceCount: 0, cadenceDays: ["mon", "wed", "fri"] });
    // 2026-07-27 is a Monday; window is exactly that week (Mon..Sun) -> mon/wed/fri = 3 required
    const debt = cadenceDebt({
      stage,
      history: [],
      windowStart: "2026-07-27",
      windowEnd: "2026-08-02",
      today: "2026-07-27",
    });
    expect(debt).toBeCloseTo(3 / 7, 5);
  });

  it("credits voluntary catch-up sessions against the requirement (D20)", () => {
    const stage = makeStage({ cadenceCount: 2 });
    const history = [log({ date: "2026-07-27", source: "voluntary" })];
    const debt = cadenceDebt({
      stage,
      history,
      windowStart: "2026-07-27",
      windowEnd: "2026-08-02",
      today: "2026-07-28",
    });
    // 1 of 2 required already done -> remaining 1
    expect(debt).toBeGreaterThan(0);
    expect(debt).toBeLessThan(1);
  });

  it("does not count skipped sessions as done", () => {
    const stage = makeStage({ cadenceCount: 1 });
    const history = [log({ date: "2026-07-27", status: "skipped" })];
    const debt = cadenceDebt({
      stage,
      history,
      windowStart: "2026-07-27",
      windowEnd: "2026-07-27",
      today: "2026-07-27",
    });
    expect(debt).toBeGreaterThan(0);
  });
});

describe("staleness", () => {
  it("is at its cap for a stage that has never been done", () => {
    const stage = makeStage();
    expect(staleness(stage, [], "2026-07-30")).toBe(1);
  });

  it("is zero the same day a session was done", () => {
    const stage = makeStage();
    const history = [log({ date: "2026-07-30" })];
    expect(staleness(stage, history, "2026-07-30")).toBe(0);
  });

  it("saturates at stalenessCapDays rather than growing unbounded", () => {
    const stage = makeStage();
    const history = [log({ date: "2026-01-01" })];
    const veryStale = staleness(stage, history, "2026-07-30");
    expect(veryStale).toBe(1);
  });

  it("increases monotonically with days since last done, before the cap", () => {
    const stage = makeStage();
    const a = staleness(stage, [log({ date: "2026-07-28" })], "2026-07-29");
    const b = staleness(stage, [log({ date: "2026-07-20" })], "2026-07-29");
    expect(b).toBeGreaterThan(a);
  });
});

describe("deadlinePressure", () => {
  it("is zero for cadence-only stages with no scope or target date", () => {
    const stage = makeStage();
    expect(deadlinePressure(stage, [], "2026-07-30")).toBe(0);
  });

  it("is zero once scope is fully complete", () => {
    const stage = makeStage({ scopeUnitTotal: 10, targetDate: "2026-09-01" });
    const checkpoints: Checkpoint[] = [{ id: "c1", stageId: "stage-1", value: 10, loggedAt: "2026-07-30T00:00:00.000Z" }];
    expect(deadlinePressure(stage, checkpoints, "2026-07-30")).toBe(0);
  });

  it("hits the cap when the target date has already passed with scope remaining", () => {
    const stage = makeStage({ scopeUnitTotal: 10, targetDate: "2026-07-01" });
    expect(deadlinePressure(stage, [], "2026-07-30")).toBe(3);
  });

  it("is neutral (1.0) when there isn't enough data to measure a sustained rate", () => {
    const stage = makeStage({ scopeUnitTotal: 30, targetDate: "2026-12-01" });
    const checkpoints: Checkpoint[] = [{ id: "c1", stageId: "stage-1", value: 3, loggedAt: "2026-07-30T00:00:00.000Z" }];
    expect(deadlinePressure(stage, checkpoints, "2026-07-30")).toBe(1);
  });

  it("rises above neutral when the sustained rate is behind what's required", () => {
    const stage = makeStage({ scopeUnitTotal: 100, targetDate: "2026-08-10" });
    const checkpoints: Checkpoint[] = [
      { id: "c1", stageId: "stage-1", value: 0, loggedAt: "2026-07-01T00:00:00.000Z" },
      { id: "c2", stageId: "stage-1", value: 1, loggedAt: "2026-07-30T00:00:00.000Z" },
    ];
    // remaining 99 over 11 days required ~9/day, sustained rate is ~1/29 per day -> far behind
    expect(deadlinePressure(stage, checkpoints, "2026-07-30")).toBe(3);
  });

  it("stays low when the sustained rate is comfortably ahead of what's required", () => {
    const stage = makeStage({ scopeUnitTotal: 10, targetDate: "2026-12-01" });
    const checkpoints: Checkpoint[] = [
      { id: "c1", stageId: "stage-1", value: 0, loggedAt: "2026-07-01T00:00:00.000Z" },
      { id: "c2", stageId: "stage-1", value: 5, loggedAt: "2026-07-30T00:00:00.000Z" },
    ];
    expect(deadlinePressure(stage, checkpoints, "2026-07-30")).toBeLessThan(1);
  });
});

describe("scarcityMultiplier", () => {
  it("is strictly higher for fewer remaining eligible dayparts (D9)", () => {
    expect(scarcityMultiplier(1)).toBeGreaterThan(scarcityMultiplier(2));
    expect(scarcityMultiplier(2)).toBeGreaterThan(scarcityMultiplier(4));
  });

  it("clamps at n=1 for zero or negative input", () => {
    expect(scarcityMultiplier(0)).toBe(scarcityMultiplier(1));
    expect(scarcityMultiplier(-5)).toBe(scarcityMultiplier(1));
  });
});

describe("scoreStage", () => {
  it("weights higher tiers (lower number) above lower tiers, all else equal", () => {
    const stage = makeStage({ cadenceCount: 1 });
    const history: SessionLog[] = [];
    const base = {
      stage,
      history,
      checkpoints: [] as Checkpoint[],
      windowStart: "2026-07-27",
      windowEnd: "2026-08-02",
      today: "2026-07-30",
      eligibleDaypartsRemainingToday: 1,
    };
    const critical = scoreStage({ ...base, goal: makeGoal({ tier: 1 }) });
    const background = scoreStage({ ...base, goal: makeGoal({ tier: 3 }) });
    expect(critical.total).toBeGreaterThan(background.total);
  });

  it("weights scarcer stages above less scarce ones, all else equal", () => {
    const stage = makeStage({ cadenceCount: 1 });
    const goal = makeGoal();
    const base = {
      stage,
      goal,
      history: [] as SessionLog[],
      checkpoints: [] as Checkpoint[],
      windowStart: "2026-07-27",
      windowEnd: "2026-08-02",
      today: "2026-07-30",
    };
    const scarce = scoreStage({ ...base, eligibleDaypartsRemainingToday: 1 });
    const abundant = scoreStage({ ...base, eligibleDaypartsRemainingToday: 3 });
    expect(scarce.total).toBeGreaterThan(abundant.total);
  });
});
