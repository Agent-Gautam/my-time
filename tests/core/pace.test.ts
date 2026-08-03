import { describe, expect, it } from "vitest";
import { cadenceStatus, scopeStatus } from "@/core/pace";
import type { Checkpoint, SessionLog, Stage } from "@/core/types";

function makeStage(overrides: Partial<Stage> = {}): Stage {
  return {
    id: "stage-1",
    goalId: "goal-1",
    sessionMinutes: 60,
    cadenceType: "frequency",
    cadenceCount: 4,
    cadenceDays: null,
    eligibleDayparts: ["morning", "evening"],
    maxPerWeek: null,
    minRestDays: null,
    scopeUnitLabel: "chapter",
    scopeUnitTotal: null,
    targetDate: null,
    deadlineDerived: false,
    sortOrder: 0,
    state: "active",
    ...overrides,
  };
}

function log(overrides: Partial<SessionLog> = {}): SessionLog {
  return {
    id: "s1",
    stageId: "stage-1",
    date: "2026-07-27",
    daypartId: "morning",
    minutes: 60,
    status: "done",
    source: "planned",
    loggedAt: "2026-07-27T08:00:00.000Z",
    taskId: null,
    ...overrides,
  };
}

// 2026-07-27 is a Monday; 2026-07-30 (Thu) sits inside that same Mon..Sun window.
const THURSDAY_NOW = "2026-07-30T09:00:00.000Z";

describe("cadenceStatus", () => {
  it("required is zero once this week's cadence target is already met", () => {
    const stage = makeStage({ cadenceCount: 2 });
    const history = [log({ date: "2026-07-27" }), log({ date: "2026-07-28" })];
    const status = cadenceStatus(stage, history, THURSDAY_NOW);
    expect(status.requiredPerDay).toBe(0);
    expect(status.feasible).toBe(true);
  });

  it("required rises as the week runs out with sessions still owed", () => {
    const stage = makeStage({ cadenceCount: 4 });
    const early = cadenceStatus(stage, [], "2026-07-27T09:00:00.000Z");
    const late = cadenceStatus(stage, [], "2026-08-01T09:00:00.000Z"); // Saturday, same window
    expect(late.requiredPerDay).toBeGreaterThan(early.requiredPerDay);
  });

  it("measures actualPerDay from logged done sessions, ignoring skipped ones", () => {
    const stage = makeStage({ cadenceCount: 4 });
    const history = [
      log({ date: "2026-07-27", status: "done" }),
      log({ date: "2026-07-28", status: "skipped" }),
    ];
    const status = cadenceStatus(stage, history, THURSDAY_NOW);
    expect(status.actualPerDay).toBeGreaterThan(0);
    expect(status.actualPerDay).toBeLessThanOrEqual(1);
  });

  it("is infeasible when more sessions are owed than days remain (D15: reports, never punishes)", () => {
    const stage = makeStage({ cadenceCount: 4 });
    // Sunday of the same window, only 1 day left, but 4 still owed
    const status = cadenceStatus(stage, [], "2026-08-02T09:00:00.000Z");
    expect(status.feasible).toBe(false);
  });

  it("is infeasible when min_rest_days makes the remaining count unreachable (D20)", () => {
    const stage = makeStage({ cadenceCount: 3, minRestDays: 3 });
    // Wed of the window: 2 days remain (wed..thu excluded — recompute below), owed 3
    const status = cadenceStatus(stage, [], "2026-07-29T09:00:00.000Z");
    expect(status.feasible).toBe(false);
  });

  // D64. This replaces "respects maxPerWeek as a hard ceiling on feasibility",
  // which asserted the opposite. Feasibility is about the days and rest gaps left
  // in the window. `maxPerWeek` bounds voluntary catch-up (D20) and is not a
  // scheduling input, so it cannot make a stated cadence unreachable — the old
  // clause reduced algebraically to `required > maxPerWeek`, a config-validity
  // check reported through the feasibility channel.
  it("maxPerWeek does not decide feasibility (D64)", () => {
    const stage = makeStage({ cadenceCount: 5, maxPerWeek: 3 });
    const status = cadenceStatus(stage, [], "2026-07-27T09:00:00.000Z");
    expect(status.feasible).toBe(true); // 5 sessions, 7 days, no rest gap
  });

  it("still reports infeasible for the same stage once the days genuinely run out", () => {
    const stage = makeStage({ cadenceCount: 5, maxPerWeek: 3 });
    const status = cadenceStatus(stage, [], "2026-08-01T09:00:00.000Z"); // Sat, 2 days left
    expect(status.feasible).toBe(false);
  });
});

describe("scopeStatus", () => {
  it("returns all-null for cadence-only stages with no scope tracking", () => {
    const stage = makeStage();
    const status = scopeStatus(stage, [], [], THURSDAY_NOW);
    expect(status.requiredPerUnit).toBeNull();
    expect(status.measuredPerUnit).toBeNull();
    expect(status.projection).toBeNull();
  });

  it("day one: requiredPerUnit exists with zero data, measuredPerUnit and projection don't (D25)", () => {
    const stage = makeStage({ scopeUnitTotal: 30, targetDate: "2026-12-01" });
    const status = scopeStatus(stage, [], [], THURSDAY_NOW);
    expect(status.requiredPerUnit).not.toBeNull();
    expect(status.requiredPerUnit).toBeGreaterThan(0);
    expect(status.measuredPerUnit).toBeNull();
    expect(status.projection).toBeNull();
  });

  it("produces a measured rate and a projection once a checkpoint exists", () => {
    const stage = makeStage({ scopeUnitTotal: 30, targetDate: "2026-12-01" });
    const checkpoints: Checkpoint[] = [{ id: "c1", stageId: "stage-1", value: 3, loggedAt: "2026-07-30T00:00:00.000Z" }];
    const history: SessionLog[] = Array.from({ length: 14 }, (_, i) =>
      log({ id: `s${i}`, date: `2026-07-${(i % 27) + 1}`.padStart(10, "0"), status: "done" }),
    );
    const status = scopeStatus(stage, checkpoints, history, THURSDAY_NOW);
    expect(status.measuredPerUnit).toBeCloseTo(14 / 3, 5);
    expect(status.projection).not.toBeNull();
    expect(status.projection!.earliest.localeCompare(status.projection!.finishDate)).toBeLessThanOrEqual(0);
    expect(status.projection!.latest.localeCompare(status.projection!.finishDate)).toBeGreaterThanOrEqual(0);
  });

  it("the projection range narrows as more checkpoints accumulate (D25)", () => {
    const stage = makeStage({ scopeUnitTotal: 30, targetDate: "2026-12-01" });
    const history: SessionLog[] = Array.from({ length: 14 }, (_, i) =>
      log({ id: `s${i}`, date: "2026-07-15", status: "done" }),
    );
    const oneCheckpoint: Checkpoint[] = [{ id: "c1", stageId: "stage-1", value: 3, loggedAt: "2026-07-30T00:00:00.000Z" }];
    const manyCheckpoints: Checkpoint[] = Array.from({ length: 10 }, (_, i) => ({
      id: `c${i}`,
      stageId: "stage-1",
      value: i + 1,
      loggedAt: `2026-07-${String(i + 1).padStart(2, "0")}T00:00:00.000Z`,
    }));

    const early = scopeStatus(stage, oneCheckpoint, history, THURSDAY_NOW);
    const mature = scopeStatus(stage, manyCheckpoints, history, THURSDAY_NOW);

    const earlySpan = diffDaysHelper(early.projection!.latest, early.projection!.earliest);
    const matureSpan = diffDaysHelper(mature.projection!.latest, mature.projection!.earliest);
    expect(matureSpan).toBeLessThan(earlySpan);
  });

  it("reports zero remaining and a same-day projection once scope is complete", () => {
    const stage = makeStage({ scopeUnitTotal: 10, targetDate: "2026-12-01" });
    const checkpoints: Checkpoint[] = [{ id: "c1", stageId: "stage-1", value: 10, loggedAt: "2026-07-30T00:00:00.000Z" }];
    const status = scopeStatus(stage, checkpoints, [], THURSDAY_NOW);
    expect(status.requiredPerUnit).toBe(0);
    expect(status.projection).toEqual({ finishDate: "2026-07-30", earliest: "2026-07-30", latest: "2026-07-30" });
  });
});

function diffDaysHelper(a: string, b: string): number {
  const toUtc = (d: string) => Date.UTC(...(d.split("-").map(Number) as [number, number, number]));
  return Math.round((toUtc(a) - toUtc(b)) / 86_400_000);
}
