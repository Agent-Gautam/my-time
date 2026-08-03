"use client";

// Per-goal session history (PRD §6.7). Done and skipped both appear — a skip
// renders in the `neutral` grey token because it is information, not a verdict
// (design.md §2.3, D15). Paginated (D47): never a growing unbounded read.
//
// **Interleaves attached tasks (D70).** A session row whose log carries a `taskId`
// shows the attached task's title inline. A skipped attached task has no log at all
// (D70 doesn't mirror Skip into a voluntary log — nothing was scheduled to skip), so
// it renders as its own row alongside the sessions, sorted into the same list by
// date. `historyPage` (`./lib.ts`) does the merge; this component only tracks the
// bookkeeping the merge needs across "Load more" clicks (`shownTaskIds`).
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { formatDuration } from "@/lib/duration";
import { formatIsoDate } from "@/features/checkin/lib";
import { getTasksForStage } from "@/db/local/queries";
import type { LocalTask } from "@/db/local/schema";
import { historyPage, type HistoryRow, type SessionHistoryCursor } from "./lib";

export function SessionHistory({ stageId }: { stageId: string }) {
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [cursor, setCursor] = useState<SessionHistoryCursor | null>(null);
  // `false` until the first page comes back: "we haven't looked yet" must not
  // render as "there is more" (the button showing before any scan has run).
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [started, setStarted] = useState(false);
  const initialLoadStarted = useRef(false);
  // Fetched once, bounded (`getTasksForStage`) — a single goal's attached tasks are
  // few, so this isn't paginated the way the growing `sessionLogs` stream is. Every
  // task, not just skipped ones: a done task's title still has to be looked up to
  // annotate its paired session log (`historyPage` in `./lib.ts` sorts out which
  // ones also get their own standalone row).
  const allTasksRef = useRef<LocalTask[] | null>(null);

  const loadMore = async () => {
    if (loading) return;
    setLoading(true);
    try {
      allTasksRef.current ??= await getTasksForStage(stageId);
      const shownTaskIds = new Set(
        rows.filter((r) => r.kind === "task").map((r) => r.task.id),
      );
      const page = await historyPage(stageId, allTasksRef.current, shownTaskIds, {
        cursor: cursor ?? undefined,
      });
      setRows((prev) => [...prev, ...page.rows]);
      setCursor(page.cursor);
      setHasMore(page.hasMore);
    } finally {
      setLoading(false);
      setStarted(true);
    }
  };

  useEffect(() => {
    // Same idempotency guard as `app/missed/page.tsx` — otherwise React's dev-mode
    // double-invoke fetches the first page twice against the same cursor.
    if (initialLoadStarted.current) return;
    initialLoadStarted.current = true;
    void loadMore();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-section font-semibold text-text">Session history</h2>

      {rows.length === 0 && started && !loading ? (
        <p className="text-body text-text-muted">No sessions logged yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((row) =>
            row.kind === "session" ? (
              <li
                key={row.log.id}
                className="flex items-center justify-between rounded-lg border border-border px-3 py-2"
              >
                <div>
                  <p
                    className={`text-body ${row.log.status === "skipped" ? "text-neutral" : "text-text"}`}
                  >
                    {row.log.status === "skipped" ? "Skipped" : "Done"}
                    {row.log.source === "voluntary" ? " · voluntary" : ""}
                    {row.taskTitle ? ` · ${row.taskTitle}` : ""}
                  </p>
                  <p className="text-label text-text-subtle">{formatIsoDate(row.log.date)}</p>
                </div>
                <span
                  className={`numeric text-label ${row.log.status === "skipped" ? "text-neutral" : "text-text-muted"}`}
                >
                  {formatDuration(row.log.minutes)}
                </span>
              </li>
            ) : (
              <li
                key={row.task.id}
                className="flex items-center justify-between rounded-lg border border-border px-3 py-2"
              >
                <div>
                  <p className="text-body text-neutral">Skipped · {row.task.title}</p>
                  <p className="text-label text-text-subtle">{formatIsoDate(row.task.date)}</p>
                </div>
                <span className="numeric text-label text-neutral">
                  {formatDuration(row.task.minutes)}
                </span>
              </li>
            ),
          )}
        </ul>
      )}

      {hasMore && (
        <Button
          variant="outline"
          className="min-h-11 self-center"
          disabled={loading}
          onClick={loadMore}
        >
          {loading ? "Loading…" : "Load more"}
        </Button>
      )}
    </div>
  );
}
