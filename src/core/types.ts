// Frozen shared domain contract (Architecture.md §5). Types only, no logic.
// Changes need agreement — see Phases.md "Frozen after Wave 0".

export type IsoDate = string; // YYYY-MM-DD
export type IsoDateTime = string; // ISO 8601 timestamp

export type Weekday = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

export interface Daypart {
  id: string;
  name: string;
  startTime: string; // "HH:mm"
  endTime: string; // "HH:mm"
  activeCap: number; // max active stages eligible for this daypart (D7, D11)
  sortOrder: number;
}

export type GoalState = "planned" | "active" | "dropped";

export interface Goal {
  id: string;
  name: string;
  purpose: string;
  tier: number; // priority tier, lower = higher priority
  state: GoalState;
}

export type CadenceType = "frequency" | "fixed_days" | "hybrid"; // D26

export type StageState = "pending" | "active" | "done";

export interface Stage {
  id: string;
  goalId: string; // stages hang off the goal, not the cycle (§5.3)
  sessionMinutes: number; // fixed time-box (D12)
  cadenceType: CadenceType;
  cadenceCount: number; // sessions per week
  cadenceDays: Weekday[] | null; // for fixed_days / hybrid
  eligibleDayparts: string[]; // Daypart ids — a set, not one value (D7)
  maxPerWeek: number | null; // hard recovery ceiling (D20)
  minRestDays: number | null; // optional rest gap (D20)
  scopeUnitLabel: string | null; // e.g. "chapter"
  scopeUnitTotal: number | null; // e.g. 30 — enables the target-date line (D28)
  targetDate: IsoDate | null;
  deadlineDerived: boolean; // set when computed backwards from a later stage (D24, v2)
  sortOrder: number;
  state: StageState;
}

export type SessionStatus = "done" | "skipped";
export type SessionSource = "planned" | "voluntary";

export interface SessionLog {
  id: string;
  stageId: string;
  date: IsoDate;
  daypartId: string;
  minutes: number;
  status: SessionStatus;
  source: SessionSource; // voluntary credits catch-up without imposing debt (D20)
  loggedAt: IsoDateTime;
  /**
   * The task created alongside this log, if any (D70) — a reference, like `stageId`
   * or `daypartId` above, never content. The task's own title is what the user typed;
   * this field only points at it. Set once at creation, never backfilled — compatible
   * with this table being append-only (D32).
   */
  taskId: string | null;
}

export interface Checkpoint {
  id: string;
  stageId: string;
  value: number; // progress in the stage's scope_unit_label units
  loggedAt: IsoDateTime;
}

export interface PlanSlot {
  id: string;
  stageId: string;
  weekStart: IsoDate;
  date: IsoDate;
  daypartId: string;
  minutes: number;
}

export interface CheckIn {
  id: string;
  daypartId: string;
  availableMinutes: number;
  date: IsoDate;
  checkedInAt: IsoDateTime;
}

export type TaskStatus = "pending" | "done" | "skipped";

/**
 * A one-off time-box for one daypart (D68) — belonging to no goal, or optionally
 * attached to one via `stageId` (D70).
 *
 * Additive to this otherwise-frozen file: nothing above changed, and nothing in
 * `core/` reads this — the scheduler never sees a task, attached or not. It lives here
 * because this is the shared domain contract that the Dexie mirror, the Drizzle schema
 * and the sync wire types all map to, and three private copies would be three chances
 * to drift.
 *
 * Deliberately **not** a to-do item (PRD §1): it is anchored to `(date, daypartId)`
 * exactly like a `PlanSlot`, it carries a time-box exactly like a `Stage`, it is
 * answered done/skipped exactly like a `SessionLog` — and when its daypart ends
 * unresolved it is missed and dies there (D20). No priority, no due date, no carry
 * forward, no project.
 */
export interface Task {
  id: string;
  title: string;
  minutes: number; // fixed time-box, same as a session (D12)
  date: IsoDate; // the daypart occurrence's own date (D53), never `dateOnly(now)`
  daypartId: string;
  /**
   * The goal's stage this task is attached to, or `null` for a stray task (D68 vs
   * D70). Attachment is by stage, not goal, matching `SessionLog`/`Checkpoint` — a
   * goal is reached through its stage everywhere else in this schema, and D19b makes
   * one stage the ordinary case.
   */
  stageId: string | null;
  status: TaskStatus;
  /** When done/skipped was tapped. `null` while pending. */
  resolvedAt: IsoDateTime | null;
  createdAt: IsoDateTime;
}
