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

### D6 — Goals with no acceptance criteria still belong *(revised — see D21)*

Their purpose is to keep the user occupied and feeling like they improved that day.
The scheduler decides when they surface. Structurally they act as **ballast** — short,
always eligible, no urgency, usable to fill leftover time. They can never displace a
goal that is behind.

**Revision:** this was written when the user framed untracked habits as "keeping
myself busy and motivated." They have since said they want to focus on *few* things
per daypart and expect to get exhausted. The risk is over-filling, not under-filling.
So **ballast is off by default and opt-in per daypart** — leftover time stays free
unless the user asks for it to be used.

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

### D16 — Two horizons, deliberately different

The tension: weekly layout is cheap, but weekly-only means the app can never say
whether you'll make it to an exam three months out. Resolved by separating them:

- **Layout horizon — one rolling week.** Concrete sessions placed into real dayparts.
  Materialized a day at a time. Planning specific sessions weeks out is fiction.
- **Projection horizon — all the way to the deadline or review date.** Pure
  arithmetic, no session placement: `work_remaining ÷ weekly_capacity` vs `weeks_left`.

You do not need to schedule ninety specific days to know whether ninety days is
enough. The ideal-vs-real comparison therefore has two resolutions: fine-grained
adherence for this week, and a coarse projection line to the horizon.

### D17 — Estimate by measurement, not by upfront guessing

The user must never sit down and total up video lengths, practice time, re-watch
buffer, and revision time. That is hours of work and the result is wrong anyway.

Instead the app **measures the user's actual rate** from logged sessions and coarse
checkpoints (D13): "3 chapters completed across 14 sessions → 4.7 sessions/chapter."
Project the remaining chapters at the observed rate.

Properties:
- Zero setup burden.
- Uses the user's real pace — already includes their re-watching and their slow days.
- Self-correcting; accuracy improves every week.
- **Cost:** no projection is possible for roughly the first two weeks. The app must
  say so honestly ("learning your pace") rather than invent a number. A day-one
  projection would be fiction regardless of how it was produced.

An optional rough upfront estimate may serve as a starting prior, superseded by
measurement as soon as enough data exists.

### D18 — Large goals have sequential stages

GATE is not one thing: **syllabus → revision → test series**. Each stage has its own
size, its own natural unit, and its own best estimation method:

- syllabus — uncertain, *measured* (D17)
- revision — estimated as a fraction of syllabus time
- test series — genuinely countable up front (20 tests × 3 hours = 60 hours)

Projection is the sum over stages. Mixing estimation methods per stage is correct;
forcing one method across the whole goal is not.

### D19 — The app computes the required rate backwards, budget-first

The user asked "is 2 hours a day the right amount for GATE?" The more useful question
is its inverse: given the work and the date, **you need X hours per week.**

Naively this collides with D17 — measured pace needs ~2 weeks, so a day-one verdict
looks impossible. D18 resolves it: **the estimable stages carry day-one feasibility.**

Day one, with zero measurement:

```
total budget      = daily hours × days to exam        (2h × 170d = 340h)
known stages      = test series, countable            (20 × 3h    =  60h)
                  + revision, fraction of syllabus    (est.       =  35h)
remaining for syllabus                                            = 245h
```

That is a real, actionable statement made before a single session is logged. If the
known stages alone exceed the budget, the plan is **already impossible** and the app
says so immediately — before months are invested.

Measurement then *tightens* the estimate rather than creating it: after two weeks of
syllabus pace, the app can say whether 245 hours is actually enough. Projection
starts coarse and sharpens; it never starts from nothing.

### D19b — Session duration belongs to the stage, not the goal

D12 fixes a time-box per task, but GATE's test series runs 3 hours per session while
its syllabus sessions are 60 minutes. Same goal, different stage, different box.
Duration, and therefore daypart eligibility, are **stage-level** properties.

### D20 — Missed sessions die officially; catch-up is voluntary and credited

No automatic carry-forward. Reasons differ by goal:

- **Recovery-constrained goals (workouts)** must not accumulate debt. Missing two
  sessions cannot produce a 6-day training week — that is actively harmful.
- **Non-recovery goals (GATE)** could in principle recover, but automatic
  redistribution adds complexity and produces a growing pile of obligation.

So the app **officially kills the missed session** and reports it (dashboard / goal
page / backlog view — UI later). The user may do it on their own whenever they want,
and the app **records that and credits it against the ideal path**, so the ideal line
can still be matched.

Voluntary catch-up, never imposed debt. Requires a per-goal **maximum frequency /
recovery constraint** so voluntary catch-up cannot itself become harmful.

### D21 — Capacity is a ceiling, not a target

Two independent constraints: number of active goals per daypart (attention) and the
length of the daypart (time). If free time remains after laying out active goals,
**it stays free.** Activating another goal is the user's explicit choice.

The app must never nag the user to fill capacity. Stated reason: the user wants to
focus on few things per daypart and expects to get exhausted otherwise.

This supersedes the original reading of D6: ballast is **opt-in per daypart**, not the
default behaviour.

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

- ~~O1 — Planning horizon~~ → resolved by **D16**.
- **O2 — Backlog promotion.** When an active goal ends, is the next goal promoted
  automatically or does the user choose? Can a parked goal carry a "not before" date?
- **O3 — Data entry** (largely addressed by D12/D13/D17). Confirmed principle: the
  user should never face a blank form; logging is confirming a prompt the app already
  made.
- ~~O4 — Rescheduling scope~~ → resolved by **D20**.
- **O5 — Short slots.** 30 minutes free, DSA's box is 60. Excluded, or is there an
  optional minimum-viable-session?
- **O6 — Tech stack.** Not discussed. Belongs to `Architecture.md`.
- ~~O7 — Ballast vs exhaustion~~ → resolved: ballast opt-in per daypart (D6 revised, D21).
- **O8 — Cold start.** What the app shows during the first ~2 weeks, before measured
  pace exists (D17).
- **O9 — Stage transitions.** Does the user manually advance a goal from syllabus to
  revision to test series (D18), or is it inferred from checkpoints?
