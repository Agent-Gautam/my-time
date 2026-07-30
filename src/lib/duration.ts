// How a length of time is written, everywhere in the app. One function, because a
// number that renders as "45m" on one screen and "0.75h" on another reads as two
// different quantities.
//
// Under an hour stays in minutes; an hour or more reads in hours, because "2h 30m"
// is graspable at a glance and "150m" is arithmetic. Whole hours drop the minutes
// entirely — "2h", never "2h 0m".
//
// Pure and clock-free, but deliberately in `lib/` rather than `core/`: this is
// presentation, and `core/` is the scheduler (D34, D42).

/**
 * `formatDuration(45)` → `"45m"` · `(60)` → `"1h"` · `(150)` → `"2h 30m"`
 *
 * Negative input clamps to zero — a duration is never negative, and rendering "-5m"
 * would be a bug leaking into the UI.
 */
export function formatDuration(minutes: number): string {
  if (!Number.isFinite(minutes)) return "—";

  const total = Math.max(0, Math.round(minutes));
  if (total < 60) return `${total}m`;

  const hours = Math.floor(total / 60);
  const rest = total % 60;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

/**
 * The same split, spelled out — for labels and screen readers, where "1h 30m" is
 * terse to the point of being a code.
 *
 * `formatDurationLong(90)` → `"1 hour 30 minutes"`
 */
export function formatDurationLong(minutes: number): string {
  if (!Number.isFinite(minutes)) return "unknown";

  const total = Math.max(0, Math.round(minutes));
  const hours = Math.floor(total / 60);
  const rest = total % 60;

  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours} hour${hours === 1 ? "" : "s"}`);
  if (rest > 0 || hours === 0) parts.push(`${rest} minute${rest === 1 ? "" : "s"}`);
  return parts.join(" ");
}
