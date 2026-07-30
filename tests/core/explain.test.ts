import { describe, expect, it } from "vitest";
import { explainSlot } from "@/core/explain";
import type { Daypart, Goal, PlanSlot, Stage } from "@/core/types";

const morning: Daypart = { id: "morning", name: "morning", startTime: "06:00", endTime: "10:00", activeCap: 3, sortOrder: 0 };
const evening: Daypart = { id: "evening", name: "evening", startTime: "18:00", endTime: "22:00", activeCap: 3, sortOrder: 2 };

const goal: Goal = { id: "goal-1", name: "gym", purpose: "fitness", tier: 1, state: "active" };
const stage: Stage = {
  id: "stage-1",
  goalId: "goal-1",
  sessionMinutes: 45,
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
};

const slot: PlanSlot = {
  id: "slot-1",
  stageId: "stage-1",
  weekStart: "2026-07-27",
  date: "2026-07-30",
  daypartId: "morning",
  minutes: 45,
};

describe("explainSlot", () => {
  it("matches the D14 worked example shape: ordinal, count, urgency, scarcity", () => {
    const text = explainSlot(slot, {
      goal,
      stage,
      daypart: morning,
      ordinal: 3,
      totalThisWindow: 4,
      daysLeftInWindow: 3,
      eligibleDaypartsToday: [morning],
    });
    expect(text).toBe("3rd of 4 gym sessions, 3 days left — morning is its only slot today");
  });

  it("uses correct ordinal suffixes: 1st, 2nd, 4th, 11th", () => {
    const base = { goal, stage, daypart: morning, totalThisWindow: 12, daysLeftInWindow: 5, eligibleDaypartsToday: [morning] };
    expect(explainSlot(slot, { ...base, ordinal: 1 })).toContain("1st of 12");
    expect(explainSlot(slot, { ...base, ordinal: 2 })).toContain("2nd of 12");
    expect(explainSlot(slot, { ...base, ordinal: 4 })).toContain("4th of 12");
    expect(explainSlot(slot, { ...base, ordinal: 11 })).toContain("11th of 12");
  });

  it("does not claim scarcity when more than one eligible daypart remains today", () => {
    const text = explainSlot(slot, {
      goal,
      stage,
      daypart: morning,
      ordinal: 1,
      totalThisWindow: 2,
      daysLeftInWindow: 4,
      eligibleDaypartsToday: [morning, evening],
    });
    expect(text).not.toContain("only slot");
    expect(text).toContain("— morning");
  });

  it("says 'last day this week' rather than '1 days left'", () => {
    const text = explainSlot(slot, {
      goal,
      stage,
      daypart: morning,
      ordinal: 4,
      totalThisWindow: 4,
      daysLeftInWindow: 1,
      eligibleDaypartsToday: [morning],
    });
    expect(text).toContain("last day this week");
    expect(text).not.toMatch(/1 days left/);
  });
});
