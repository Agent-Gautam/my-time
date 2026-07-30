"use client";

// The same two "on track" questions as the Today screen's GoalStatusRow (PRD
// §6.7), just given room to breathe: cadence required vs actual, the arithmetic
// scope line, and the projection range where one exists. No new arithmetic here —
// this only renders what `goalPaceStatus` (features/checkin/lib.ts) already
// computes from core/pace.ts.
import { useLiveQuery } from "dexie-react-hooks";

import type { IsoDateTime } from "@/core/types";
import type { LocalStage } from "@/db/local/schema";
import {
  cadenceLevel,
  formatIsoDate,
  goalPaceStatus,
  PACE_DOT_CLASS,
  PACE_LABEL,
  PACE_TEXT_CLASS,
} from "@/features/checkin/lib";

export function PaceSummary({ stage, now }: { stage: LocalStage; now: IsoDateTime }) {
  const status = useLiveQuery(() => goalPaceStatus(stage, now), [stage, now]);

  if (!status) {
    return <p className="text-body text-text-muted">Loading…</p>;
  }

  const level = cadenceLevel(status.cadence);
  const projection = status.scope.projection;

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-border p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-section font-semibold text-text">Pace</h2>
        <span className={`flex items-center gap-1.5 text-label ${PACE_TEXT_CLASS[level]}`}>
          <span className={`size-2 rounded-full ${PACE_DOT_CLASS[level]}`} />
          {PACE_LABEL[level]}
        </span>
      </div>

      <div className="flex flex-col gap-1">
        <p className="text-label text-text-subtle">Cadence — this week</p>
        <p className="numeric text-body text-text">
          required {status.cadence.requiredPerDay.toFixed(1)}/day · actual{" "}
          {status.cadence.actualPerDay.toFixed(1)}/day
        </p>
      </div>

      {/* requiredPerUnit is pure arithmetic — ships day one, no data needed (D25). */}
      {status.scope.requiredPerUnit != null && stage.scopeUnitLabel && (
        <div className="flex flex-col gap-1">
          <p className="text-label text-text-subtle">Scope — required</p>
          <p className="numeric text-body text-text">
            {status.scope.requiredPerUnit.toFixed(2)} sessions/{stage.scopeUnitLabel} to reach the
            target date
          </p>
        </div>
      )}

      {/* measuredPerUnit is null until a checkpoint exists — show nothing rather
          than invent a number (D25). */}
      {status.scope.measuredPerUnit != null && stage.scopeUnitLabel && (
        <div className="flex flex-col gap-1">
          <p className="text-label text-text-subtle">Scope — measured</p>
          <p className="numeric text-body text-text">
            {status.scope.measuredPerUnit.toFixed(2)} sessions/{stage.scopeUnitLabel} observed so
            far
          </p>
        </div>
      )}

      {/* A narrowing range, never a point (D25, D57) — never render just `finishDate`. */}
      {projection && (
        <div className="flex flex-col gap-1">
          <p className="text-label text-text-subtle">Projected finish</p>
          <p className="numeric text-body text-text">
            {formatIsoDate(projection.earliest)}–{formatIsoDate(projection.latest)}
          </p>
        </div>
      )}
    </div>
  );
}
