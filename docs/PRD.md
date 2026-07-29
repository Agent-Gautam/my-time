# my-time — Product Requirements

**Status:** draft for review. Scope in §6 is a proposal, not yet signed off.
**Source of truth for decisions:** [`DECISIONS.md`](./DECISIONS.md) — every `D-number`
below refers to a decision recorded there, with its reasoning.

---

## 1. What this is

> Tell it your goals and how much time you have. It tells you what to do right now —
> and whether you are still going to make it.

A personal planning system that turns a set of long-running goals into a concrete
daily plan, and answers, continuously and honestly, *"am I still on track?"*

The daily task list is the visible surface. The product is the **predictability**.

## 2. The problem

You are carrying several goals at once — an exam, fitness, a skill, a routine — and
the time you have varies wildly from day to day. Eight hours today, two tomorrow.
Three things go wrong:

1. **Tunnel vision, or paralysis.** You pour everything into one goal and the others
   rot, or so much is competing that you can't start any of them.
2. **Uncertainty.** You have no idea whether your current pace actually reaches the
   target date. You find out when it's too late to change anything.
3. **Discouragement.** You skip a day and can't tell whether that mattered. The doubt
   costs more than the missed session did.

Underneath all three: **choosing what to do today, in the right order, for the amount
of time today actually has.**

### The purpose, in the author's words

> *"What should I do today so that I am consistent and one day achieve my goals or
> targets on time or before time, going smoothly without any worries."*

## 3. Users

**v1 — the author, single user.** Designed around one person's real routine. No
sign-up, no accounts, no sharing. Auth is **deferred, not designed away** — data is
modelled per-user from the start so multi-user is a later addition rather than a
rewrite.

**Later — other people, if it works.** Anyone juggling several long-horizon goals
against variable daily time: students preparing for a dated exam, people building a
fitness habit alongside study, anyone whose problem is allocation rather than memory.

Explicitly **not** built for: teams, shared goals, or task management. This is not a
to-do app, and a to-do list is not a degraded version of it.

## 4. Principles

These are product stances, not implementation notes. They decide arguments.

1. **You are accountable to the protocol, never to the outcome.** (D3) The app may say
   *"you're behind on showing up."* It may never say *"you're behind on gaining 3kg."*
   Outcomes are frequently outside your control; showing up never is.
2. **A miss recomputes, it never punishes.** (D15) Skipping moves a number and the app
   reports the new number plainly. No streaks to break, no red, no guilt pile.
3. **The app never shows confidence it hasn't earned.** (D25) Requirements are stated
   from day one because they're arithmetic. Predictions appear only when measured, and
   always as a range that visibly narrows.
4. **Never a blank form.** (O3) The app scheduled the work, so logging is *confirming a
   prompt*, not creating a record. Data entry proportional to nothing.
5. **The schedule explains itself.** (D14) Every scheduled item carries one line of
   reasoning. An unexplained list creates the worry the app exists to remove.
6. **Capacity is a ceiling, not a target.** (D21) Leftover time stays free. The app
   never nags you to fill it.

## 5. Core concepts

Precise definitions — these are the vocabulary for every other document.

**Goal** — something you are pursuing over time. Has a purpose, a priority tier
(D10: critical / normal / background), and a lifecycle state.

**Protocol** — what you actually *do*: cadence, session length, when it may happen.
Measured daily. The only thing you're accountable for. (D1)

**Verdict** — what you hoped the protocol would produce, tested on a review date. May
be entirely subjective (*"does my skin look better to me"*) and is still recorded.
Ranks below the protocol. (D1, D2)

**Cycle** — a goal is a chain of attempts, not one record. Each cycle ends at its
review date with a verdict plus a decision: drop, continue, or **renew with new
criteria**. Renewal is available whether the verdict was met or not. (D4)

**Stage** — the unit of scheduling. Every goal has one or more. Most have exactly one
and never see the concept. Duration, cadence and daypart eligibility all live here.
GATE has three: syllabus → revision → test series. (D23)

**Daypart** — morning / afternoon / evening / night. Boundaries are **user-configured,
not hardcoded**. Each stage declares which dayparts it may occupy — a set, not one
value. Yoga is morning-only; meditation is morning-or-evening; DSA is
afternoon-or-evening. (D7)

**Session** — one scheduled instance of a stage, with a **fixed time-box** regardless
of the underlying content (D12). DSA is 60 minutes whether the video ran 22 minutes or
40. ±10 minutes is acceptable drift.

**Check-in** — the user arrives, the app identifies the current daypart, asks how much
time is available, and reconciles the plan against reality. (D8)

**Active cap** — the maximum number of goals that may be active in a given daypart,
set by the user in settings. Goals beyond it wait in a **future/planned** state. (D11)

## 6. Features

Marked **[v1]** for the first usable build and **[later]** for deferred work.
This split is a proposal — see §8.

### 6.1 Goals

- **[v1]** Create a goal: name, purpose, priority tier, protocol.
- **[v1]** Lifecycle states: `planned` → `active` → `completed` / `dropped`.
- **[v1]** Per-daypart active cap; goals over the cap stay `planned`. (D11)
- **[v1]** A goal with no acceptance criteria is ordinary and fully supported —
  it simply has no verdict layer. There is no separate "habit" type. (D22, D5)
- **[later]** Verdict cycles: review date, acceptance criteria, verdict capture, and
  the drop / continue / renew decision. (D4) *Deferrable because the first review date
  is months out — it can ship before it is ever needed.*
- **[later]** Promotion from the planned backlog when an active goal ends. (O2)

### 6.2 Protocol and cadence

- **[v1]** Cadence expressed as frequency (*"4×/week, any days"*), fixed days
  (*"Mon/Wed/Fri"*), or hybrid (*"4×/week, one must be Sunday"*). Swappable without
  recreating the goal. (D26)
- **[v1]** Fixed session time-box per stage. (D12)
- **[v1]** Daypart eligibility as a set. (D7)
- **[v1]** Recovery constraints: hard weekly maximum, optional minimum rest gap
  between sessions — so voluntary catch-up cannot produce a six-day training week.
  (D20)

### 6.3 Stages

> **Architectural constraint for v1.** Even though multi-stage goals are deferred, v1
> **builds the stage table**, with exactly one implicit stage per goal. Duration,
> cadence and daypart eligibility live there from the very first commit (D19b, D23).
> The UI hides the concept entirely. This costs nothing now and means multi-stage
> support is an additive feature rather than a data migration.

- **[later]** Multiple stages per goal, each with its own duration, cadence,
  eligibility and progress unit. (D23)
- **[later]** Stage deadlines **derived backwards** from the final date, so late
  stages are protected and early stages absorb the pressure. (D24)
- **[later]** Scope-gap reporting: *"you are ~40 hours over, something has to be cut."*
  The app states the size of the gap and stops — **it does not suggest what to cut.**
  (D24, D27)
- **[later]** Manual stage advance, one explicit tap. Never inferred. (D27)

### 6.4 Planning

- **[v1]** **Layout** — places concrete sessions across a **rolling one-week**
  horizon, honouring caps, eligibility, cadence and recovery limits. Runs rarely
  (weekly, or when goals change). (D8, D16)
- **[v1]** **Scarcity-first placement** — a stage with fewer eligible dayparts is
  placed before one with more. Yoga claims the morning before meditation, which has an
  evening to fall back on. (D9)
  > Layout is the single hardest thing in v1 — caps, eligibility, cadence, recovery
  > limits and scarcity ordering all interact. `Phases.md` must sequence it **early**,
  > not last.
- **[v1]** **Reconcile** — at check-in, adapt the day's plan to the time actually
  available. Local and instant. (D8)
- **[later]** Full background re-layout after reconciliation, to quietly improve the
  rest of the week off the critical path.

### 6.5 Check-in

- **[v1]** Detects the current daypart; user confirms or corrects.
- **[v1]** User states available time.
- **[v1]** Surface states plainly: **time required for everything planned in this
  daypart**, **the daypart's length**, and **when it ends** — so the gap is visible
  immediately. (D8)
- **[v1]** Produces a ranked, packed list of sessions that fits the stated time.
- **[v1]** If a session's box does not fit the remaining time, it is not scheduled.
  No partial sessions. (D27)
- **[v1]** Each item carries **one line of reasoning**. (D14)

### 6.6 Logging

- **[v1]** One tap per scheduled session: done / skipped.
- **[v1]** Missed sessions **die officially** and are surfaced somewhere visible.
  Nothing is dragged forward as debt. (D20)
- **[v1]** Voluntary catch-up: do it on your own whenever you like, and the app
  records it and **credits it against the ideal line**. (D20)
- **[later]** Coarse progress checkpoint — *"which chapter are you on?"* — asked
  occasionally, never per video or per question. (D13)

### 6.7 Tracking and predictability

**What v1 can and cannot answer — read this carefully.**

There are two different "on track" questions and they need different inputs:

| Question | Needs | v1? |
|---|---|---|
| *"Am I keeping my commitments this week?"* | cadence only | **yes** |
| *"Will I reach my target date?"* | scope, units, stages | **no** |

For a cadence goal, on-track needs no scope whatsoever — *"4×/week, you've done 2,
it's Thursday"* is complete information. **Cadence debt is the required-vs-actual
comparison for every single-stage goal, and every single-stage goal is in v1.**

But *"will I finish the GATE syllabus in time"* needs a unit count and progress
checkpoints, both of which are deferred below. **v1 therefore says nothing about
target dates.** See §8 — this is the open scope decision.

- **[v1]** **Cadence-based required line** — from the protocol alone. Available
  immediately, needs zero setup, never a guess. (D25)
- **[v1]** **Actual line** — from logged sessions. On-track = actual vs required,
  meaningful from the first logged session.
- **[later]** **Scope-based required line** — hours-per-unit against a target date.
  Needs a unit count and the coarse checkpoint (§6.6). (D25)
- **[later]** **Measured-pace projection** — learns hours-per-unit from real sessions
  and projects a finish date **as a narrowing range**, never a point. Requires ~2 weeks
  of data, so it can ship after v1 without the user ever noticing a gap. (D17, D25)
- **[later]** Day-one budget breakdown for staged goals: countable stages subtracted
  from total budget to expose the remainder. (D19)

### 6.8 Settings

- **[v1]** Daypart boundaries — fully user-defined. (D7)
- **[v1]** Per-daypart active goal cap. (D11)

## 7. Out of scope for v1

Stated explicitly so the boundary is defensible.

- **Authentication, accounts, multi-user.** Single local user. (§3)
- **Sharing, social features, accountability partners.** None, ever, in v1.
- **Notifications and reminders.** The app is opened deliberately, not pushed.
- **Calendar integration.** No import of external appointments or events.
- **Per-item content tracking.** No video lists, no question banks, no lecture
  checkboxes. Time-boxes, not contents. (D12)
- **Automatic scope-cut recommendations.** (D27)
- **Automatic carry-forward of missed sessions.** Deliberately absent. (D20)
- **Streaks, badges, gamification.** Directly contradicts Principle 2.
- **Mobile native app.** Later, if ever.
- **AI-generated goal suggestions or plans.** The user brings the goals.

## 8. Open for sign-off

### 8.1 The v1 scope decision — target dates, in or out?

The author's stated motivation is **predictability**, and GATE is the live case. But
target-date prediction needs scope data that §6 defers. Two options:

**A — ship lean.** v1 answers *"am I keeping my commitments this week?"* for every
goal, and nothing about target dates. Fastest to a usable build. Risk: the exam — the
thing that actually prompted this app — gets no answer for weeks.

**B — pull minimum scope into v1.** Add a **unit count** per goal and the **coarse
weekly checkpoint** (§6.6), without any multi-stage machinery. That is one number
field and one dropdown, and it buys a real required-vs-actual line against a target
date for the goals that need one. Small addition, directly serves the stated purpose.

**Recommendation: B.** The cost is genuinely small and it delivers the feature the app
was conceived for. Full stages, backwards-derived stage deadlines and scope-gap
reporting stay deferred either way.

### 8.2 Also open

- **Stage deadline hardness (O11).** Advisory, or blocking?
- **Backlog promotion (O2).** Automatic or user-chosen when a slot frees up?

## 9. What "done" looks like for v1

The author uses it daily, without prompting, for two consecutive weeks — and can
answer **"am I keeping my commitments?"** for every active goal in under ten seconds.

Whether *"will I make it to the exam?"* is also answerable depends on §8.1.
