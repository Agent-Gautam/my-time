// Daypart boundary math — "which daypart is it now, and how much of it is left?"
//
// Pure: `now` is always a parameter (the D34 habit, applied outside `core/` too).
// The one exception is `localNow()`, which exists precisely so that reading the
// clock happens in exactly one place instead of being reinvented per screen.
//
// ---------------------------------------------------------------------------
// THE `IsoDateTime` CONVENTION — every caller depends on this
// ---------------------------------------------------------------------------
// `IsoDateTime` is a **local wall-clock** ISO string: `YYYY-MM-DDTHH:mm:ss`,
// with **no `Z` and no offset**. It is the time on the user's own clock.
//
// This is forced, not chosen. `Daypart.startTime`/`endTime` are user-set `"HH:mm"`
// wall-clock strings (D7), and `core/dateUtils.dateOnly()` is `slice(0, 10)`. Both
// only agree with each other if the timestamp is local. Passing
// `new Date().toISOString()` (UTC) instead would put every user east of UTC in the
// wrong daypart, and record sessions against the wrong `date`, after ~18:30 local —
// and it would do so silently, because unit tests pass strings in directly and never
// see the conversion.
//
// So: **never call `new Date().toISOString()` in this app.** Call `localNow()`.
import type { Daypart, IsoDateTime, Stage } from "@/core/types";
import { addDays, dateOnly } from "@/core/dateUtils";

const MINUTES_PER_DAY = 1440;

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * The current local wall-clock time in the convention above. The only sanctioned
 * clock read in the app — everything downstream takes `now` as a parameter.
 */
export function localNow(date: Date = new Date()): IsoDateTime {
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  );
}

/** Minutes since local midnight for a `"HH:mm"` boundary. `"24:00"` is 1440. */
export function minutesOfDay(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/** Minutes since local midnight for a wall-clock timestamp. */
export function minutesSinceMidnight(now: IsoDateTime): number {
  return minutesOfDay(now.slice(11, 16));
}

/**
 * A daypart wraps when its end boundary is at or before its start — night
 * 21:00–05:00 being the case that actually matters. `start === end` falls out of
 * this as a full 24 hours, which is the only reading that leaves the daypart
 * enterable at all.
 */
function wraps(daypart: Daypart): boolean {
  return minutesOfDay(daypart.startTime) >= minutesOfDay(daypart.endTime);
}

/**
 * Half-open `[start, end)`, so a boundary belongs to the daypart it opens: 12:00
 * is afternoon, not the tail of morning. Without this, adjacent dayparts both
 * claim the boundary minute and `currentDaypart` becomes order-dependent.
 */
export function daypartContainsMinute(daypart: Daypart, minute: number): boolean {
  const start = minutesOfDay(daypart.startTime);
  const end = minutesOfDay(daypart.endTime);
  return wraps(daypart) ? minute >= start || minute < end : minute >= start && minute < end;
}

export function daypartContains(daypart: Daypart, now: IsoDateTime): boolean {
  return daypartContainsMinute(daypart, minutesSinceMidnight(now));
}

/** The daypart containing `now`, or null — boundaries may legally leave a gap. */
export function currentDaypart(
  dayparts: readonly Daypart[],
  now: IsoDateTime,
): Daypart | null {
  const minute = minutesSinceMidnight(now);
  return dayparts.find((dp) => daypartContainsMinute(dp, minute)) ?? null;
}

/** Wall-clock length. A wrapping daypart runs to midnight and on into the next day. */
export function daypartLengthMinutes(daypart: Daypart): number {
  const start = minutesOfDay(daypart.startTime);
  const end = minutesOfDay(daypart.endTime);
  return wraps(daypart) ? MINUTES_PER_DAY - start + end : end - start;
}

/**
 * The next occurrence of this daypart's end boundary at or after `now`. For the
 * daypart that currently contains `now` — the only one the check-in screen asks
 * about (D8: "when it ends") — that is the end of the occurrence you are in.
 *
 * Night 21:00–05:00 is the case to get right, and it has two halves: at 22:00 the
 * end is 05:00 *tomorrow*; at 02:00 you are still inside the same occurrence and
 * the end is 05:00 *today*.
 */
export function daypartEndsAt(daypart: Daypart, now: IsoDateTime): IsoDateTime {
  const today = dateOnly(now);
  const end = minutesOfDay(daypart.endTime);
  const date = end > minutesSinceMidnight(now) ? today : addDays(today, 1);
  // "24:00" is a legal boundary meaning midnight; normalise it to 00:00 next day.
  if (end >= MINUTES_PER_DAY) return `${addDays(date, 1)}T00:00:00`;
  return `${date}T${pad(Math.floor(end / 60))}:${pad(end % 60)}:00`;
}

/**
 * Minutes left in `daypart`, or **0 when `now` is not inside it** — including when
 * it has already ended today. "How much is left" is only a meaningful question
 * about the daypart you are actually in, and returning a large number for one that
 * ended hours ago would quietly inflate the check-in arithmetic.
 */
export function minutesRemainingIn(daypart: Daypart, now: IsoDateTime): number {
  if (!daypartContains(daypart, now)) return 0;
  const nowMinute = minutesSinceMidnight(now);
  const end = minutesOfDay(daypart.endTime);
  const remaining = end > nowMinute ? end - nowMinute : MINUTES_PER_DAY - nowMinute + end;
  return Math.max(remaining, 0);
}

/**
 * Dayparts still ahead today: the one `now` is inside, plus any that have not yet
 * started. A wrapping night daypart counts from the morning on, because its start
 * boundary is still ahead on the clock.
 */
export function daypartsRemainingToday(
  dayparts: readonly Daypart[],
  now: IsoDateTime,
): Daypart[] {
  const minute = minutesSinceMidnight(now);
  return dayparts.filter(
    (dp) => daypartContainsMinute(dp, minute) || minutesOfDay(dp.startTime) > minute,
  );
}

/**
 * How many of a stage's eligible dayparts are still ahead today — the input to
 * `score.scarcityMultiplier` (D9). Returned honestly, including 0; the multiplier
 * clamps to >= 1 itself.
 */
export function eligibleDaypartsRemainingToday(
  dayparts: readonly Daypart[],
  stage: Pick<Stage, "eligibleDayparts">,
  now: IsoDateTime,
): number {
  return daypartsRemainingToday(dayparts, now).filter((dp) =>
    stage.eligibleDayparts.includes(dp.id),
  ).length;
}
