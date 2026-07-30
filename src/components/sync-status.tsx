"use client";

import { useSyncStatus, type SyncStatus } from "@/hooks/use-sync-status";

/**
 * Always-visible sync status indicator (D46). Shows network state and pending write count.
 * Never a button or action — information only.
 */
export function SyncStatus() {
  const { status, pendingCount } = useSyncStatus();

  return (
    <div
      className="flex items-center gap-1 transition-opacity duration-200"
      aria-live="polite"
      aria-label={getAriaLabel(status, pendingCount)}
    >
      <StatusIcon status={status} />
      {status === "pending" && (
        <span className="text-caption font-medium text-text-muted numeric">
          {pendingCount}
        </span>
      )}
    </div>
  );
}

function StatusIcon({ status }: { status: SyncStatus }) {
  const iconProps = "size-4 shrink-0";

  switch (status) {
    case "synced":
      return (
        <svg
          className={`${iconProps} text-on-track`}
          fill="currentColor"
          viewBox="0 0 24 24"
        >
          <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
        </svg>
      );

    // Wired by Wave 3. Deliberately still: `design.md` §6.1 forbids anything infinite,
    // and a spinner on a status that must never pull attention (D46) is exactly what
    // that rule is about.
    case "syncing":
      return (
        <svg
          className={`${iconProps} text-attention`}
          fill="none"
          viewBox="0 0 24 24"
        >
          <circle
            cx="12"
            cy="12"
            r="8"
            stroke="currentColor"
            strokeWidth="2"
            strokeDasharray="15 75"
          />
        </svg>
      );

    case "offline":
      return (
        <svg
          className={`${iconProps} text-neutral`}
          fill="currentColor"
          viewBox="0 0 24 24"
        >
          <path d="M1 9l2 2c4.97-4.97 13.03-4.97 18 0l2-2C16.93 2.93 7.08 2.93 1 9zm8 8l3 3 3-3c-1.65-1.66-4.34-1.66-6 0zm-4-4l2 2c2.76-2.76 7.24-2.76 10 0l2-2C15.14 9.14 8.87 9.14 5 13z" />
        </svg>
      );

    case "pending":
      return (
        <svg
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
      return (
        <svg
          className={`${iconProps} text-neutral`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth="2"
        >
          <circle cx="12" cy="12" r="8" />
          <path d="M6.5 6.5l11 11" />
        </svg>
      );
  }
}

function getAriaLabel(status: SyncStatus, pendingCount: number): string {
  switch (status) {
    case "synced":
      return "All changes synced";
    case "syncing":
      return "Syncing changes";
    case "offline":
      return "Offline. Changes will sync when connected.";
    case "pending":
      return `${pendingCount} change${pendingCount === 1 ? "" : "s"} pending sync`;
    case "blocked":
      return "Not syncing on this device. Your changes are saved here.";
  }
}
