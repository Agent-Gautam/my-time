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
import { getOutboxHighWaterMark, LOCAL_HISTORY_WINDOW_DAYS } from "@/db/local/queries";
import { localNow } from "@/lib/daypart";
import type { IsoDateTime } from "@/core/types";

import { createMemoStore, emptyMemo, type SyncMemoStore } from "./memo";
import { applyPull } from "./pull";
import { collectPush, PUSH_BATCH_SIZE, recordPushFailure, settlePush } from "./push";
import type { SyncCursors, SyncRequest } from "./protocol";
import { httpTransport, SyncTransportError, type SyncTransport } from "./transport";

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
  /**
   * The server rejected this client's sync key (D59). Distinct from `lastError`
   * because it is the one state that does not clear itself: retrying is pointless, so
   * the indicator has to be able to say "this device is not syncing" rather than
   * showing a `pending` that will never resolve. Still not an action (D46) — there is
   * no button, because the fix is a deployment variable, not something the user does.
   */
  blocked: boolean;
}

const listeners = new Set<() => void>();

// A frozen snapshot object, replaced rather than mutated: `useSyncExternalStore`
// compares by reference and would miss an in-place edit.
let state: SyncEngineState = {
  syncing: false,
  lastPullAt: null,
  lastError: null,
  blocked: false,
};

/** Stable across renders during SSR, where there is no engine and never a flush. */
const SERVER_STATE: SyncEngineState = {
  syncing: false,
  lastPullAt: null,
  lastError: null,
  blocked: false,
};

function setState(patch: Partial<SyncEngineState>): void {
  const next = { ...state, ...patch };
  if (
    next.syncing === state.syncing &&
    next.lastPullAt === state.lastPullAt &&
    next.lastError === state.lastError &&
    next.blocked === state.blocked
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
  state = { syncing: false, lastPullAt: null, lastError: null, blocked: false };
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
      // way, re-peeking would return the same rows: stop pushing this run. A batch
      // that came back short was the last one, so there is nothing to re-peek either —
      // that check saves an empty round trip on every ordinary sync.
      if (settled.acked === 0 || batch.changes.length < batchSize) pushing = false;

      // --- pull half ---
      const applied = await applyPull(response.pulled);
      outcome.pulled += applied.applied;
      outcome.weeksApplied += applied.weeksApplied;

      cursors = response.cursors;
      memo.write({ cursors, lastPullAt: now() });
      pulling = response.hasMore;
    }

    failures = 0;
    setState({
      syncing: false,
      lastPullAt: memo.read().lastPullAt,
      lastError: null,
      blocked: false,
    });
    return outcome;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    outcome.error = message;
    failures += 1;

    // A rejected key is the one failure retrying cannot fix, so it does not get the
    // backoff path: the loop stops and the state says so. Left on the retry path it
    // would flush every few minutes forever, never drain the outbox, and show nothing
    // but a permanent `pending` — a silent wedge, and worse than what the key prevents.
    // `onOnline`/`onVisibilityChange` still call `syncNow` directly, so a corrected
    // deployment recovers on the next foreground without a reinstall.
    const blocked = error instanceof SyncTransportError && error.isFatal;
    setState({ syncing: false, lastError: message, blocked });
    if (!blocked) scheduleRetry(backoffMs(failures));
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
/** Highest outbox `seq` the write-trigger has already reacted to. */
let lastSeenSeq = 0;

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

  // The persisted stamp, published before the first run. Without this the indicator
  // reports "never pulled" after every reload until a sync completes, which is not
  // what the memo store actually knows.
  setState({ lastPullAt: resolved().memo.read().lastPullAt });

  window.addEventListener("online", onOnline);
  document.addEventListener("visibilitychange", onVisibilityChange);

  // After a write. Driven by the outbox itself rather than a timer: a `setInterval`
  // waking on every route would burn a budget Android phone's battery for a value that
  // only changes when something is written (D47). Debounced, so saving a goal and its
  // stage is one push, not two.
  //
  // **Watches the high-water mark, not the depth.** `liveQuery` re-fires on any mutation
  // to the table, not only when its result changes, so a depth-based trigger also fired
  // when `settlePush` bumped `attempts` on a rejected row — sync, reject, bump, sync,
  // for as long as the row stayed refused. That is a request every 1.5s forever, and its
  // only visible symptom is a status indicator that never settles, which reads as
  // "working on it" rather than as a fault. `seq` moves only on a genuine enqueue, so
  // the engine can no longer trigger itself. See `getOutboxHighWaterMark`.
  outboxSubscription = liveQuery(() => getOutboxHighWaterMark()).subscribe({
    next: (highWaterMark) => {
      if (highWaterMark <= lastSeenSeq) return;
      lastSeenSeq = highWaterMark;
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
  lastSeenSeq = 0;
  if (retryTimer) clearTimeout(retryTimer);
  if (writeTimer) clearTimeout(writeTimer);
  retryTimer = null;
  writeTimer = null;
}

/** Test helper: forget cursors and the last-pull stamp without touching the mirror. */
export function resetSyncMemo(): void {
  resolved().memo.write(emptyMemo());
}
