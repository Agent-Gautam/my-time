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
