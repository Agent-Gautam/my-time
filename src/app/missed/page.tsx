"use client";

// Missed sessions die officially and are surfaced here — nothing is dragged forward
// as debt (D20). Rendered in the `neutral` grey token: a missed session is
// information, not a verdict (design.md §2.3).
//
// "Missed" covers both an unlogged session whose daypart has already ended (the
// primary case — the user never opened the app for it) and an explicit one-tap
// "Skipped" (Architecture.md §9.3). Scanned backward week by week via
// `missedOccurrencesPage`, bounded per click rather than an unbounded history read
// (D47).
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { formatDuration } from "@/lib/duration";
import { localNow } from "@/lib/daypart";
import { localDb } from "@/db/local/schema";
import {
  currentWeekStart,
  formatIsoDate,
  missedOccurrencesPage,
  type MissedOccurrence,
} from "@/features/checkin/lib";

interface MissedRow extends MissedOccurrence {
  goalName: string;
}

async function withGoalNames(
  occurrences: readonly MissedOccurrence[],
  cache: Map<string, string>,
): Promise<MissedRow[]> {
  return Promise.all(
    occurrences.map(async (occ) => {
      let goalName = cache.get(occ.stageId);
      if (goalName === undefined) {
        const stage = await localDb.stages.get(occ.stageId);
        const goal = stage ? await localDb.goals.get(stage.goalId) : undefined;
        goalName = goal?.name ?? "Deleted goal";
        cache.set(occ.stageId, goalName);
      }
      return { ...occ, goalName };
    }),
  );
}

export default function MissedPage() {
  const [rows, setRows] = useState<MissedRow[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  // `false` until the first page comes back: "we haven't looked yet" must not
  // render as "there is more" (the button showing before any scan has run).
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [started, setStarted] = useState(false);
  const goalNameCache = useRef(new Map<string, string>());
  const nowRef = useRef<string | null>(null);
  const initialLoadStarted = useRef(false);

  const loadMore = async () => {
    if (loading) return;
    setLoading(true);
    try {
      nowRef.current ??= localNow();
      const now = nowRef.current;
      const from = cursor ?? currentWeekStart(now);

      const page = await missedOccurrencesPage(now, from);
      const enriched = await withGoalNames(page.occurrences, goalNameCache.current);

      setRows((prev) => [...prev, ...enriched]);
      setCursor(page.nextWeekStart);
      setHasMore(page.hasMore);
    } finally {
      setLoading(false);
      setStarted(true);
    }
  };

  useEffect(() => {
    // The ref (not just the `[]` dep array) is what makes this idempotent under
    // React's dev-mode double-invoke of effects — otherwise the first page would
    // fetch twice against the same starting cursor and duplicate rows.
    if (initialLoadStarted.current) return;
    initialLoadStarted.current = true;
    void loadMore();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main className="flex flex-1 flex-col gap-4 py-6">
      <h1 className="text-display font-semibold text-ink">Missed</h1>
      <p className="text-body text-text-muted">
        Nothing here carries forward. Voluntary catch-up is logged from the today
        screen whenever you get to it.
      </p>

      {rows.length === 0 && started && !loading ? (
        <p className="text-body text-text-muted">No missed sessions.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((row) => (
            <li
              key={row.key}
              className="flex items-center justify-between rounded-lg border border-border px-3 py-2"
            >
              <div>
                <p className="text-body text-neutral">{row.goalName}</p>
                <p className="text-label text-text-subtle">{formatIsoDate(row.date)}</p>
              </div>
              <span className="numeric text-label text-neutral">{formatDuration(row.minutes)}</span>
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
    </main>
  );
}
