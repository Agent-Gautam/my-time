# my-time — Decision Log

Running record of design decisions made during discussion, before any code exists.
Appended each round. `PRD.md`, `Architecture.md` etc. get written *from* this file.

**Status:** PRD discussion in progress. Nothing built yet.

---

## The problem

Modern life presents many simultaneous goals and a variable amount of daily time.
Three failures follow from that:

1. **Tunnel vision or paralysis** — you focus on exactly one goal and neglect the rest,
   or you can't focus on any because too much is competing for attention.
2. **Uncertainty** — "at this pace, will I actually get there on time?"
3. **Discouragement on a miss** — you skip a day and don't know whether you're still
   on track or whether the whole thing has quietly slipped.

And underneath all three: **choosing what to do today, in priority order, given that
today might have 8 hours or 2.**

## The purpose, in the user's words

> "What should I do today so that I am consistent and one day achieve my goals or
> targets on time or before time, going smoothly without any worries."

## Constraints

- **User is the first and only user.** Auth is deferred, not designed away.
- **MVP needed soon** — must be usable by the author quickly.
- Shareable with others later if it works. Architecture shouldn't preclude that.

---

## Locked decisions

### D1 — A goal has two layers: protocol and verdict

- **Protocol** — what you do, how often, how long. Measurable daily. This is what
  gets scheduled and the *only thing the user is accountable for*.
- **Verdict** — what you hoped it would produce, tested at a review date.

They are separate because you can complete a protocol perfectly and still fail the
purpose (finish all 45 DSA lectures, still can't solve a medium in 20 minutes).

### D2 — Protocol outranks verdict

The verdict is less important than the protocol. A verdict may be **entirely
subjective** ("does my skin look better *to me*", "does my hair have more volume") and
is still recorded. Unmeasurable does not mean untracked.

### D3 — Accountable to the protocol, never to the outcome

The app may say "you're behind on showing up." It may never say "you're behind on
gaining 3kg." Outcomes are often outside the user's control (job applications →
interviews); protocols never are.

### D4 — Goals are chains of cycles, not single records

A cycle ends at its review date with a verdict plus a **user decision**:
- verdict unmet → continue, or drop
- verdict met → close it, or **renew with new criteria**

Both branches allow renewal. A goal is therefore a sequence of attempts over time.

### D5 — One goal shape, with progressive depth

Not rigid goal types. Behavior falls out of which fields are filled in:

| Filled in | Behavior |
|---|---|
| Protocol only | Scheduled and logged, no pace math ("read daily") |
| \+ criteria + review date | Adherence tracking, verdict prompt on review day |
| \+ measurable metric | Trend, early read on the verdict (weight, chapters) |
| \+ countable total + deadline | Full pace projection |

### D6 — Goals with no acceptance criteria still belong

Their purpose is to keep the user occupied and feeling like they improved that day.
The scheduler decides when they surface. Structurally they act as **ballast** — short,
always eligible, no urgency, used to fill leftover time. They can never displace a
goal that is behind, but they stop a slot going empty.

### D7 — Four dayparts, user-defined, with per-goal eligibility

Morning / afternoon / evening / night. Boundaries are **configurable, not hardcoded**.

Each goal declares which dayparts it may occupy — a set, not one value:
- yoga → morning only
- meditation → morning or evening (possibly both in one day)
- DSA → afternoon or evening

### D8 — Plan-ahead first, reconcile on check-in

The app lays out the **ideal plan up front** — everything decided in advance. Then
reality arrives:

1. User checks in. Usually on time; sometimes not.
2. If time is short, the algorithm drops tasks **from that daypart only**.
3. Dropped tasks are re-placed elsewhere — the scheduler may need to recompute
   broadly. Runs as a **background job** to avoid UI stalls.

The check-in surface must state:
- total time required to complete everything in this daypart
- how long the current daypart is, and when it ends

so the user can see the gap immediately.

### D9 — Scarcity of opportunity is a first-class scheduling signal

A task's urgency depends on how many chances it has left today. Yoga (morning-only)
must beat meditation (morning-or-evening) in the morning slot even if meditation
scores higher otherwise — otherwise yoga dies for the day and didn't have to.
Schedule the most constrained thing first.

### D10 — Priority is coarse tiers

Three tiers (roughly critical / normal / background), not a 1–10 scale. Fine-grained
weights are neither meaningfully assignable by the user nor helpful to the ranking.

### D11 — Active goal cap, with a future-goal backlog

The user will want to start more goals than they can actually run. So:

- Goals can be parked in a **future / planned** state.
- Only a **fixed number of goals may be active at once.**
- **The cap is set per daypart**, in settings, according to the user's own capacity.

This bounds WIP and deliberately reserves room for goals the user hasn't started yet.

### D12 — Fixed time-box per task, regardless of actual content

A task gets a fixed duration (DSA = 60 min) no matter how long the underlying
material runs. ±10 minutes is acceptable drift. Chosen explicitly to avoid
complexity.

Consequences:
- Scheduling stays a clean fixed-duration packing problem.
- Logging collapses to one tap — you confirm the block, not its contents.
- Solves most of the data-entry burden (see O3).
- **Cost:** time alone cannot project completion. Covered by an occasional coarse
  checkpoint (see D13).

### D13 — Progress is sessions, with an optional coarse checkpoint

Default progress signal = sessions completed. For goals that need a completion
forecast (GATE syllabus, a course), the user answers a **coarse** checkpoint
occasionally — "which chapter are you on?" — never per-video or per-question.

### D14 — The schedule explains itself

Every scheduled item carries a one-line reason: *"3rd of 4 gym sessions, 3 days left —
morning is its only slot."* The app's purpose is removing worry; an unexplained list
creates it. Explanation makes the scheduler arguable and therefore correctable.

### D15 — A miss recomputes, it never punishes

Skipping moves the required rate (0.75/day → 1.0/day) and the app reports the new
number calmly, or states plainly that the target is no longer reachable this window
and offers to reduce or extend. No streaks to break, no red.

---

## Scheduler design (proposed, being refined)

Signals feeding the score:

1. **Cadence debt** — required_remaining ÷ days_remaining_in_window. → 1.0 means
   mandatory today; > 1.0 means infeasible this window, and the app should say so.
2. **Deadline pressure** — remaining ÷ days left, vs the rate actually sustained.
3. **Staleness** — days since last done. Exists to prevent starvation.
4. **User importance tier** — D10.
5. **Scarcity of opportunity** — D9.

Selection: filter (eligible daypart, not already done, fits remaining time) → score
(`tier × pressure × scarcity`) → **pack** as a small knapsack rather than greedy sort →
fill leftover time with ballast (D6).

Coefficients deliberately unfixed; tuned once the app is in real use.

---

## Open questions

- **O1 — Planning horizon.** Does the ideal plan cover today, the week, or through to
  review dates?
- **O2 — Backlog promotion.** When an active goal ends, is the next goal promoted
  automatically or does the user choose? Does the per-daypart cap count goals or
  sessions?
- **O3 — Data entry** (partly addressed by D12/D13). Confirmed principle: the user
  should never face a blank form; logging is confirming a prompt the app already made.
- **O4 — Rescheduling scope.** How far may a displaced task move — same day, same
  week? When is it dropped outright rather than re-placed?
- **O5 — Short slots.** 30 minutes free, DSA's box is 60. Excluded, or is there an
  optional minimum-viable-session?
- **O6 — Tech stack.** Not discussed. Belongs to `Architecture.md`.
