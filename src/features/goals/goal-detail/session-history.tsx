"use client";

// Per-goal session history (PRD §6.7). Done and skipped both appear — a skip
// renders in the `neutral` grey token because it is information, not a verdict
// (design.md §2.3, D15). Paginated (D47): never a growing unbounded read.
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { formatDuration } from "@/lib/duration";
import { formatIsoDate } from "@/features/checkin/lib";
import type { LocalSessionLog } from "@/db/local/schema";
import { sessionHistoryPage, type SessionHistoryCursor } from "./lib";

export function SessionHistory({ stageId }: { stageId: string }) {
  const [logs, setLogs] = useState<LocalSessionLog[]>([]);
  const [cursor, setCursor] = useState<SessionHistoryCursor | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [started, setStarted] = useState(false);
  const initialLoadStarted = useRef(false);

  const loadMore = async () => {
    if (loading) return;
    setLoading(true);
    try {
      const page = await sessionHistoryPage(stageId, { cursor: cursor ?? undefined });
      setLogs((prev) => [...prev, ...page.logs]);
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

      {logs.length === 0 && started && !loading ? (
        <p className="text-body text-text-muted">No sessions logged yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {logs.map((log) => (
            <li
              key={log.id}
              className="flex items-center justify-between rounded-lg border border-border px-3 py-2"
            >
              <div>
                <p className={`text-body ${log.status === "skipped" ? "text-neutral" : "text-text"}`}>
                  {log.status === "skipped" ? "Skipped" : "Done"}
                  {log.source === "voluntary" ? " · voluntary" : ""}
                </p>
                <p className="text-label text-text-subtle">{formatIsoDate(log.date)}</p>
              </div>
              <span
                className={`numeric text-label ${log.status === "skipped" ? "text-neutral" : "text-text-muted"}`}
              >
                {formatDuration(log.minutes)}
              </span>
            </li>
          ))}
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
