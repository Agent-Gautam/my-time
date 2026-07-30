import { describe, expect, it } from "vitest";
import { formatDuration, formatDurationLong } from "@/lib/duration";

describe("formatDuration", () => {
  it("stays in minutes below an hour", () => {
    expect(formatDuration(0)).toBe("0m");
    expect(formatDuration(1)).toBe("1m");
    expect(formatDuration(45)).toBe("45m");
    expect(formatDuration(59)).toBe("59m");
  });

  it("switches to hours at exactly 60", () => {
    expect(formatDuration(60)).toBe("1h");
    expect(formatDuration(61)).toBe("1h 1m");
  });

  it("drops the minutes on a whole hour", () => {
    expect(formatDuration(120)).toBe("2h");
    expect(formatDuration(180)).toBe("3h");
  });

  it("reads a mixed duration as hours and minutes", () => {
    expect(formatDuration(90)).toBe("1h 30m");
    expect(formatDuration(150)).toBe("2h 30m");
    expect(formatDuration(485)).toBe("8h 5m");
  });

  it("clamps negatives and rounds fractions rather than leaking them to the UI", () => {
    expect(formatDuration(-5)).toBe("0m");
    expect(formatDuration(29.6)).toBe("30m");
    expect(formatDuration(Number.NaN)).toBe("—");
  });
});

describe("formatDurationLong", () => {
  it("spells the units out and pluralises them", () => {
    expect(formatDurationLong(1)).toBe("1 minute");
    expect(formatDurationLong(45)).toBe("45 minutes");
    expect(formatDurationLong(60)).toBe("1 hour");
    expect(formatDurationLong(90)).toBe("1 hour 30 minutes");
    expect(formatDurationLong(120)).toBe("2 hours");
  });

  it("says zero minutes rather than nothing at all", () => {
    expect(formatDurationLong(0)).toBe("0 minutes");
  });
});
