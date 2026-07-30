// The night daypart wraps past midnight, which is the case every naive
// implementation gets wrong, so it carries most of the assertions here.

import { describe, expect, it } from "vitest";

import type { Daypart } from "@/core/types";
import {
  currentDaypart,
  daypartContains,
  daypartDate,
  daypartEndsAt,
  daypartLengthMinutes,
  daypartsRemainingToday,
  eligibleDaypartsRemainingToday,
  localNow,
  minutesRemainingIn,
} from "@/lib/daypart";

const daypart = (
  id: string,
  name: string,
  startTime: string,
  endTime: string,
  sortOrder: number,
): Daypart => ({ id, name, startTime, endTime, activeCap: 2, sortOrder });

const MORNING = daypart("morning", "morning", "05:00", "12:00", 0);
const AFTERNOON = daypart("afternoon", "afternoon", "12:00", "17:00", 1);
const EVENING = daypart("evening", "evening", "17:00", "21:00", 2);
const NIGHT = daypart("night", "night", "21:00", "05:00", 3);

const DEFAULTS = [MORNING, AFTERNOON, EVENING, NIGHT];

describe("currentDaypart", () => {
  it("finds the plain daytime dayparts", () => {
    expect(currentDaypart(DEFAULTS, "2026-07-30T06:30:00")?.id).toBe("morning");
    expect(currentDaypart(DEFAULTS, "2026-07-30T13:00:00")?.id).toBe("afternoon");
    expect(currentDaypart(DEFAULTS, "2026-07-30T20:59:00")?.id).toBe("evening");
  });

  it("finds the night daypart on both sides of midnight", () => {
    expect(currentDaypart(DEFAULTS, "2026-07-30T21:00:00")?.id).toBe("night");
    expect(currentDaypart(DEFAULTS, "2026-07-30T23:59:00")?.id).toBe("night");
    expect(currentDaypart(DEFAULTS, "2026-07-30T00:00:00")?.id).toBe("night");
    expect(currentDaypart(DEFAULTS, "2026-07-30T04:59:00")?.id).toBe("night");
  });

  it("gives a boundary minute to the daypart it opens, not the one it closes", () => {
    // 12:00 is afternoon's first minute, not morning's last.
    expect(currentDaypart(DEFAULTS, "2026-07-30T12:00:00")?.id).toBe("afternoon");
    expect(currentDaypart(DEFAULTS, "2026-07-30T05:00:00")?.id).toBe("morning");
  });

  it("returns null in a gap between boundaries", () => {
    const gapped = [
      daypart("early", "early", "05:00", "12:00", 0),
      daypart("late", "late", "13:00", "21:00", 1),
    ];
    expect(currentDaypart(gapped, "2026-07-30T12:30:00")).toBeNull();
    expect(currentDaypart(gapped, "2026-07-30T03:00:00")).toBeNull();
  });

  it("treats a zero-width daypart as covering the whole day rather than nothing", () => {
    const allDay = daypart("all", "all", "09:00", "09:00", 0);
    expect(daypartLengthMinutes(allDay)).toBe(1440);
    expect(daypartContains(allDay, "2026-07-30T03:00:00")).toBe(true);
  });
});

describe("daypartLengthMinutes", () => {
  it("measures a plain daypart", () => {
    expect(daypartLengthMinutes(MORNING)).toBe(7 * 60);
    expect(daypartLengthMinutes(EVENING)).toBe(4 * 60);
  });

  it("measures across midnight", () => {
    expect(daypartLengthMinutes(NIGHT)).toBe(8 * 60);
  });
});

describe("daypartEndsAt", () => {
  it("ends a plain daypart on the same day", () => {
    expect(daypartEndsAt(MORNING, "2026-07-30T06:30:00")).toBe("2026-07-30T12:00:00");
  });

  it("ends the night daypart tomorrow when we are before midnight", () => {
    expect(daypartEndsAt(NIGHT, "2026-07-30T22:00:00")).toBe("2026-07-31T05:00:00");
  });

  it("ends the night daypart today when we are already past midnight", () => {
    // Same occurrence of night, so the end has not moved a day.
    expect(daypartEndsAt(NIGHT, "2026-07-31T02:00:00")).toBe("2026-07-31T05:00:00");
  });

  it("rolls a 24:00 boundary to midnight of the next day", () => {
    const toMidnight = daypart("late", "late", "21:00", "24:00", 0);
    expect(daypartEndsAt(toMidnight, "2026-07-30T22:00:00")).toBe("2026-07-31T00:00:00");
  });
});

describe("minutesRemainingIn", () => {
  it("counts down inside a plain daypart", () => {
    expect(minutesRemainingIn(MORNING, "2026-07-30T11:30:00")).toBe(30);
    expect(minutesRemainingIn(MORNING, "2026-07-30T05:00:00")).toBe(420);
  });

  it("counts across midnight inside the night daypart", () => {
    expect(minutesRemainingIn(NIGHT, "2026-07-30T23:00:00")).toBe(6 * 60);
    expect(minutesRemainingIn(NIGHT, "2026-07-31T04:30:00")).toBe(30);
  });

  it("is 0 for a daypart that has already ended today", () => {
    expect(minutesRemainingIn(MORNING, "2026-07-30T14:00:00")).toBe(0);
  });

  it("is 0 for a daypart that has not started yet", () => {
    expect(minutesRemainingIn(EVENING, "2026-07-30T09:00:00")).toBe(0);
  });
});

describe("daypartsRemainingToday", () => {
  it("counts the current daypart plus the ones still to come", () => {
    const ids = daypartsRemainingToday(DEFAULTS, "2026-07-30T13:00:00").map((d) => d.id);
    expect(ids).toEqual(["afternoon", "evening", "night"]);
  });

  it("drops nothing first thing in the morning", () => {
    const ids = daypartsRemainingToday(DEFAULTS, "2026-07-30T05:30:00").map((d) => d.id);
    expect(ids).toEqual(["morning", "afternoon", "evening", "night"]);
  });

  it("keeps every daypart in the small hours — night is current, the rest are ahead", () => {
    const ids = daypartsRemainingToday(DEFAULTS, "2026-07-30T02:00:00").map((d) => d.id);
    expect(ids).toEqual(["morning", "afternoon", "evening", "night"]);
  });
});

describe("daypartDate", () => {
  it("anchors a plain daypart to today", () => {
    expect(daypartDate(MORNING, "2026-07-30T06:30:00")).toBe("2026-07-30");
    expect(daypartDate(AFTERNOON, "2026-07-30T13:00:00")).toBe("2026-07-30");
  });

  it("anchors the pre-midnight half of night to today", () => {
    expect(daypartDate(NIGHT, "2026-07-30T22:30:00")).toBe("2026-07-30");
    expect(daypartDate(NIGHT, "2026-07-30T23:59:00")).toBe("2026-07-30");
  });

  it("anchors the post-midnight half of night to YESTERDAY", () => {
    // Still Thursday night's occurrence, even though the calendar says Friday.
    // Reading the plan by today's date here finds nothing at all.
    expect(daypartDate(NIGHT, "2026-07-31T00:01:00")).toBe("2026-07-30");
    expect(daypartDate(NIGHT, "2026-07-31T02:00:00")).toBe("2026-07-30");
    expect(daypartDate(NIGHT, "2026-07-31T04:59:00")).toBe("2026-07-30");
  });

  it("rolls back to today once the wrap has ended", () => {
    expect(daypartDate(NIGHT, "2026-07-31T05:00:00")).toBe("2026-07-31");
  });

  it("keeps a Sunday-night session in Sunday's week after midnight", () => {
    // 2026-08-02 is a Sunday; 01:00 Monday still belongs to Sunday's cadence week.
    expect(daypartDate(NIGHT, "2026-08-03T01:00:00")).toBe("2026-08-02");
  });
});

describe("eligibleDaypartsRemainingToday", () => {
  it("counts only the stage's own eligible dayparts", () => {
    const stage = { eligibleDayparts: ["morning", "evening"] };
    expect(eligibleDaypartsRemainingToday(DEFAULTS, stage, "2026-07-30T06:00:00")).toBe(2);
    expect(eligibleDaypartsRemainingToday(DEFAULTS, stage, "2026-07-30T13:00:00")).toBe(1);
  });

  it("returns 0 honestly once every eligible daypart is spent", () => {
    const stage = { eligibleDayparts: ["morning"] };
    expect(eligibleDaypartsRemainingToday(DEFAULTS, stage, "2026-07-30T18:00:00")).toBe(0);
  });
});

describe("localNow", () => {
  it("formats local wall-clock time, never UTC", () => {
    // 30 July 2026, 22:15:05 local — whatever the machine's zone is.
    const d = new Date(2026, 6, 30, 22, 15, 5);
    expect(localNow(d)).toBe("2026-07-30T22:15:05");
  });

  it("keeps the local calendar date that a UTC timestamp would have moved", () => {
    const d = new Date(2026, 6, 30, 23, 30, 0);
    expect(localNow(d).slice(0, 10)).toBe("2026-07-30");
  });
});
