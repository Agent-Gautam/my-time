// View-layer helpers for the goal detail screen (PRD §6.7). No scheduling logic
// lives here — this only reads bounded queries and composes core/pace.ts.
import type { IsoDate } from "@/core/types";
import { getSessionLogPage, PAGE_SIZE } from "@/db/local/queries";
import type { LocalSessionLog, LocalTask } from "@/db/local/schema";

// A "Load more" click bounded to a fixed number of underlying pages (D47), same
// shape as `missedOccurrencesPage`'s week-by-week scan — a stage with sparse
// history costs a few empty-ish page reads and stops, rather than scanning the
// whole table.
const MAX_UNDERLYING_PAGES_PER_SCAN = 8;

export interface SessionHistoryCursor {
  date: IsoDate;
  id: string;
}

export interface SessionHistoryPage {
  logs: LocalSessionLog[];
  cursor: SessionHistoryCursor | null;
  hasMore: boolean;
}

/**
 * One page of a single stage's session history, newest first. `getSessionLogPage`
 * paginates across every stage, so this scans forward through a bounded number of
 * its pages, keeping only rows for `stageId`, until either `limit` matching rows
 * are collected or the underlying table is exhausted (D47 — bounded, never an
 * unbounded scan).
 */
export async function sessionHistoryPage(
  stageId: string,
  options: { cursor?: SessionHistoryCursor; limit?: number } = {},
): Promise<SessionHistoryPage> {
  const { cursor, limit = PAGE_SIZE } = options;
  const matched: LocalSessionLog[] = [];
  let nextCursor = cursor;
  let exhausted = false;

  for (let scanned = 0; scanned < MAX_UNDERLYING_PAGES_PER_SCAN && matched.length < limit; scanned++) {
    const page = await getSessionLogPage({ cursor: nextCursor, limit: PAGE_SIZE });
    if (page.length === 0) {
      exhausted = true;
      break;
    }
    matched.push(...page.filter((log) => log.stageId === stageId));
    const last = page[page.length - 1];
    nextCursor = { date: last.date, id: last.id };
    if (page.length < PAGE_SIZE) {
      exhausted = true;
      break;
    }
  }

  return {
    logs: matched.slice(0, limit),
    cursor: exhausted ? null : (nextCursor ?? null),
    hasMore: !exhausted,
  };
}

// ---------------------------------------------------------------------------
// Goal-attached tasks, interleaved (D70)
// ---------------------------------------------------------------------------
//
// A `"done"` attached task always has a paired session log by construction
// (`mutations.setTaskStatus`) — that log is what appears above, and its `taskId`
// is resolved to the task's title inline. Including `"done"` tasks here too would
// double-count them. `"skipped"` attached tasks have no log at all (D70 deliberately
// doesn't mirror Skip into a session log — nothing was scheduled here to skip), so
// they are the only task-driven history rows with no session-log counterpart.

export type HistoryRow =
  | { kind: "session"; date: IsoDate; log: LocalSessionLog; taskTitle: string | null }
  | { kind: "task"; date: IsoDate; task: LocalTask };

/**
 * One merged, chronological page: the next page of session logs, plus whichever
 * skipped attached tasks fall in this page's date range and haven't already been
 * shown. `allTasks` is every task attached to this stage — fetched once by the
 * caller (bounded — see `getTasksForStage`) and passed in on every call, not
 * re-read per "Load more" click. It has to be *every* task, not just the skipped
 * ones: a `"done"` task's title is looked up here too, to annotate its paired
 * session log — a `skippedTasks`-only map could never resolve that lookup, since a
 * done task is never in it. `shownTaskIds` is the caller's own accumulated set of
 * task ids already rendered on a prior page — this function has no memory between
 * calls itself.
 */
export async function historyPage(
  stageId: string,
  allTasks: readonly LocalTask[],
  shownTaskIds: ReadonlySet<string>,
  options: { cursor?: SessionHistoryCursor; limit?: number } = {},
): Promise<{ rows: HistoryRow[]; cursor: SessionHistoryCursor | null; hasMore: boolean }> {
  const page = await sessionHistoryPage(stageId, options);

  const taskById = new Map<string, LocalTask>();
  for (const task of allTasks) taskById.set(task.id, task);

  const sessionRows: HistoryRow[] = page.logs.map((log) => ({
    kind: "session",
    date: log.date,
    log,
    taskTitle: log.taskId ? (taskById.get(log.taskId)?.title ?? null) : null,
  }));

  // Only a *skipped* task ever needs its own standalone row — a done one always has
  // the paired log above already representing it, and rendering both would double it.
  const skippedTasks = allTasks.filter((task) => task.status === "skipped");

  // Surface a not-yet-shown skipped task once its date is at or before the oldest
  // session log row loaded so far — otherwise a task from months ago would appear
  // on page one alongside this week's sessions, out of chronological order. Once
  // the session log stream is exhausted (`page.cursor === null`), every remaining
  // skipped task belongs on this final page.
  const oldestLoggedDate = sessionRows.at(-1)?.date;
  const taskRows: HistoryRow[] = skippedTasks
    .filter((task) => !shownTaskIds.has(task.id))
    .filter((task) => page.cursor === null || !oldestLoggedDate || task.date <= oldestLoggedDate)
    .map((task) => ({ kind: "task", date: task.date, task }));

  const rows = [...sessionRows, ...taskRows].sort((a, b) => (a.date < b.date ? 1 : -1));

  return { rows, cursor: page.cursor, hasMore: page.hasMore };
}
