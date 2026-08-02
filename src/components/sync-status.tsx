"use client";

import { Check, CircleSlash, LoaderCircle, WifiOff } from "lucide-react";

import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useSyncStatus, type SyncStatus } from "@/hooks/use-sync-status";
import { localNow } from "@/lib/daypart";
import { formatDuration } from "@/lib/duration";
import { cn } from "@/lib/utils";
import type { IsoDateTime } from "@/core/types";

/**
 * Always-visible sync status indicator (D46). Shows network state and pending write
 * count. Still never an action: the trigger is a **disclosure**, not a sync button —
 * pressing it explains the state and does nothing to the sync engine (D46, D69).
 *
 * The five states are deliberately not self-explanatory at 16px — "amber dot plus a
 * number" is a code, not information — so hovering or tapping opens a plain-language
 * explanation of what is showing and what, if anything, happens next. Every answer
 * ends the same way: nothing for the user to do.
 */
export function SyncStatus() {
  const { status, pendingCount, lastPullAt } = useSyncStatus();

  return (
    /*
      Deliberately **not** an `aria-live` region any more. The old one never really
      announced — it lived on a div whose name came from `aria-label` — and making it
      announce properly would mean speaking every `syncing → pending → syncing`
      transition of a retry loop out loud, which is precisely the attention D46 says
      this must never take. The state is on the trigger's label for anyone who focuses
      it, and in the popover in full for anyone who asks: available, never announced.
    */
    <Popover>
      <PopoverTrigger
        aria-label={`${getAriaLabel(status, pendingCount)} Show details.`}
        className={cn(
          "flex min-h-11 items-center gap-1 rounded-md px-1",
          "focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none",
          // `help`, not `pointer`: it explains itself, it doesn't do anything. No
          // fill and no press state either — it must not read as one more thing to
          // tap in a bar of destinations (D46).
          "cursor-help",
        )}
        openOnHover
        delay={120}
        closeDelay={80}
      >
        <StatusIcon status={status} />
        {status === "pending" && (
          <span className="text-caption text-text-muted numeric font-medium">
            {pendingCount}
          </span>
        )}
      </PopoverTrigger>

      {/* `side="top"` suits the mobile bottom bar; the positioner flips it below
          the sticky top bar from `md` up, where there is no room above. */}
      <PopoverContent side="top" align="end">
        <StatusExplanation
          status={status}
          pendingCount={pendingCount}
          lastPullAt={lastPullAt}
        />
      </PopoverContent>
    </Popover>
  );
}

function StatusIcon({ status }: { status: SyncStatus }) {
  const iconProps = "size-4 shrink-0";

  switch (status) {
    case "synced":
      return <Check aria-hidden className={`${iconProps} text-on-track`} />;

    // The one rotation in the app outside the loading mark (D69). `syncing` and
    // `pending` are both amber and both small; motion is what separates "working on
    // it" from "queued", and it stops by itself the moment the flush lands.
    // Compositor-only transform, CSS-declarative, no JS driving it (D61).
    case "syncing":
      return (
        <LoaderCircle
          aria-hidden
          className={`${iconProps} text-attention animate-spin`}
        />
      );

    // A crossed-out signal, not bars: plain wifi bars read as "connected" at this
    // size, which is the opposite of what this state means.
    case "offline":
      return <WifiOff aria-hidden className={`${iconProps} text-neutral`} />;

    case "pending":
      return (
        <svg
          aria-hidden
          className={`${iconProps} text-attention`}
          fill="currentColor"
          viewBox="0 0 24 24"
        >
          <circle cx="12" cy="12" r="8" />
        </svg>
      );

    // This device's sync key was rejected (D59). `text-neutral`, not a warning colour —
    // the data is safe in Dexie and nothing the user did caused it, so it reports like
    // "offline" rather than like a problem to fix (D15).
    case "blocked":
      return <CircleSlash aria-hidden className={`${iconProps} text-neutral`} />;
  }
}

/**
 * The popover body. Mounted only while open, which is also why the clock read lives
 * here: `lastPullAt` is rendered relative to *now*, and doing that during the first
 * render of a server-rendered page would be a hydration mismatch.
 */
function StatusExplanation({
  status,
  pendingCount,
  lastPullAt,
}: {
  status: SyncStatus;
  pendingCount: number;
  lastPullAt: IsoDateTime | null;
}) {
  const { title, body } = explain(status, pendingCount);

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <StatusIcon status={status} />
        <PopoverTitle>{title}</PopoverTitle>
      </div>
      <PopoverDescription>{body}</PopoverDescription>
      {/* `text-text-muted`, not `text-subtle` — §7 makes subtle large-text-only, and
          caption is the smallest step in the scale. */}
      <p className="text-caption text-text-muted border-border mt-0.5 border-t pt-1.5">
        {lastPullAt
          ? `Last checked the server ${formatSince(lastPullAt, localNow())}.`
          : "This device hasn't checked the server yet."}
      </p>
    </div>
  );
}

function explain(
  status: SyncStatus,
  pendingCount: number,
): { title: string; body: string } {
  const changes = `${pendingCount} change${pendingCount === 1 ? "" : "s"}`;

  switch (status) {
    case "synced":
      return {
        title: "Up to date",
        body: "Everything on this device has reached the server, and nothing new is waiting from your other devices.",
      };

    case "syncing":
      return {
        title: "Syncing",
        body: "Sending what this device has and fetching anything changed elsewhere. The spinner stops on its own when it's done.",
      };

    case "pending":
      return {
        title: `${changes} waiting`,
        body: `The amber dot means work is saved here but hasn't reached the server yet, and the number beside it is how many — ${changes} right now. It uploads by itself; there's nothing to press.`,
      };

    case "offline":
      return {
        title: "Offline",
        body:
          pendingCount > 0
            ? `No network. Everything still saves on this device — ${changes} waiting here, and the queue goes up on its own once you're back online.`
            : "No network. Everything still saves on this device and syncs on its own once you're back online.",
      };

    case "blocked":
      return {
        title: "Not syncing on this device",
        body: "The server didn't accept this device's sync key, so nothing is going up or coming down. Your data is safe here, and nothing you did caused it.",
      };
  }
}

/** `"4m ago"` · `"2h 30m ago"` · `"3 days ago"`. Coarse on purpose — this is context, not a metric. */
function formatSince(from: IsoDateTime, now: IsoDateTime): string {
  const minutes = Math.round(
    (new Date(now).getTime() - new Date(from).getTime()) / 60_000,
  );

  if (!Number.isFinite(minutes) || minutes < 1) return "just now";
  if (minutes < 1440) return `${formatDuration(minutes)} ago`;

  const days = Math.floor(minutes / 1440);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

function getAriaLabel(status: SyncStatus, pendingCount: number): string {
  switch (status) {
    case "synced":
      return "All changes synced.";
    case "syncing":
      return "Syncing changes.";
    case "offline":
      return "Offline. Changes will sync when connected.";
    case "pending":
      return `${pendingCount} change${pendingCount === 1 ? "" : "s"} pending sync.`;
    case "blocked":
      return "Not syncing on this device. Your changes are saved here.";
  }
}
