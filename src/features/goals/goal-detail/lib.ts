// View-layer helpers for the goal detail screen (PRD §6.7). No scheduling logic
// lives here — this only reads bounded queries and composes core/pace.ts.
import type { IsoDate } from "@/core/types";
import { getSessionLogPage, PAGE_SIZE } from "@/db/local/queries";
import type { LocalSessionLog } from "@/db/local/schema";

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
