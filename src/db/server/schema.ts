// Drizzle schema — Postgres (Supabase). Architecture.md §5 / §5.1.
//
// Shape rules that govern this file (D51): a new table or a new nullable column
// later is fine; renaming, splitting, or moving columns between tables is not. So
// `stages` exists now (extracting it later would move columns off `goals`), and
// `goal_cycles` is deliberately absent (a new table with an FK to `goals` is purely
// additive, and verdict cycles are PRD §6.1 `[later]`).
//
// Columns mirror `core/types.ts`, which is frozen. Mapping between these rows and the
// core types happens at the edges — nothing outside `db/server/**` imports this file's
// inferred types, so the domain contract stays `core/types.ts` (D34).

import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  doublePrecision,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import type {
  CadenceType,
  GoalState,
  SessionSource,
  SessionStatus,
  StageState,
  Weekday,
} from "@/core/types";

// ---------------------------------------------------------------------------
// Shared column builders
// ---------------------------------------------------------------------------

/** Client-authored logical clock. LWW on this column resolves edits (§6). */
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

/**
 * Server-authored cursor. `POST /api/sync { since }` pages on this, not on the
 * client-supplied timestamps, which are subject to device clock skew (§6).
 */
const serverUpdatedAt = () =>
  timestamp("server_updated_at", { withTimezone: true }).notNull().defaultNow();

/** Tombstone, so a delete on one device can propagate. Mutable tables only —
 *  the append-only tables are facts and are never rewritten (D32). */
const deletedAt = () => timestamp("deleted_at", { withTimezone: true });

const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

const WEEKDAYS = "'mon','tue','wed','thu','fri','sat','sun'";

// ---------------------------------------------------------------------------
// users — one row in v1. Exists so auth is additive rather than a rewrite (§5).
// ---------------------------------------------------------------------------

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** Null until auth lands; unique so it can become the login identity as-is. */
  email: text("email").unique(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  serverUpdatedAt: serverUpdatedAt(),
});

// ---------------------------------------------------------------------------
// dayparts — user boundaries + per-daypart active cap (D7, D11)
// ---------------------------------------------------------------------------

export const dayparts = pgTable(
  "dayparts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** "HH:mm" — text, not `time`, so it round-trips as core/types.ts writes it. */
    startTime: text("start_time").notNull(),
    endTime: text("end_time").notNull(),
    /** Max active stages eligible for this daypart (D7, D11). */
    activeCap: integer("active_cap").notNull(),
    sortOrder: integer("sort_order").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    serverUpdatedAt: serverUpdatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    index("dayparts_user_idx").on(t.userId, t.sortOrder),
    check("dayparts_start_time_check", sql`${t.startTime} ~ '^[0-2][0-9]:[0-5][0-9]$'`),
    check("dayparts_end_time_check", sql`${t.endTime} ~ '^[0-2][0-9]:[0-5][0-9]$'`),
    check("dayparts_active_cap_check", sql`${t.activeCap} >= 0`),
  ],
);

// ---------------------------------------------------------------------------
// goals — name, purpose, priority tier, lifecycle state (§5)
// ---------------------------------------------------------------------------

export const goals = pgTable(
  "goals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    purpose: text("purpose").notNull(),
    /** Priority tier, lower = higher priority (D10). */
    tier: integer("tier").notNull(),
    state: text("state").$type<GoalState>().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    serverUpdatedAt: serverUpdatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    index("goals_user_state_idx").on(t.userId, t.state),
    // Mirrors GoalState in core/types.ts exactly. PRD §6.1 also lists `completed`;
    // that gap belongs to core/types.ts and is reported, not patched here.
    check("goals_state_check", sql`${t.state} in ('planned','active','dropped')`),
  ],
);

// ---------------------------------------------------------------------------
// stages — the scheduling unit. Carries everything schedulable (D19b, D23).
// Hangs off the goal, not the cycle (§5.3, D26).
// ---------------------------------------------------------------------------

export const stages = pgTable(
  "stages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    goalId: uuid("goal_id")
      .notNull()
      .references(() => goals.id, { onDelete: "cascade" }),
    /** Fixed time-box, regardless of content (D12). */
    sessionMinutes: integer("session_minutes").notNull(),
    cadenceType: text("cadence_type").$type<CadenceType>().notNull(),
    /** Sessions per week. */
    cadenceCount: integer("cadence_count").notNull(),
    /** Weekday set — for `fixed_days` / `hybrid` only (D26). */
    cadenceDays: text("cadence_days").array().$type<Weekday[]>(),
    /** A set of daypart ids, not one value (D7). */
    eligibleDayparts: uuid("eligible_dayparts").array().notNull(),
    /** Hard recovery ceiling (D20). */
    maxPerWeek: integer("max_per_week"),
    /** Optional rest gap (D20). */
    minRestDays: integer("min_rest_days"),
    /** e.g. "chapter". */
    scopeUnitLabel: text("scope_unit_label"),
    /** e.g. 30 — enables the target-date line (D28). */
    scopeUnitTotal: integer("scope_unit_total"),
    targetDate: date("target_date", { mode: "string" }),
    /** Set when computed backwards from a later stage (D24, v2). */
    deadlineDerived: boolean("deadline_derived").notNull().default(false),
    sortOrder: integer("sort_order").notNull(),
    state: text("state").$type<StageState>().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    serverUpdatedAt: serverUpdatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    index("stages_goal_idx").on(t.goalId, t.sortOrder),
    index("stages_state_idx").on(t.state),
    check(
      "stages_cadence_type_check",
      sql`${t.cadenceType} in ('frequency','fixed_days','hybrid')`,
    ),
    check("stages_state_check", sql`${t.state} in ('pending','active','done')`),
    check("stages_session_minutes_check", sql`${t.sessionMinutes} > 0`),
    check("stages_cadence_count_check", sql`${t.cadenceCount} >= 0`),
    check(
      "stages_cadence_days_check",
      sql`${t.cadenceDays} is null or ${t.cadenceDays} <@ array[${sql.raw(WEEKDAYS)}]::text[]`,
    ),
    // `fixed_days` and `hybrid` are meaningless without a weekday set (D26).
    // Deliberately one-directional: a `frequency` stage carrying a leftover empty
    // array is harmless, and rejecting it would only make the UI fussier.
    check(
      "stages_cadence_shape_check",
      sql`${t.cadenceType} = 'frequency' or (${t.cadenceDays} is not null and cardinality(${t.cadenceDays}) > 0)`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// session_logs — append-only. What actually happened (D32).
// ---------------------------------------------------------------------------

export const sessionLogs = pgTable(
  "session_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    stageId: uuid("stage_id")
      .notNull()
      .references(() => stages.id),
    date: date("date", { mode: "string" }).notNull(),
    /** The daypart it was recorded against; kept even if boundaries change (D44). */
    daypartId: uuid("daypart_id")
      .notNull()
      .references(() => dayparts.id),
    minutes: integer("minutes").notNull(),
    status: text("status").$type<SessionStatus>().notNull(),
    /** `voluntary` credits catch-up without ever imposing debt (D20). */
    source: text("source").$type<SessionSource>().notNull(),
    loggedAt: timestamp("logged_at", { withTimezone: true }).notNull(),
    serverUpdatedAt: serverUpdatedAt(),
  },
  (t) => [
    index("session_logs_stage_date_idx").on(t.stageId, t.date),
    index("session_logs_date_daypart_idx").on(t.date, t.daypartId),
    index("session_logs_cursor_idx").on(t.serverUpdatedAt),
    check("session_logs_status_check", sql`${t.status} in ('done','skipped')`),
    check("session_logs_source_check", sql`${t.source} in ('planned','voluntary')`),
    check("session_logs_minutes_check", sql`${t.minutes} >= 0`),
  ],
);

// ---------------------------------------------------------------------------
// checkpoints — append-only. Coarse progress, "chapter 7" (D13).
// ---------------------------------------------------------------------------

export const checkpoints = pgTable(
  "checkpoints",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    stageId: uuid("stage_id")
      .notNull()
      .references(() => stages.id),
    /** Progress in the stage's `scope_unit_label` units. Fractional — a metric goal
     *  (70 → 73kg) is the same arithmetic as "chapter 7" with a different unit (D28). */
    value: doublePrecision("value").notNull(),
    loggedAt: timestamp("logged_at", { withTimezone: true }).notNull(),
    serverUpdatedAt: serverUpdatedAt(),
  },
  (t) => [
    index("checkpoints_stage_logged_idx").on(t.stageId, t.loggedAt),
    index("checkpoints_cursor_idx").on(t.serverUpdatedAt),
  ],
);

// ---------------------------------------------------------------------------
// check_ins — append-only. Daypart + available minutes stated by the user (D8).
// A fact, not a derivation — which is why reconciliation travels between devices
// without the plan having to (§5.2).
// ---------------------------------------------------------------------------

export const checkIns = pgTable(
  "check_ins",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    daypartId: uuid("daypart_id")
      .notNull()
      .references(() => dayparts.id),
    availableMinutes: integer("available_minutes").notNull(),
    date: date("date", { mode: "string" }).notNull(),
    checkedInAt: timestamp("checked_in_at", { withTimezone: true }).notNull(),
    serverUpdatedAt: serverUpdatedAt(),
  },
  (t) => [
    index("check_ins_date_daypart_idx").on(t.date, t.daypartId),
    index("check_ins_cursor_idx").on(t.serverUpdatedAt),
    check("check_ins_available_minutes_check", sql`${t.availableMinutes} >= 0`),
  ],
);

// ---------------------------------------------------------------------------
// push_subscriptions — Web Push endpoints per device (§5)
// ---------------------------------------------------------------------------

export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    endpoint: text("endpoint").notNull().unique(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    /** Optional human label, so "per device" is legible in settings. */
    deviceLabel: text("device_label"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    serverUpdatedAt: serverUpdatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [index("push_subscriptions_user_idx").on(t.userId)],
);

// ---------------------------------------------------------------------------
// plan_weeks + plan_slots — the plan syncs, atomically per week (D45, §5.2)
//
// `plan_weeks` is not in Architecture.md §5's table list, but D45 requires "one
// version stamp for the whole week". Putting that stamp on every `plan_slots` row
// would mean extracting it into its own table later — moving a column between
// tables, which is exactly the reshape D51 forbids. So it gets its table now.
//
// "Latest wins wholesale" is then: replace the `plan_weeks` row and let the FK
// cascade take its slots with it.
// ---------------------------------------------------------------------------

export const planWeeks = pgTable(
  "plan_weeks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    weekStart: date("week_start", { mode: "string" }).notNull(),
    /** The whole week's version stamp. Monotonic per (user, week). Latest wins. */
    version: integer("version").notNull().default(1),
    updatedAt: updatedAt(),
    serverUpdatedAt: serverUpdatedAt(),
  },
  (t) => [
    unique("plan_weeks_user_week_key").on(t.userId, t.weekStart),
    index("plan_weeks_cursor_idx").on(t.serverUpdatedAt),
  ],
);

export const planSlots = pgTable(
  "plan_slots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    planWeekId: uuid("plan_week_id")
      .notNull()
      .references(() => planWeeks.id, { onDelete: "cascade" }),
    stageId: uuid("stage_id")
      .notNull()
      .references(() => stages.id, { onDelete: "cascade" }),
    date: date("date", { mode: "string" }).notNull(),
    daypartId: uuid("daypart_id")
      .notNull()
      .references(() => dayparts.id),
    minutes: integer("minutes").notNull(),
  },
  (t) => [
    index("plan_slots_week_idx").on(t.planWeekId),
    index("plan_slots_date_daypart_idx").on(t.date, t.daypartId),
    check("plan_slots_minutes_check", sql`${t.minutes} > 0`),
  ],
);
