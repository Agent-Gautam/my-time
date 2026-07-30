// THE ENGINE — when sync runs, and what one run is.
//
// **There is no sync button and there never will be (D46).** Nothing in this module is
// exported as a user action. Sync happens on app start, when connectivity returns, when
// the tab becomes visible, and after a local write; its *status* is published for the
// always-visible indicator, and that is the only thing the UI gets.
//
// One run is: push a bounded FIFO batch of the outbox and pull everything past the
// cursors, in the same request (Architecture.md §6), repeated until neither half has
// more to do.
//
// Two termination rules, both of which are easy to get wrong in a way that spins
// forever:
//
//   - Push stops when a round acks **nothing**. Not "when the outbox is empty" — a row
//     the server refuses would re-peek at the head of the queue on every pass.
//   - Pull stops on the server's `hasMore` flag. Not "when rows arrive" — the cursor is
//     deliberately rewound a second on each page (see the route handler), so rows keep
//     arriving indefinitely by design.
//
// Failure is not an error state (Architecture.md §6). A failed run leaves the outbox
// intact, backs off, and tries again; the user was never waiting on it.

import { liveQuery, type Subscription } from "dexie";

import { addDays, dateOnly } from "@/core/dateUtils";
import { getOutboxDepth, LOCAL_HISTORY_WINDOW_DAYS } from "@/db/local/queries";
import { localNow } from "@/lib/daypart";
import type { IsoDateTime } from "@/core/types";

import { createMemoStore, emptyMemo, type SyncMemoStore } from "./memo";
import { applyPull } from "./pull";
import { collectPush, PUSH_BATCH_SIZE, recordPushFailure, settlePush } from "./push";
import type { SyncCursors, SyncRequest } from "./protocol";
import { httpTransport, type SyncTransport } from "./transport";

/** Guards against a bug turning one sync into an unbounded request loop. */
const MAX_ROUNDS = 20;

/** After a local write. Long enough to coalesce a burst of mutations into one push. */
const WRITE_DEBOUNCE_MS = 1_500;

const BACKOFF_BASE_MS = 2_000;
const BACKOFF_MAX_MS = 5 * 60_000;

// ---------------------------------------------------------------------------
// Published state — what `use-sync-status.ts` reads
// ---------------------------------------------------------------------------

export interface SyncEngineState {
  /** True while a flush or pull is in flight — Architecture.md §6.1's `syncing`. */
  syncing: boolean;
  /** When the last successful pull completed. Local wall-clock (D53). */
  lastPullAt: IsoDateTime | null;
  /** Last failure, for diagnostics only. Never surfaced as something to act on (D46). */
  lastError: string | null;
}

const listeners = new Set<() => void>();

// A frozen snapshot object, replaced rather than mutated: `useSyncExternalStore`
// compares by reference and would miss an in-place edit.
let state: SyncEngineState = { syncing: false, lastPullAt: null, lastError: null };

/** Stable across renders during SSR, where there is no engine and never a flush. */
const SERVER_STATE: SyncEngineState = {
  syncing: false,
  lastPullAt: null,
  lastError: null,
};

function setState(patch: Partial<SyncEngineState>): void {
  const next = { ...state, ...patch };
  if (
    next.syncing === state.syncing &&
    next.lastPullAt === state.lastPullAt &&
    next.lastError === state.lastError
  ) {
    return;
  }
  state = next;
  for (const listener of listeners) listener();
}

export function subscribeSyncEngine(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export const getSyncEngineSnapshot = (): SyncEngineState => state;
export const getServerSyncEngineSnapshot = (): SyncEngineState => SERVER_STATE;

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface SyncEngineOptions {
  transport?: SyncTransport;
  memo?: SyncMemoStore;
  /** Injected for tests. Production reads the one sanctioned clock (D53). */
  now?: () => IsoDateTime;
  batchSize?: number;
}

interface ResolvedOptions {
  transport: SyncTransport;
  memo: SyncMemoStore;
  now: () => IsoDateTime;
  batchSize: number;
}

let options: ResolvedOptions | null = null;

function resolved(): ResolvedOptions {
  options ??= {
    transport: httpTransport(),
    memo: createMemoStore(),
    now: () => localNow(),
    batchSize: PUSH_BATCH_SIZE,
  };
  return options;
}

/** Test seam. Also resets the engine's in-memory state, so runs cannot leak between tests. */
export function configureSync(overrides: SyncEngineOptions = {}): void {
  const base = {
    transport: httpTransport(),
    memo: createMemoStore(),
    now: () => localNow(),
    batchSize: PUSH_BATCH_SIZE,
  };
  options = { ...base, ...overrides };
  state = { syncing: false, lastPullAt: null, lastError: null };
  failures = 0;
  inFlight = null;
  rerunRequested = false;
}

// ---------------------------------------------------------------------------
// One run
// ---------------------------------------------------------------------------

export interface SyncOutcome {
  pushed: number;
  pulled: number;
  weeksApplied: number;
  rejected: number;
  rounds: number;
  error: string | null;
}

let inFlight: Promise<SyncOutcome> | null = null;
let rerunRequested = false;
let failures = 0;

/**
 * Run sync now, coalescing concurrent callers.
 *
 * A caller that arrives mid-flight does not get its own run — it would push the same
 * head of the outbox twice — but it is not dropped either: `rerunRequested` schedules
 * one more pass once the current one finishes, so a write that landed after the batch
 * was read still goes out.
 */
export function syncNow(): Promise<SyncOutcome> {
  if (inFlight) {
    rerunRequested = true;
    return inFlight;
  }

  inFlight = runSync().finally(() => {
    inFlight = null;
    if (rerunRequested) {
      rerunRequested = false;
      scheduleRetry(0);
    }
  });
  return inFlight;
}

async function runSync(): Promise<SyncOutcome> {
  const { transport, memo, now, batchSize } = resolved();
  const outcome: SyncOutcome = {
    pushed: 0,
    pulled: 0,
    weeksApplied: 0,
    rejected: 0,
    rounds: 0,
    error: null,
  };

  setState({ syncing: true });

  let cursors: SyncCursors = memo.read().cursors;
  let pushing = true;
  let pulling = true;

  try {
    while ((pushing || pulling) && outcome.rounds < MAX_ROUNDS) {
      outcome.rounds += 1;

      const batch = pushing ? await collectPush(batchSize) : { changes: [], seqs: [] };

      const request: SyncRequest = {
        changes: batch.changes,
        since: cursors,
        historyFloor: historyFloor(now()),
        limit: undefined,
      };

      let response;
      try {
        response = await transport(request);
      } catch (error) {
        await recordPushFailure(batch);
        throw error;
      }

      // --- push half ---
      const settled = await settlePush(batch, response);
      outcome.pushed += settled.acked;
      outcome.rejected += settled.rejected.length;
      // Nothing acked means either the queue is empty or its head is stuck. Either
      // way, re-peeking would return the same rows: stop pushing this run.
      if (settled.acked === 0) pushing = false;

      // --- pull half ---
      const applied = await applyPull(response.pulled);
      outcome.pulled += applied.applied;
      outcome.weeksApplied += applied.weeksApplied;

      cursors = response.cursors;
      memo.write({ cursors, lastPullAt: now() });
      pulling = response.hasMore;
    }

    failures = 0;
    setState({ syncing: false, lastPullAt: memo.read().lastPullAt, lastError: null });
    return outcome;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    outcome.error = message;
    failures += 1;
    setState({ syncing: false, lastError: message });
    scheduleRetry(backoffMs(failures));
    return outcome;
  }
}

/**
 * The oldest date worth pulling. The device keeps a bounded window (D47) while the
 * server keeps everything (D48), so a fresh cursor must not drag years of history back
 * down only for `pruneHistoryBefore` to delete it again. Matches
 * `LOCAL_HISTORY_WINDOW_DAYS` exactly, so the two never disagree.
 */
function historyFloor(now: IsoDateTime): string {
  return addDays(dateOnly(now), -LOCAL_HISTORY_WINDOW_DAYS);
}

export function backoffMs(attempt: number): number {
  return Math.min(BACKOFF_BASE_MS * 2 ** Math.max(attempt - 1, 0), BACKOFF_MAX_MS);
}

// ---------------------------------------------------------------------------
// Triggers — app start, connectivity, visibility, after a write
// ---------------------------------------------------------------------------

let started = false;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let writeTimer: ReturnType<typeof setTimeout> | null = null;
let outboxSubscription: Subscription | null = null;

function scheduleRetry(delay: number): void {
  if (typeof window === "undefined") return;
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = setTimeout(() => {
    retryTimer = null;
    if (navigator.onLine) void syncNow();
  }, delay);
}

function onOnline(): void {
  failures = 0;
  void syncNow();
}

function onVisibilityChange(): void {
  if (document.visibilityState === "visible" && navigator.onLine) void syncNow();
}

/**
 * Start the automatic triggers. Idempotent, and a no-op during SSR — it is called from
 * `useSyncStatus`, which is mounted for the whole session because the status indicator
 * is (D46), so "app start" and "the indicator exists" are the same moment.
 */
export function startSync(): void {
  if (started || typeof window === "undefined") return;
  started = true;

  window.addEventListener("online", onOnline);
  document.addEventListener("visibilitychange", onVisibilityChange);

  // After a write. Driven by the outbox's own depth rather than a timer: a
  // `setInterval` waking on every route would burn a budget Android phone's battery
  // for a value that only changes when something is written (D47). Debounced, so
  // saving a goal and its stage is one push, not two.
  outboxSubscription = liveQuery(() => getOutboxDepth()).subscribe({
    next: (depth) => {
      if (depth === 0) return;
      if (writeTimer) clearTimeout(writeTimer);
      writeTimer = setTimeout(() => {
        writeTimer = null;
        if (navigator.onLine) void syncNow();
      }, WRITE_DEBOUNCE_MS);
    },
    error: () => {
      // A Dexie observable that dies must not take the other triggers with it.
    },
  });

  if (navigator.onLine) void syncNow();
}

/** Tear-down. Exists for tests and for symmetry; nothing in the app stops syncing. */
export function stopSync(): void {
  if (!started) return;
  started = false;
  window.removeEventListener("online", onOnline);
  document.removeEventListener("visibilitychange", onVisibilityChange);
  outboxSubscription?.unsubscribe();
  outboxSubscription = null;
  if (retryTimer) clearTimeout(retryTimer);
  if (writeTimer) clearTimeout(writeTimer);
  retryTimer = null;
  writeTimer = null;
}

/** Test helper: forget cursors and the last-pull stamp without touching the mirror. */
export function resetSyncMemo(): void {
  resolved().memo.write(emptyMemo());
}
