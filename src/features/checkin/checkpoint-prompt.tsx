"use client";

// Coarse progress checkpoint (PRD §6.6, D13): "which chapter are you on?" — never
// what was inside a session (D12). Rendered by the parent only when it decides to
// ask (lib.ts's shouldPromptCheckpoint), so this component just asks the one
// question and gets out of the way.
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { putCheckpoint } from "@/db/local/mutations";
import type { IsoDateTime } from "@/core/types";

export interface CheckpointTarget {
  stageId: string;
  goalName: string;
  unitLabel: string;
  // Carried on the target rather than taken as a sibling prop: the prompt can be
  // triggered from a planned log or a voluntary one, each with its own freshly-read
  // `localNow()` at the moment of that action — there is no single "current now"
  // for the page to hand down.
  now: IsoDateTime;
}

export function CheckpointPrompt({
  target,
  onDone,
}: {
  target: CheckpointTarget | null;
  onDone: () => void;
}) {
  const [value, setValue] = useState("");

  if (!target) return null;

  const submit = async () => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) return;
    await putCheckpoint({ stageId: target.stageId, value: parsed }, target.now);
    setValue("");
    onDone();
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) {
          setValue("");
          onDone();
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{target.goalName}</DialogTitle>
          <DialogDescription>Which {target.unitLabel} are you on?</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="checkpoint-value">Current {target.unitLabel}</Label>
          <Input
            id="checkpoint-value"
            type="number"
            inputMode="numeric"
            min={0}
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onDone}>
            Skip
          </Button>
          <Button onClick={submit} disabled={value === ""}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
