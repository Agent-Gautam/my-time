"use client";

// Reset Everything — nuclear option that wipes all data including goals,
// stages, dayparts, and all tracking. The device is re-seeded to a blank
// first-run state afterwards.

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
import { resetEverything } from "@/db/local/mutations";
import { localNow } from "@/lib/daypart";

export function ResetEverything() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleConfirm() {
    setLoading(true);
    try {
      await resetEverything(localNow());
      setOpen(false);
      toast.success("Everything has been reset. Starting fresh.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <div className="flex flex-col gap-3">
        <p className="text-body text-text-muted">
          Permanently deletes all data — goals, history, schedule, dayparts,
          and settings — both locally and on the server. The app returns to its
          first-run state. This cannot be undone.
        </p>
        <AlertDialogTrigger
          disabled={loading}
          className="self-start min-h-11 inline-flex items-center justify-center rounded-md bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground shadow-xs transition-colors hover:bg-destructive/90 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
        >
          {loading ? "Resetting…" : "Reset Everything"}
        </AlertDialogTrigger>
      </div>

      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete all data?</AlertDialogTitle>
          <AlertDialogDescription>
            This removes every goal, session, checkpoint, plan, and setting —
            both locally and on the server. The app will restart from scratch.
            There is no undo.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={loading}
            onClick={handleConfirm}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {loading ? "Deleting…" : "Delete everything — I understand"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
