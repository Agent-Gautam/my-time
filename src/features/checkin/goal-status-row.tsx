"use client";

// "Am I keeping my commitments?" and "will I reach my target date?" (PRD §6.7) —
// answered per active goal, calmly. A miss recomputes a number; it never punishes
// (D15), and there is never a verdict on the outcome itself (D3).
import { useLiveQuery } from "dexie-react-hooks";

import type { IsoDateTime } from "@/core/types";
import type { LocalGoal, LocalStage } from "@/db/local/schema";
import {
  cadenceLevel,
  formatIsoDate,
  goalPaceStatus,
  PACE_DOT_CLASS,
  PACE_LABEL,
  PACE_TEXT_CLASS,
} from "./lib";

export function GoalStatusRow({
  goal,
  stage,
  now,
}: {
  goal: LocalGoal;
  stage: LocalStage;
  now: IsoDateTime;
}) {
  const status = useLiveQuery(() => goalPaceStatus(stage, now), [stage, now]);
  if (!status) return null;

  const level = cadenceLevel(status.cadence);
  const projection = status.scope.projection;

  return (
    <div className="flex flex-col gap-1 border-b border-border py-3 last:border-b-0">
      <div className="flex items-center justify-between gap-2">
        <p className="text-section font-medium text-ink">{goal.name}</p>
        <span className={`flex items-center gap-1.5 text-label ${PACE_TEXT_CLASS[level]}`}>
          <span className={`size-2 rounded-full ${PACE_DOT_CLASS[level]}`} />
          {PACE_LABEL[level]}
        </span>
      </div>
      <p className="numeric text-label text-text-muted">
        required {status.cadence.requiredPerDay.toFixed(1)}/day · actual{" "}
        {status.cadence.actualPerDay.toFixed(1)}/day
      </p>
      {/* requiredPerUnit is pure arithmetic — ships from day one (D25). Only the
          measured projection below waits on data; withholding this too would hide
          an answer PRD §6.7/§9 says v1 must give for every scoped goal. */}
      {status.scope.requiredPerUnit != null && stage.scopeUnitLabel && (
        <p className="numeric text-label text-text-muted">
          requires {status.scope.requiredPerUnit.toFixed(2)} sessions/{stage.scopeUnitLabel}
        </p>
      )}
      {/* Only rendered once measuredPerUnit exists — no invented projection (D25). */}
      {projection && (
        <p className="numeric text-label text-text-muted">
          Projected finish {formatIsoDate(projection.earliest)}–{formatIsoDate(projection.latest)}
        </p>
      )}
    </div>
  );
}
