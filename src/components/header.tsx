// The app's identity strip: mark + wordmark on the left, sync status on the right.
// Sticky at the top on every breakpoint — mobile included, now that `Nav` has moved
// off the top edge and onto a floating dock (desktop) / the bottom bar (mobile).
// A server component: nothing here reads state, so only `SyncStatus` — its one
// client child — needs the boundary.

import { DartMark } from "@/components/dart-mark";
import { SyncStatus } from "@/components/sync-status";

export function Header() {
  return (
    <header className="bg-surface border-border sticky top-0 z-40 border-b">
      <div className="mx-auto flex h-14 max-w-2xl items-center justify-between px-4">
        <div className="flex items-center gap-2">
          <DartMark className="size-6" />
          <span className="font-heading text-text text-base font-medium">
            my-time
          </span>
        </div>
        <SyncStatus />
      </div>
    </header>
  );
}
