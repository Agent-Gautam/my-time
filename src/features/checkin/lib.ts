// View-layer helpers for check-in, logging and the on-track summary. No scheduling
// logic lives here — that's core/ and features/plan/planner.ts, which this only calls.
import type { CadenceStatus, ScopeStatus } from "@/core/pace";
import { cadenceStatus, scopeStatus } from "@/core/pace";
import { addDays, dateOnly, diffDays, isoWeekStart } from "@/core/dateUtils";
import type { IsoDate, IsoDateTime, Stage } from "@/core/types";
import {
  getActiveGoals,
  getActiveStages,
  getCheckpointsForStage,
  getDayparts,
  getPlanSlotsForDaypart,
  getPlanSlotsForWeek,
  getSessionLogsBetween,
  getSessionLogsForStage,
  getTasksBetween,
  LOCAL_HISTORY_WINDOW_DAYS,
  weekStartForDate,
} from "@/db/local/queries";
import { daypartEndsAt } from "@/lib/daypart";

/**
 * Sum of minutes for everything still planned in this daypart occurrence (D8) — the
 * same "renderable" filter `planner.reconcileNow` uses, so the number shown before
 * check-in matches what reconciliation actually considers.
 */
export async function requiredMinutesForDaypart(
  date: IsoDate,
  daypartId: string,
): Promise<number> {
  const [goals, stages, slots] = await Promise.all([
    getActiveGoals(),
    getActiveStages(),
    getPlanSlotsForDaypart(date, daypartId),
  ]);
  const activeGoalIds = new Set(goals.map((g) => g.id));
  const stagesById = new Map(stages.map((s) => [s.id, s]));
  return slots.reduce((sum, slot) => {
    const stage = stagesById.get(slot.stageId);
    if (!stage || !activeGoalIds.has(stage.goalId)) return sum;
    return sum + slot.minutes;
  }, 0);
}

export interface GoalPaceStatus {
  cadence: CadenceStatus;
  scope: ScopeStatus;
}

/** Bounded read of one stage's history/checkpoints (D47), then the two pure
 *  pace.ts questions (PRD §6.7). Uses the active plan's week window so cadence
 *  status matches the window the scheduler actually used (e.g. after Start Fresh). */
export async function goalPaceStatus(stage: Stage, now: IsoDateTime): Promise<GoalPaceStatus> {
  const today = dateOnly(now);
  const from = addDays(today, -LOCAL_HISTORY_WINDOW_DAYS);
  // Use the same week window the plan was laid out with, not the Monday-anchored default.
  const weekStart = await weekStartForDate(today);
  const [history, checkpoints] = await Promise.all([
    getSessionLogsForStage(stage.id, from, today),
    stage.scopeUnitTotal != null && stage.targetDate != null
      ? getCheckpointsForStage(stage.id)
      : Promise.resolve([]),
  ]);
  return {
    cadence: cadenceStatus(stage, history, now, weekStart),
    scope: scopeStatus(stage, checkpoints, history, now),
  };
}

export type PaceLevel = "on-track" | "attention" | "blocked";

/** design.md §2.3's three bands, named from cadenceStatus's own fields — no new
 *  arithmetic, just picking the word the design system already has for it. */
export function cadenceLevel(status: CadenceStatus): PaceLevel {
  if (!status.feasible) return "blocked";
  return status.actualPerDay >= status.requiredPerDay ? "on-track" : "attention";
}

// Literal class names, not template interpolation — Tailwind's scanner needs the
// full utility string in source to generate it (D52 semantic tokens only).
export const PACE_TEXT_CLASS: Record<PaceLevel, string> = {
  "on-track": "text-on-track",
  attention: "text-attention",
  blocked: "text-blocked",
};
export const PACE_DOT_CLASS: Record<PaceLevel, string> = {
  "on-track": "bg-on-track",
  attention: "bg-attention",
  blocked: "bg-blocked",
};

export const PACE_LABEL: Record<PaceLevel, string> = {
  "on-track": "On track",
  attention: "Attention",
  blocked: "Not reachable this week",
};

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** `IsoDate` is `YYYY-MM-DD` — parsed by hand rather than `new Date()`, so there is
 *  no timezone step between the string and the digits already in it. */
export function formatIsoDate(date: IsoDate): string {
  const [, m, d] = date.split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}`;
}

/** `IsoDateTime` is local wall-clock (`lib/daypart.ts`) — slicing is the whole job. */
export function formatClockTime(dt: IsoDateTime): string {
  return dt.slice(11, 16);
}

export function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

const CHECKPOINT_PROMPT_INTERVAL_DAYS = 7;

/**
 * "Occasionally" (PRD §6.6, D13) — once a week is a reasonable default cadence for
 * the coarse checkpoint prompt. Not a scheduling coefficient, so it stays local
 * rather than in core/constants.ts.
 */
export function shouldPromptCheckpoint(
  now: IsoDateTime,
  latestCheckpointLoggedAt: IsoDateTime | undefined,
): boolean {
  if (!latestCheckpointLoggedAt) return true;
  const daysSince = diffDaysBetweenDateTimes(now, latestCheckpointLoggedAt);
  return daysSince >= CHECKPOINT_PROMPT_INTERVAL_DAYS;
}

function diffDaysBetweenDateTimes(a: IsoDateTime, b: IsoDateTime): number {
  return Math.abs(diffDays(dateOnly(a), dateOnly(b)));
}

// ---------------------------------------------------------------------------
// Missed sessions (/missed) — Architecture.md §9.3, D20
// ---------------------------------------------------------------------------
//
// "Missed" is an *unlogged* session whose daypart occurrence has already ended —
// the primary case is the user never opening the app for it at all, which is why
// this can't be read off `sessionLogs` alone. An explicit one-tap "Skipped" is
// also shown, since PRD §6.6 treats both as the same neutral outcome; a stage
// only ever appears in one or the other; `loggedDates` below is what keeps them
// from double-counting the same (stageId, date).
//
// One-off tasks (D68) are missed on the identical rule and appear here too, tagged
// `source: "task"`. That discriminant is load-bearing: a task has no stage, so a
// caller that reaches for `stageId` unconditionally would look up nothing and render
// it as a deleted goal.

export type MissedKind = "unlogged" | "skipped";

interface MissedBase {
  key: string;
  date: IsoDate;
  daypartId: string;
  minutes: number;
  kind: MissedKind;
}

export interface MissedSession extends MissedBase {
  source: "session";
  stageId: string;
}

/**
 * A one-off task whose daypart ended unanswered, or one that was skipped (D68). It
 * carries its own title because it belongs to no goal — the `source` discriminant is
 * what stops a caller reaching for a stage that does not exist.
 */
export interface MissedTask extends MissedBase {
  source: "task";
  taskId: string;
  title: string;
}

export type MissedOccurrence = MissedSession | MissedTask;

/**
 * Missed occurrences for one week, bounded to that week's plan slots and logs —
 * both already indexed range reads (D47). The caller scans backward week by week
 * (see `app/missed/page.tsx`) rather than this function scanning history itself,
 * so each call stays a small, boundable unit of work.
 */
export async function missedForWeek(
  weekStart: IsoDate,
  now: IsoDateTime,
): Promise<MissedOccurrence[]> {
  const weekEnd = addDays(weekStart, 6);
  const [dayparts, slots, logs, tasks] = await Promise.all([
    getDayparts(),
    getPlanSlotsForWeek(weekStart),
    getSessionLogsBetween(weekStart, weekEnd),
    getTasksBetween(weekStart, weekEnd),
  ]);

  const daypartsById = new Map(dayparts.map((dp) => [dp.id, dp]));
  const loggedDates = new Set(logs.map((log) => `${log.stageId}|${log.date}`));

  // Reusing `daypartEndsAt` anchored at the occurrence's own start (rather than
  // "now") gives the correct end instant for a *past* occurrence, including a
  // wrapping night daypart whose end rolls onto the next calendar day.
  const hasPassed = (date: IsoDate, daypartId: string): boolean => {
    const daypart = daypartsById.get(daypartId);
    if (!daypart) return false; // daypart since removed — can't say whether it passed
    return daypartEndsAt(daypart, `${date}T${daypart.startTime}:00`) <= now;
  };

  const unlogged: MissedOccurrence[] = [];
  for (const slot of slots) {
    const key = `${slot.stageId}|${slot.date}`;
    if (loggedDates.has(key)) continue; // already done, skipped, or voluntary-logged
    if (!hasPassed(slot.date, slot.daypartId)) continue; // still ahead, still pending

    unlogged.push({
      source: "session",
      key,
      stageId: slot.stageId,
      date: slot.date,
      daypartId: slot.daypartId,
      minutes: slot.minutes,
      kind: "unlogged",
    });
  }

  const skipped: MissedOccurrence[] = logs
    .filter((log) => log.status === "skipped")
    .map((log) => ({
      source: "session",
      key: `${log.stageId}|${log.date}`,
      stageId: log.stageId,
      date: log.date,
      daypartId: log.daypartId,
      minutes: log.minutes,
      kind: "skipped",
    }));

  // A one-off task is missed on exactly the same rule as a session (D68): skipped
  // outright, or never answered before its daypart ended. A task still inside its
  // occurrence is not missed — it is simply not done yet, and it is on Today.
  const missedTasks: MissedOccurrence[] = tasks
    .filter(
      (task) =>
        task.status === "skipped" ||
        (task.status === "pending" && hasPassed(task.date, task.daypartId)),
    )
    .map((task) => ({
      source: "task",
      // Namespaced so a task id can never collide with a `${stageId}|${date}` key.
      key: `task|${task.id}`,
      taskId: task.id,
      title: task.title,
      date: task.date,
      daypartId: task.daypartId,
      minutes: task.minutes,
      kind: task.status === "skipped" ? "skipped" : "unlogged",
    }));

  return [...unlogged, ...skipped, ...missedTasks].sort((a, b) => diffDays(b.date, a.date));
}

export function currentWeekStart(now: IsoDateTime): IsoDate {
  return isoWeekStart(dateOnly(now));
}

export interface MissedPage {
  occurrences: MissedOccurrence[];
  /** Where a follow-up call should resume, or `null` once the local retention
   *  window (D48) is exhausted. */
  nextWeekStart: IsoDate | null;
  hasMore: boolean;
}

// Bounds how many weeks one "Load more" click scans — a week with nothing missed
// costs one query pair and moves on, but the scan itself must stay bounded (D47)
// rather than looping until it finds something.
const WEEKS_PER_MISSED_SCAN = 4;

/**
 * One bounded page of missed occurrences, scanning backward week by week from
 * `fromWeekStart` until either `WEEKS_PER_MISSED_SCAN` weeks have been read or the
 * local retention window (`LOCAL_HISTORY_WINDOW_DAYS`, D48) is exhausted.
 */
export async function missedOccurrencesPage(
  now: IsoDateTime,
  fromWeekStart: IsoDate,
): Promise<MissedPage> {
  const oldest = addDays(dateOnly(now), -LOCAL_HISTORY_WINDOW_DAYS);

  const occurrences: MissedOccurrence[] = [];
  let cursor = fromWeekStart;
  let hasMore = diffDays(cursor, oldest) >= 0;

  for (let weeksScanned = 0; weeksScanned < WEEKS_PER_MISSED_SCAN && hasMore; weeksScanned++) {
    occurrences.push(...(await missedForWeek(cursor, now)));
    cursor = addDays(cursor, -7);
    hasMore = diffDays(cursor, oldest) >= 0;
  }

  return { occurrences, nextWeekStart: hasMore ? cursor : null, hasMore };
}
