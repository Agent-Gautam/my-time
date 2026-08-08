// Internal date arithmetic for the scheduler. All functions take dates as explicit
// string inputs — never `new Date()`, never `Date.now()` (D34, D42: no ambient clock).
import type { IsoDate, IsoDateTime, Weekday } from "./types";

const WEEKDAYS: Weekday[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const MONDAY_START_INDEX: Record<Weekday, number> = {
  mon: 0,
  tue: 1,
  wed: 2,
  thu: 3,
  fri: 4,
  sat: 5,
  sun: 6,
};

export function parseIsoDate(date: IsoDate): Date {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function formatIsoDate(date: Date): IsoDate {
  return date.toISOString().slice(0, 10);
}

export function addDays(date: IsoDate, days: number): IsoDate {
  const d = parseIsoDate(date);
  d.setUTCDate(d.getUTCDate() + days);
  return formatIsoDate(d);
}

// a - b, in days. Positive when a is after b.
export function diffDays(a: IsoDate, b: IsoDate): number {
  const ms = parseIsoDate(a).getTime() - parseIsoDate(b).getTime();
  return Math.round(ms / 86_400_000);
}

export function weekdayOf(date: IsoDate): Weekday {
  return WEEKDAYS[parseIsoDate(date).getUTCDay()];
}

export function dateOnly(dt: IsoDateTime): IsoDate {
  return dt.slice(0, 10);
}

export function isInRange(date: IsoDate, start: IsoDate, end: IsoDate): boolean {
  return diffDays(date, start) >= 0 && diffDays(date, end) <= 0;
}

// Monday-start week containing `date`, for computations (pace.ts) that don't
// receive an externally-supplied weekStart the way layoutWeek does.
export function isoWeekStart(date: IsoDate): IsoDate {
  return addDays(date, -MONDAY_START_INDEX[weekdayOf(date)]);
}

/**
 * Week-start from an arbitrary first-day-of-week. Used by device-aware callers
 * (queries.ts `weekStartForDate`) that have access to the user's setting.
 * Pure-core callers that cannot read device state use `isoWeekStart` (Monday-fixed).
 */
export function isoWeekStartFrom(date: IsoDate, firstDay: Weekday): IsoDate {
  const ORDER: Weekday[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  const firstIdx = ORDER.indexOf(firstDay);
  const dateIdx = ORDER.indexOf(weekdayOf(date));
  // How many days back to go to reach the most recent `firstDay`.
  const offset = (dateIdx - firstIdx + 7) % 7;
  return addDays(date, -offset);
}

export function datesInRange(start: IsoDate, end: IsoDate): IsoDate[] {
  const days: IsoDate[] = [];
  for (let d = start; diffDays(d, end) <= 0; d = addDays(d, 1)) {
    days.push(d);
  }
  return days;
}
