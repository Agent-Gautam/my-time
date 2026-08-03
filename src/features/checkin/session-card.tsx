"use client";

// One scheduled session, packed to fit today (D8), with its one-line reason (D14).
// The check-off is the most repeated interaction in the app — a small, precise
// transform, not a celebration (design.md §6.3).
//
// **Only the goal's name links through to its page.** Not the whole card: Done and
// Skipped are the reason this card exists and are tapped far more often than the goal
// is opened, and a card-wide link would sit under both of them waiting to swallow a
// mis-aimed tap on a phone.
//
// **The inline task field (D70).** Typing a title and tapping Done attaches a task to
// this goal alongside the session log — Skipped never does, regardless of what's
// typed, and an empty field on Done is byte-identical to how this card behaved before
// D70. This is not per-item content on the session itself (D12 stays exactly as
// written): the text becomes its own `Task` row, and the log only ever gains a
// reference to it.
import { useState } from "react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ReconciledSlot } from "@/features/plan/planner";
import { formatDuration } from "@/lib/duration";

export function SessionCard({
  slot,
  pending,
  onLog,
}: {
  slot: ReconciledSlot;
  pending: boolean;
  onLog: (status: "done" | "skipped", taskTitle?: string) => void;
}) {
  const [taskTitle, setTaskTitle] = useState("");

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

        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`task-${slot.slot.id}`} className="sr-only">
            Attach a task (optional)
          </Label>
          <Input
            id={`task-${slot.slot.id}`}
            value={taskTitle}
            placeholder="Attach a task (optional)"
            disabled={pending}
            onChange={(event) => setTaskTitle(event.target.value)}
          />
        </div>

        <div className="flex gap-2">
          <Button
            className="min-h-11 flex-1 transition-transform duration-150 ease-out active:scale-95"
            disabled={pending}
            onClick={() => onLog("done", taskTitle)}
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
