// The schedule explains itself (D14): every slot carries a one-line reason, e.g.
// "3rd of 4 gym sessions, 3 days left — morning is its only slot."
import type { Daypart, Goal, PlanSlot, Stage } from "./types";

export interface ExplainContext {
  goal: Goal;
  stage: Stage;
  daypart: Daypart;
  ordinal: number; // this slot is the Nth session of the stage placed this window
  totalThisWindow: number; // total sessions required/placed for the stage this window
  daysLeftInWindow: number; // days remaining in the cadence window, inclusive of today
  eligibleDaypartsToday: readonly Daypart[]; // dayparts the stage could still have used today
}

export function explainSlot(_slot: PlanSlot, context: ExplainContext): string {
  const { goal, daypart, ordinal, totalThisWindow, daysLeftInWindow, eligibleDaypartsToday } = context;

  const countClause = `${ordinalWord(ordinal)} of ${totalThisWindow} ${goal.name} session${totalThisWindow === 1 ? "" : "s"}`;
  const urgencyClause = daysLeftInWindow <= 1 ? "last day this week" : `${daysLeftInWindow} days left`;
  const scarcityClause =
    eligibleDaypartsToday.length <= 1
      ? `${daypart.name} is its only slot today`
      : daypart.name;

  return `${countClause}, ${urgencyClause} — ${scarcityClause}`;
}

function ordinalWord(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}
