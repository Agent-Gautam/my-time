"use client";

// Checkpoint history for scoped goals — the coarse progress line over time
// (PRD §6.6, D13). Sparse by design: occasional, never per-video, never
// per-question, so a single bounded read covers a realistic history without
// pagination.
import { useLiveQuery } from "dexie-react-hooks";

import { getCheckpointsForStage } from "@/db/local/queries";
import { formatClockTime, formatIsoDate } from "@/features/checkin/lib";

export function CheckpointHistory({
  stageId,
  unitLabel,
}: {
  stageId: string;
  unitLabel: string;
}) {
  // 100 covers years of a weekly-ish checkpoint cadence — still a bounded read
  // (D47), not a growing `.toArray()`.
  const checkpoints = useLiveQuery(
    () => getCheckpointsForStage(stageId, { limit: 100 }),
    [stageId],
  );

  if (checkpoints === undefined) {
    return <p className="text-body text-text-muted">Loading…</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-section font-semibold text-text">Checkpoints</h2>

      {checkpoints.length === 0 ? (
        <p className="text-body text-text-muted">No checkpoints logged yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {checkpoints.map((checkpoint) => (
            <li
              key={checkpoint.id}
              className="flex items-center justify-between rounded-lg border border-border px-3 py-2"
            >
              <span className="numeric text-body text-text">
                {checkpoint.value} {unitLabel}
              </span>
              <span className="text-label text-text-subtle">
                {formatIsoDate(checkpoint.loggedAt.slice(0, 10))} ·{" "}
                {formatClockTime(checkpoint.loggedAt)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
