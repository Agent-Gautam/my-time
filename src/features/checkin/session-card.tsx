"use client";

// One scheduled session, packed to fit today (D8), with its one-line reason (D14).
// The check-off is the most repeated interaction in the app — a small, precise
// transform, not a celebration (design.md §6.3).
//
// **Only the goal's name links through to its page.** Not the whole card: Done and
// Skipped are the reason this card exists and are tapped far more often than the goal
// is opened, and a card-wide link would sit under both of them waiting to swallow a
// mis-aimed tap on a phone.
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { ReconciledSlot } from "@/features/plan/planner";
import { formatDuration } from "@/lib/duration";

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
            <Link
              href={`/goals/${slot.goal.id}`}
              className="text-section font-semibold text-ink underline-offset-4 hover:underline"
            >
              {slot.goal.name}
            </Link>
            <p className="text-label text-text-muted">{slot.reason}</p>
          </div>
          <span className="numeric shrink-0 text-label text-text-muted">
            {formatDuration(slot.slot.minutes)}
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
