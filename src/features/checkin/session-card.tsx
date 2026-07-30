"use client";

// One scheduled session, packed to fit today (D8), with its one-line reason (D14).
// The check-off is the most repeated interaction in the app — a small, precise
// transform, not a celebration (design.md §6.3).
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { ReconciledSlot } from "@/features/plan/planner";

export function SessionCard({
  slot,
  pending,
  onLog,
}: {
  slot: ReconciledSlot;
  pending: boolean;
  onLog: (status: "done" | "skipped") => void;
}) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-section font-semibold text-ink">{slot.goal.name}</p>
            <p className="text-label text-text-muted">{slot.reason}</p>
          </div>
          <span className="numeric shrink-0 text-label text-text-muted">
            {slot.slot.minutes}m
          </span>
        </div>
        <div className="flex gap-2">
          <Button
            className="min-h-11 flex-1 transition-transform duration-150 ease-out active:scale-95"
            disabled={pending}
            onClick={() => onLog("done")}
          >
            Done
          </Button>
          <Button
            variant="outline"
            className="min-h-11 flex-1 transition-transform duration-150 ease-out active:scale-95"
            disabled={pending}
            onClick={() => onLog("skipped")}
          >
            Skipped
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
