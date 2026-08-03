// The wire contract for `POST /api/sync`. Pure types plus one const — no Dexie, no
// Drizzle — because both halves of sync import it: `sync/` on the client and
// `app/api/sync/route.ts` on the server. If the two sides ever disagree about the
// shape of a row, this is the file that was edited on one side only.
//
// Architecture.md §6 sketches the endpoint as `{ since, changes[] } → { serverChanges[],
// serverTime }`. Two deliberate refinements to that sketch, both forced by D47:
//
//   - `since` is a **cursor per table**, not one scalar. A single cursor would need a
//     global ordering across ten tables to page safely; a cursor per table is one
//     indexed range each (`*_cursor_idx` on `server_updated_at` already exists for
//     exactly this).
//   - The response is bounded and says `hasMore`, so a first sync onto a fresh device
//     pages instead of loading every row ever written into memory.
//
// TIME ON THE WIRE (D53). Every `IsoDateTime` here is **local wall-clock**,
// `YYYY-MM-DDTHH:mm:ss`, no `Z` and no offset. They are compared as strings on both
// sides. `SyncCursor` is the one exception and is not an `IsoDateTime`: it is
// server-authored, opaque to the client, and only ever handed back unmodified.

import type {
  CheckIn,
  Checkpoint,
  Daypart,
  Goal,
  IsoDate,
  IsoDateTime,
  PlanSlot,
  SessionLog,
  Stage,
  Task,
} from "@/core/types";
import type { OutboxOp, SyncedTable } from "@/db/local/schema";

/** Opaque, server-authored. The client stores it and echoes it back, nothing more. */
export type SyncCursor = string;

/**
 * The tables a pull can page over. `SYNCED_TABLES` minus `planSlots`, and the
 * omission is D45 rather than an oversight: slots have no `server_updated_at` column
 * because they are never pulled on their own. The week is the unit — `planWeeks`
 * carries its slots down with it.
 */
export const PULLED_TABLES = [
  "users",
  "dayparts",
  "goals",
  "stages",
  "sessionLogs",
  "checkpoints",
  "checkIns",
  "tasks",
  "pushSubscriptions",
  "planWeeks",
] as const;

export type PulledTable = (typeof PULLED_TABLES)[number];

// Compile-time proof that the list above is a subset of the synced tables — if
// `SYNCED_TABLES` gains a member, this file has to be considered.
const _pulledIsSynced: readonly SyncedTable[] = PULLED_TABLES;
void _pulledIsSynced;

export type SyncCursors = Partial<Record<PulledTable, SyncCursor>>;

// ---------------------------------------------------------------------------
// Row shapes on the wire
// ---------------------------------------------------------------------------

/** Carried by every mutable row — LWW resolves on `updatedAt` (§6). */
interface WireMutable {
  updatedAt: IsoDateTime;
  deletedAt: IsoDateTime | null;
}

export type WireUser = { id: string; email: string | null } & WireMutable;
export type WireDaypart = Daypart & WireMutable;
export type WireGoal = Goal & WireMutable;
export type WireStage = Stage & WireMutable;
/** Mutable, not a fact — a task is answered after it is created (D68). */
export type WireTask = Task & WireMutable;

export type WirePushSubscription = {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  deviceLabel: string | null;
} & WireMutable;

/** Append-only facts. No `updatedAt`, no tombstone — they are never rewritten (D32). */
export type WireSessionLog = SessionLog;
export type WireCheckpoint = Checkpoint;
export type WireCheckIn = CheckIn;

export interface WirePlanWeek {
  id: string;
  weekStart: IsoDate;
  version: number;
  updatedAt: IsoDateTime;
}

export type WirePlanSlot = PlanSlot & { planWeekId: string };

/**
 * The plan's atomic unit (D45). A week and every one of its slots travel together in
 * both directions — as the payload of a single `planWeeks` outbox row on the way up,
 * and as one element of `pulled.planWeeks` on the way down. There is no wire shape
 * that can express half a week, which is the point.
 */
export interface WirePlanWeekBundle {
  week: WirePlanWeek;
  slots: WirePlanSlot[];
}

// ---------------------------------------------------------------------------
// Request
// ---------------------------------------------------------------------------

/** One outbox row on the wire. `seq` is echoed back so the client knows what to ack. */
export interface SyncChange {
  seq: number;
  table: SyncedTable;
  op: OutboxOp;
  rowId: string;
  /** The full row for `put`; `null` for `delete`. A `planWeeks` put carries a
   *  `WirePlanWeekBundle`, never a bare week. */
  payload: unknown;
  queuedAt: IsoDateTime;
}

export interface SyncRequest {
  /** FIFO by `seq`, bounded. */
  changes: SyncChange[];
  since: SyncCursors;
  /**
   * The oldest date this device intends to keep. The server holds everything (D48)
   * but the device keeps a bounded window (D47), so a fresh cursor must not drag
   * years of `session_logs`, `check_ins` and `tasks` back down. Applies to exactly
   * the tables `pruneHistoryBefore` deletes from — `checkpoints` is never pruned
   * locally, so it is never floored.
   */
  historyFloor: IsoDate | null;
  /** Max rows per table in the pull half. Server clamps it. */
  limit?: number;
}

// ---------------------------------------------------------------------------
// Response
// ---------------------------------------------------------------------------

export interface RejectedChange {
  seq: number;
  reason: string;
}

export interface PulledRows {
  users: WireUser[];
  dayparts: WireDaypart[];
  goals: WireGoal[];
  stages: WireStage[];
  sessionLogs: WireSessionLog[];
  checkpoints: WireCheckpoint[];
  checkIns: WireCheckIn[];
  tasks: WireTask[];
  pushSubscriptions: WirePushSubscription[];
  planWeeks: WirePlanWeekBundle[];
}

export interface SyncResponse {
  /** Seqs that are durably on the server. Only these may be acked. */
  applied: number[];
  /** Seqs the server refused. They stay in the outbox and are retried. */
  rejected: RejectedChange[];
  pulled: PulledRows;
  cursors: SyncCursors;
  /** True while any table still has rows past its returned cursor. The **only**
   *  correct pull-loop termination signal — see `engine.ts`. */
  hasMore: boolean;
  /** Server wall-clock, informational. Never used as a cursor or an `IsoDateTime`. */
  serverTime: string;
}

export function emptyPulledRows(): PulledRows {
  return {
    users: [],
    dayparts: [],
    goals: [],
    stages: [],
    sessionLogs: [],
    checkpoints: [],
    checkIns: [],
    tasks: [],
    pushSubscriptions: [],
    planWeeks: [],
  };
}
