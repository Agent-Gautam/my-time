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
  getGoalsWithStage,
  getPlanSlotsForDaypart,
  getPlanSlotsForWeek,
  getSessionLogsBetween,
  getSessionLogsForStage,
  LOCAL_HISTORY_WINDOW_DAYS,
} from "@/db/local/queries";
import type { LocalGoal, LocalStage } from "@/db/local/schema";
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
 *  pace.ts questions (PRD §6.7). */
export async function goalPaceStatus(stage: Stage, now: IsoDateTime): Promise<GoalPaceStatus> {
  const today = dateOnly(now);
  const from = addDays(today, -LOCAL_HISTORY_WINDOW_DAYS);
  const [history, checkpoints] = await Promise.all([
    getSessionLogsForStage(stage.id, from, today),
    stage.scopeUnitTotal != null && stage.targetDate != null
      ? getCheckpointsForStage(stage.id)
      : Promise.resolve([]),
  ]);
  return {
    cadence: cadenceStatus(stage, history, now),
    scope: scopeStatus(stage, checkpoints, history, now),
  };
}

export interface VoluntaryCandidate {
  goal: LocalGoal;
  stage: LocalStage;
}

// Wide enough to see any realistic `minRestDays` gap without an unbounded scan
// (D47) — recovery constraints are set in days, not weeks.
const RECOVERY_LOOKBACK_DAYS = 30;

/**
 * Active stages open for voluntary catch-up right now (Architecture.md §9.3, D20):
 * not already logged today — one session per stage per date (D54) applies to a
 * voluntary log exactly as it does to a planned one — and not blocked by
 * `maxPerWeek`/`minRestDays` where the stage sets them.
 *
 * `excludeStageIds` is the caller's own "already offered above" set — stages with
 * a plan slot already rendered in `keep`/`dropped` for this daypart shouldn't get
 * a second, redundant logging affordance.
 */
export async function voluntaryCandidates(
  excludeStageIds: ReadonlySet<string>,
  today: IsoDate,
): Promise<VoluntaryCandidate[]> {
  const weekStart = isoWeekStart(today);
  const from = addDays(today, -RECOVERY_LOOKBACK_DAYS);

  const goalsWithStage = await getGoalsWithStage({ states: ["active"] });
  const eligible = goalsWithStage.filter(
    (g): g is { goal: LocalGoal; stage: LocalStage } =>
      g.stage != null && !excludeStageIds.has(g.stage.id),
  );

  const results = await Promise.all(
    eligible.map(async ({ goal, stage }) => {
      const history = await getSessionLogsForStage(stage.id, from, today);
      if (history.some((h) => h.date === today)) return null;

      if (stage.maxPerWeek != null) {
        const doneThisWeek = history.filter(
          (h) => h.status === "done" && diffDays(h.date, weekStart) >= 0,
        ).length;
        if (doneThisWeek >= stage.maxPerWeek) return null;
      }

      if (stage.minRestDays != null) {
        const doneDates = history.filter((h) => h.status === "done").map((h) => h.date);
        const lastDone =
          doneDates.length > 0 ? doneDates.reduce((l, d) => (diffDays(d, l) > 0 ? d : l)) : null;
        if (lastDone != null && diffDays(today, lastDone) <= stage.minRestDays) return null;
      }

      return { goal, stage };
    }),
  );

  return results.filter((r): r is VoluntaryCandidate => r != null);
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

export type MissedKind = "unlogged" | "skipped";

export interface MissedOccurrence {
  key: string; // `${stageId}|${date}` — unique per (D54: one session per stage per date)
  stageId: string;
  date: IsoDate;
  daypartId: string;
  minutes: number;
  kind: MissedKind;
}

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
  const [dayparts, slots, logs] = await Promise.all([
    getDayparts(),
    getPlanSlotsForWeek(weekStart),
    getSessionLogsBetween(weekStart, weekEnd),
  ]);

  const daypartsById = new Map(dayparts.map((dp) => [dp.id, dp]));
  const loggedDates = new Set(logs.map((log) => `${log.stageId}|${log.date}`));

  const unlogged: MissedOccurrence[] = [];
  for (const slot of slots) {
    const key = `${slot.stageId}|${slot.date}`;
    if (loggedDates.has(key)) continue; // already done, skipped, or voluntary-logged

    const daypart = daypartsById.get(slot.daypartId);
    if (!daypart) continue; // daypart since removed — can't say whether its window passed

    // Reusing `daypartEndsAt` anchored at the occurrence's own start (rather than
    // "now") gives the correct end instant for a *past* occurrence, including a
    // wrapping night daypart whose end rolls onto the next calendar day.
    const occurrenceEnd = daypartEndsAt(daypart, `${slot.date}T${daypart.startTime}:00`);
    if (occurrenceEnd > now) continue; // still ahead — not missed yet, still pending

    unlogged.push({
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
      key: `${log.stageId}|${log.date}`,
      stageId: log.stageId,
      date: log.date,
      daypartId: log.daypartId,
      minutes: log.minutes,
      kind: "skipped",
    }));

  return [...unlogged, ...skipped].sort((a, b) => diffDays(b.date, a.date));
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
