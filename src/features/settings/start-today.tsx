"use client";

// Start Today — user-initiated clean slate (implementation_plan.md).
//
// Clears all tracking (session logs, check-ins, plan, tasks, checkpoints) and
// re-lays-out a fresh week from today. Goals and settings are untouched.
// This is irreversible once the server call completes.

import { useState } from "react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { resetTracking } from "@/db/local/mutations";
import { localNow } from "@/lib/daypart";

export function StartToday() {
  const [loading, setLoading] = useState(false);

  async function handleConfirm() {
    setLoading(true);
    try {
      await resetTracking(localNow());
      toast.success("Done. Everything resets from today.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AlertDialog>
      <div className="flex flex-col gap-3">
        <p className="text-body text-text-muted">
          Resets all progress and your schedule from today. Your goals and
          daypart configuration are kept — only session history, check-ins, the
          plan, tasks, and checkpoints are removed, both locally and on the
          server.
        </p>
        <AlertDialogTrigger
          disabled={loading}
          className="self-start min-h-11 inline-flex items-center justify-center rounded-md bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground shadow-xs transition-colors hover:bg-destructive/90 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
        >
          {loading ? "Resetting…" : "Start Today"}
        </AlertDialogTrigger>
      </div>

      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Reset all tracking?</AlertDialogTitle>
          <AlertDialogDescription>
            Your goals and settings are kept. All session history, check-ins,
            the schedule, tasks, and checkpoints will be permanently deleted —
            this cannot be undone once confirmed.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleConfirm}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            Reset — I understand
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
