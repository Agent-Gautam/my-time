"use client";

import { Check, CircleSlash, LoaderCircle, WifiOff } from "lucide-react";

import {
  Popover,
  PopoverContent,
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
 * number" is a code, not information — so hovering or tapping opens the one word or
 * short phrase that names the state. Nothing more: there is never an action to take,
 * so there is nothing to explain beyond what it is.
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
 *
 * One line, not a paragraph (D69 revised): the state is already legible from the icon
 * and count on the trigger — the popover exists for the one word or phrase that names
 * it, not an essay on how sync works. No separate body: at this length a title plus a
 * description just repeats itself.
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
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <StatusIcon status={status} />
        <PopoverTitle>{explain(status, pendingCount)}</PopoverTitle>
      </div>
      {/* `text-text-muted`, not `text-subtle` — §7 makes subtle large-text-only, and
          caption is the smallest step in the scale. */}
      <p className="text-caption text-text-muted">
        {lastPullAt
          ? `Last checked ${formatSince(lastPullAt, localNow())}.`
          : "Never checked the server."}
      </p>
    </div>
  );
}

function explain(status: SyncStatus, pendingCount: number): string {
  const changes = `${pendingCount} change${pendingCount === 1 ? "" : "s"}`;

  switch (status) {
    case "synced":
      return "Synced";

    case "syncing":
      return "Syncing changes";

    case "pending":
      return `${changes} waiting for sync`;

    case "offline":
      return pendingCount > 0 ? `Offline — ${changes} waiting` : "Offline — sync paused";

    case "blocked":
      return "Sync disabled on this device";
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

/** Same wording as the popover (`explain`) — one state, one name for it. */
function getAriaLabel(status: SyncStatus, pendingCount: number): string {
  return `${explain(status, pendingCount)}.`;
}
