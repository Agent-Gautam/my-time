// Where the pull cursors and the last-pull stamp live between sessions.
//
// **This is `localStorage`, and it is a compromise.** The natural home is a local-only
// Dexie table sitting next to `outbox` — but that means a new store in
// `db/local/schema.ts` and a version bump, and `db/local/**` is not this track's to
// edit. So the two scalars sync needs to remember are kept out of band, and the fact
// that they are is reported rather than hidden.
//
// What that costs, precisely: clearing site data resets the cursors without clearing
// Dexie, so the next sync re-pulls the whole history window and re-applies it. That is
// harmless — every apply path is idempotent — but it is not free, which is why the
// request carries a `historyFloor` (D47).
//
// The store is an interface so tests can hand in a plain object instead of standing up
// a DOM.

import type { IsoDateTime } from "@/core/types";
import type { SyncCursors } from "./protocol";

const STORAGE_KEY = "my-time:sync";

export interface SyncMemo {
  cursors: SyncCursors;
  /** When the last pull completed. Local wall-clock (D53), fed to the status hook. */
  lastPullAt: IsoDateTime | null;
}

export interface SyncMemoStore {
  read(): SyncMemo;
  write(memo: SyncMemo): void;
}

export const emptyMemo = (): SyncMemo => ({ cursors: {}, lastPullAt: null });

function isMemo(value: unknown): value is SyncMemo {
  if (typeof value !== "object" || value === null) return false;
  const memo = value as Record<string, unknown>;
  if (typeof memo.cursors !== "object" || memo.cursors === null) return false;
  return memo.lastPullAt === null || typeof memo.lastPullAt === "string";
}

/** In-memory fallback — used during SSR, in tests, and if storage is unavailable. */
export function createMemoryMemoStore(initial: SyncMemo = emptyMemo()): SyncMemoStore {
  let memo = initial;
  return {
    read: () => memo,
    write: (next) => {
      memo = next;
    },
  };
}

/**
 * The real store. Falls back to memory rather than throwing: a device in private mode
 * with storage denied should still sync, it just re-pulls its window each session.
 */
export function createMemoStore(): SyncMemoStore {
  if (typeof localStorage === "undefined") return createMemoryMemoStore();

  return {
    read() {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return emptyMemo();
        const parsed: unknown = JSON.parse(raw);
        return isMemo(parsed) ? parsed : emptyMemo();
      } catch {
        return emptyMemo();
      }
    },
    write(memo) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(memo));
      } catch {
        // Quota or a denied store. Losing a cursor costs a re-pull, never data.
      }
    },
  };
}
