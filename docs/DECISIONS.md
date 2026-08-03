# my-time — Decision Log

Running record of design decisions made during discussion, before any code exists.
Appended each round. `PRD.md`, `Architecture.md` etc. get written *from* this file.

**Status:** all planning documents complete — `PRD.md`, `Architecture.md`, `CLAUDE.md`
(which replaced the planned `rules.md`, D49), `Phases.md`, `design.md`, `memory.md`.
Build has started; see `docs/memory.md` for live state.

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
   broadly. ~~Runs as a **background job** to avoid UI stalls.~~
   **Superseded by D32:** re-layout is a fast pure function and runs synchronously.
   No background job, no queue.

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

### D22 — "Ballast" is deleted as a concept

Earlier rounds treated criteria-less habits (read a book, brain game) as a special
scheduler category that auto-fills leftover time. The user rejected this framing:
**they decide what is active.** If an activated habit finds no room in any daypart,
that is simply a capacity fact, not a scheduling special case.

So there is no ballast mechanism. An untracked habit is an ordinary goal that happens
to have no verdict layer (D5). It is activated by the user, occupies a slot in the
active-goal cap (D11), and competes like everything else. One fewer concept to build.

### D23 — The stage is the unit of scheduling, not the goal

Every goal has **one or more stages**. Most goals have exactly one (hair care, gym,
reading) and the stage is invisible in the UI. Some have several (GATE: syllabus →
revision → test series; DSA similarly).

Duration, daypart eligibility, cadence and progress unit all live on the **stage**
(extends D19b). A single-stage goal is the ordinary case, not a special case, so the
same machinery serves both and nothing branches.

**Other goals with genuine stage structure**, for validation:

| Goal | Stages | Why the last stage must be protected |
|---|---|---|
| Marathon | base → build → **taper** | Skipping taper means racing exhausted |
| IELTS / language | vocab+grammar → conversation → mock tests | Untested fluency fails on the day |
| Job hunt | skills → portfolio → applications → interview prep | Applying with nothing built wastes the window |
| Interview DSA | learn patterns → topic practice → **timed mocks** | Untimed practice doesn't transfer |
| Writing | draft → revise → edit | An unedited draft isn't publishable |
| Driving test | lessons → solo practice → test |  |

The shared shape: **a fixed external date, and a late phase that is non-negotiable but
gets eaten by an early phase that expands.** Marathon taper is the clearest non-exam
case — it is the same failure as skipping revision.

### D24 — Stage deadlines are derived backwards, and scope is the release valve

The user's constraint: *"we can't just keep doing syllabus without caring about
revision and tests... maybe we can drop chapters or even subjects, but what's
necessary is necessary."*

So each stage carries **its own deadline**, computed **backwards from the final date**:

```
exam date
  └─ test series needs 60h  → must start by  <date>
       └─ revision needs 35h → must start by  <date>
            └─ therefore syllabus must FINISH by <date>
```

Late stages are protected. Early stages absorb the pressure. When the syllabus cannot
fit before its derived deadline, the app does **not** silently let it run over and eat
revision — it reports a **scope gap**: *"you are ~40 hours over; something has to be
cut."* Cutting scope is the release valve, and the app's job is to make the gap
visible early enough that cutting is still a choice rather than a casualty.

### D25 — The ideal line is a requirement; the actual line is measured

Resolves the day-one-predictability vs false-hope tension. The two lines on the chart
have completely different origins:

- **Required line** — pure arithmetic from scope, capacity and the date. Exists on
  **day one**, needs zero data, and is never a guess. *"8.2 hours per chapter."*
- **Actual line** — measured from logged sessions (D17). Starts empty, grows daily.

"Am I on track" = is the actual line above or below the required line. **That is
meaningful from the very first logged session** — one data point is enough to compare
against a requirement, though not enough to predict a finish date.

Prediction is layered on top only once data supports it, and is shown **as a range
that visibly narrows**, never as a confident point:

| | Shown |
|---|---|
| Day 1 | "You need 8.2 h/chapter. No pace data yet." |
| Day 14 | "Measured 6.7 h/chapter (3 chapters). Finish ≈ Jan 12, ±3 weeks." |
| Day 60 | "Finish ≈ Jan 4, ±5 days." |

The widening/narrowing band *is* the honesty mechanism. No invented confidence.

### D26 — Cadence supports frequency, fixed days, or both

Modelled on what the user already uses for training. A stage's cadence may be:

- **frequency only** — "4×/week, any days" → scheduler chooses (and D9 scarcity applies)
- **fixed days** — "Mon / Wed / Fri" → scheduler must honour
- **hybrid** — "4×/week, one must be Sunday"

Plus recovery constraints (D20): a hard **maximum per week**, and optionally a
**minimum rest gap** between sessions. The user expects to switch from fixed-days to
frequency-only when they join a gym, so both must be first-class and swappable
without recreating the goal.

### D27 — Three simplifications, chosen deliberately

- **No scope-cut suggestions.** When D24 reports a scope gap, the app states its
  size and stops there. It does not recommend which chapters or subjects to drop.
  Avoids per-unit importance metadata entirely, and the user knows their syllabus
  better than the app does. May revisit later.
- **Stage advance is manual.** One explicit tap moves a goal from syllabus to
  revision to test series. Never inferred from checkpoint position — an inferred
  transition triggered by a mis-tap would be both wrong and confusing.
- **No partial sessions.** A stage's time-box is fixed (D12). If the available time
  is shorter than the box, the session is simply not scheduled. No minimum-viable
  session, no divisible packing.

### D28 — Scope tracking is a general capability, not a GATE special case

The user's test: *"I would not need anything that is only designed for one or two
goals."* Scope passes it. Countable scope applies to an entire category — learning
goals (syllabus, courses, playlists, books, lessons) and measurable-metric goals
(weight 70→73kg is the same arithmetic with a different unit). Roughly half a typical
goal set.

The field is **optional** (D5 progressive depth), so cadence-only goals — skincare,
gym, meditation — are unaffected. v1 therefore includes a unit count plus the coarse
weekly checkpoint (PRD §8.1, Option B).

### D29 — Models designed to be stable under extension *(corrected — see D51)*

User constraint: *"if we completed v1 and want to implement v2 instantly, that should
be smooth — we won't be changing the UI and schema again and again."*

So the database schema models the **full decided design** from the first commit —
stages, cycles, verdicts, checkpoints — even where v1 leaves tables unused or holding
exactly one implicit row. Deferred features are **gated, not absent from the model.**
UI is composed so later features slot into existing surfaces.

**Honest caveat:** designing a schema for unbuilt features usually gets something
wrong. Mitigation — the schema covers only decisions *already made* here (D1–D28,
which is a lot). Genuinely new ideas may still require migration, and that is
accepted. This buys smoothness for the known roadmap, not for everything.

**Corrected by D51.** "Schema-complete" was an over-reading of what the user asked for.

### D30 — Stage deadlines are advisory, never blocking

A stage deadline passing does not stop anything. The app **informs**; the user decides
whether to advance, because they may have items left in the previous stage. Consistent
with manual stage advance (D27) and with D15 — inform, never punish.

### D31 — Backlog promotion is manual, but free capacity stays visible

No auto-promotion when a slot frees. The user activates a planned goal themselves.

But free slots must be **persistently visible** — *"keep it in my eyes always so I
know there is a free slot."* The line against D21's no-nagging rule:

- **Show the fact** — "evening: 2 of 3 slots used." Always visible. Correct.
- **Never prompt the action** — no "add a goal!", no badge, no empty-state guilt.

### D32 — Re-layout is a pure function; the real risk is churn, not concurrency

Many events trigger rescheduling: a missed session, activating or deactivating a goal,
editing cadence, a changed daypart boundary, a checkpoint update.

This is **not a concurrency problem.** Single user, tiny dataset (~15 goals, ~100
sessions/week), and layout is deterministic: `(goals, caps, dayparts, history, today)
→ week plan`. Therefore:

- **Recompute, never patch.** Regenerate the plan from inputs; do not incrementally
  mutate it. Idempotent by construction, so racing recomputes are harmless — the last
  one wins and produces the same answer.
- **Debounce.** Several changes within a few seconds collapse into one recompute.
- **Synchronous is fine.** At this data size layout runs in milliseconds. **This
  supersedes D8's "background job"**, which was premature optimisation. No queue, no
  worker, no extra infrastructure. Manual reconciliation is not needed.

The two constraints that *do* matter:

- **The past is immutable.** Re-layout may only regenerate *future* slots. Logged
  sessions are facts and are never rewritten.
- **Minimise churn.** If a trivial change reshuffles a day the user has already read,
  the plan stops feeling trustworthy. Re-layout must **prefer existing placements** and
  change only what it must. Stability is a feature, not an optimisation.

### D33 — Offline-first: the UI never talks to the network

Requirement: task completion and viewing today's plan must work offline, since those
are the daily-use paths.

Rather than bolting offline onto a networked app, invert it: **the UI reads and writes
only to a local IndexedDB store.** A separate sync layer moves data between local and
server. Offline therefore isn't a feature with edge cases — it is the default path, and
the network is the optional part.

### D34 — The scheduler runs on the client, as a pure module

Follows from D32 (layout is a pure function) plus D33. The plan is **derived state**,
recomputable from goals + history, so it never needs to be stored or synced.

Consequence: **check-in, plan generation, reconciliation and pace math all work fully
offline with zero server involvement.** The server is only a sync target and a push
sender.

Also the right shape for agentic coding — the hardest logic in the app becomes a
dependency-free TypeScript module with deterministic unit tests.

### D35 — Sync is last-write-wins; no CRDT required

Normally hand-rolled sync is a trap. It isn't here, because of what actually needs
syncing:

| Data | Shape | Conflict resolution |
|---|---|---|
| session logs | **append-only** facts | union of logs |
| checkpoints | **append-only** | union |
| goals / stages / settings | small, rarely edited, single user | last-write-wins |
| the plan | **derived — never synced** (D34) | n/a |

Append-only plus rare single-user edits means LWW is genuinely correct, not a
compromise. A local outbox queue for writes plus LWW on the server is a small amount
of code, not a sync engine.

### D36 — Push notifications are required *(reverses PRD §7)*

PRD §7 listed "notifications and reminders" as out of scope — *"the app is opened
deliberately, not pushed."* The user has since required **working push notifications,
especially on phone**, which is also why the app must be a **PWA**.

`PRD.md` §7 must be corrected. The daypart check-in reminder is the obvious first use.

**Platform caveat, unresolved:** Web Push works well on Android/Chrome. On iOS it
requires **16.4+ and the PWA installed to the Home Screen**, and is less reliable.
Whether requirement #3 is fully satisfiable depends on the phone — **needs
confirming.**

### D37 — Push scheduling cannot use Vercel Hobby cron — verified

Daypart reminders need roughly four triggers a day. Checked against Vercel's docs
(usage & pricing for cron jobs, last updated 2026-06-16) rather than assumed:

| Plan | Minimum interval | Scheduling precision |
|---|---|---|
| **Hobby** | **once per day** | **per-hour (±59 min)** |
| Pro | once per minute | per-minute |

Two disqualifiers, not one. A more-frequent cron expression **fails at deployment**,
and even the single permitted daily job fires anywhere inside a 59-minute window —
useless for "your evening daypart is starting."

Chosen: **Supabase `pg_cron`** (free tier) calling a Vercel endpoint on whatever
schedule is needed. Keeps the service count at two. Fallbacks: GitHub Actions cron, or
a Cloudflare Worker cron trigger.

### D37b — Reminders are content-free nudges

D34 puts the scheduler on the client, so the **server never computes the plan** — yet
D36's push is sent from the server on a cron. At reminder time the server therefore
cannot know that "you have 3 sessions this evening, 90 minutes."

Options considered: have the client upload a precomputed summary after each layout; or
share the pure scheduler module server-side (possible, but reintroduces the data
coupling D33/D34 removed).

**Decision for v1: send a content-free nudge** — *"time to check in."* The server needs
no plan knowledge at all, and it matches D8: reconciliation happens *at* check-in,
because available time is an input the app cannot know in advance. Rich notification
content can come later via the upload-summary route if it proves worth it.

### D38 — Stack

Chosen for **the author's development speed**, since the app has no hard technical
requirements (no realtime, no scale, no heavy compute) beyond offline and push.

| Layer | Choice | Why |
|---|---|---|
| Framework | **Next.js, App Router** | Author's home turf; first-class on Vercel |
| Hosting | **Vercel (Hobby)** | Free; git-push deploys; previews per branch |
| PWA / service worker | **Serwist** | Maintained Workbox wrapper for Next; `next-pwa` is stale |
| Local store | **Dexie (IndexedDB)** | `useLiveQuery` makes local-as-source-of-truth (D33) natural |
| Database | **Supabase Postgres** | Free; relational fits the schema; `pg_cron` (D37); auth ready when multi-user lands |
| Migrations / queries | **Drizzle ORM** | Explicit migrations — required by D29; light on serverless |
| Styling | **Tailwind + shadcn/ui** | Fast; `design.md` defines tokens on top |
| Push | **Web Push** (`web-push`) | Subscriptions stored in Postgres |
| Scheduler | **plain TypeScript module** | Pure, no deps, unit-tested (D34). Not a stack choice — needs its own section in `Architecture.md` defining the module boundary: inputs, outputs, what is pure and what is not. |

### D39 — AI is v2, with a provider fallback chain

Deferred by the user. When it lands, use free tiers with fallback:
**Groq → Gemini → OpenRouter.** Features undecided. The architecture must therefore
keep a seam for it rather than build it — a provider interface, nothing more.

### D40 — Deployed from day one

*"As soon as a feature is built, it directly goes to deployment."* So `main` auto-deploys
to production on Vercel from the very first commit, and a deployable skeleton ships
**before** any feature work. Branch previews for anything in progress. `Phases.md`
must therefore open with a deploy phase, not close with one.

### D41 — Target platforms: Windows + Android only

Both Chrome. **No iOS**, which removes the entire Web Push caveat from D36 — push works
natively, and installing the PWA is optional polish rather than required onboarding.
The app shell needs no forced install flow.

### D42 — Two guarded architectural invariants

The design rests on two rules that are trivially easy to violate by accident, so they
get mechanical enforcement (ESLint `no-restricted-imports`, checked in CI) rather than
good intentions. Detail belongs in `rules.md`:

1. **`src/core/**` is pure** — may not import `db/`, `app/`, `sync/` or `react`, and
   does not read the clock internally (time is an input). This is what keeps the
   scheduler deterministic and unit-testable (D34).
2. **The UI never fetches** — client components may not call `fetch` or import
   `db/server/`. Only `sync/` and route handlers touch the network. This is what makes
   offline the default path rather than a special case (D33).

### D43 — Plan slots are persisted locally despite being derived *(revised — see D45)*

Mild tension with D34 (the plan is derived and never synced) resolved: `plan_slots` is
a **local-only** table. It is still derived and still never synced, but it *is*
persisted on-device, because D32's churn rule requires re-layout to know the existing
placements in order to prefer them. Derived-but-remembered, not stored-as-truth.

**Revised by D45 — "local-only" was wrong.** Correct on persistence, wrong on scope.

### D44 — Editing daypart boundaries re-lays out the remainder

Resolves an `Architecture.md` §11 item. Changing boundaries at any time triggers
re-layout for **the rest of the day and week**. Consistent with D32: boundaries are an
input, inputs changed, regenerate.

Already-logged sessions are untouched — they carry the `daypart_id` they were recorded
against, and the past is immutable (D32).

### D45 — The plan syncs across devices, atomically per week

**Revises D43.** Offline-first was never meant to mean device-local. The requirement:
check in on the phone, switch to the laptop, and every surface shows the same thing —
with **no manual sync action**.

Determinism alone does not deliver this, and the reason is worth stating because it is
easy to get wrong:

- Reconciliation depends on **available minutes**, which the user *states* at check-in.
  That is a fact, not a derivation — but it is already a synced append-only row
  (`check_ins`), so that part is fine.
- Layout takes `existing` placements as an input, to minimise churn (D32). That makes
  layout **path-dependent**: two devices with different local `existing` state
  legitimately compute different plans. Determinism does not save you when an input
  differs.

Therefore **`plan_slots` is a synced table**, not local-only.

**Synced as a whole week, atomically.** Per-slot LWW could interleave slots from two
devices into an incoherent plan. Instead the week's plan carries one version stamp and
the latest wins wholesale. If two offline devices both re-lay-out, one loses entirely —
acceptable, because the plan is derived, not precious.

### D46 — Sync status is always visible; sync is never an action

No sync button, ever. But the state is **always on screen**: synced / syncing /
offline / *n* pending changes.

Same pattern as D31 (show the fact, never prompt the action): the user should never
wonder whether their devices agree, and should never have to do anything about it.

### D47 — Frontend performance is a requirement, not a polish item

Explicitly required: **never load whole lists at once.** Applies to session history,
logs, goal lists and the missed-session view — all of which grow without bound.

Expected: paginated or virtualised lists, indexed Dexie queries with bounded ranges
(never a full table scan into memory), route-level code splitting, and deferred loading
of anything below the fold. This belongs in `CLAUDE.md` as a standing rule, since it is
the kind of thing that erodes one convenient `.toArray()` at a time.

### D48 — Keep all history server-side until free-tier pressure

No aggressive pruning. Supabase retains full history — session logs, checkpoints,
check-ins — until free-tier limits are actually threatened, at which point archive or
prune. Local IndexedDB may hold a bounded recent window (D47) while the server keeps
everything.

### D49 — `rules.md` is replaced by root `CLAUDE.md`

Claude Code auto-loads only `CLAUDE.md` from the repo root. A separate `docs/rules.md`
would be a file nothing reads, which defeats its purpose. The user's call: skip
`rules.md` entirely and write the rules **in `CLAUDE.md`**.

The six planned documents therefore become: `PRD.md`, `Architecture.md`, **`CLAUDE.md`**
(in place of `rules.md`), `Phases.md`, `design.md`, `memory.md`.

### D50 — Dependencies: Claude may propose, must ask before adding

The stack (D38) is the default, not a freeze. Claude Code **may suggest a better
library** whenever it has a real reason, and must **ask before adding** any dependency.

No restriction on touching the database or migrations directly — this is not a critical
production system, and the whole project is being built by Claude Code. Guardrails
exist to protect the *architecture* (D42), not to fence off the codebase.

### D51 — Additive change is fine; *reshaping* is what must be avoided

Corrects an over-reading of D29. The user's actual requirement:

> *"This doesn't mean no new additions can be done, and the features coming in v2 need to
> exist in schema even in v1. I just mean that once a model is defined, it should barely
> get modified, so we should design models in such a way."*

So the rule is **not** "build every future table now." It is:

| Change | Verdict |
|---|---|
| New table referencing an existing one | ✅ expected, fine |
| New nullable column | ✅ fine |
| **Renaming or splitting an existing model** | ❌ this is what design must prevent |
| **Moving columns between tables** | ❌ same |
| **Changing a relationship's shape** | ❌ same |

The test for what belongs in v1 is therefore: *would adding this later force a reshape?*

- **`stages` — must exist in v1.** Putting cadence and duration on `goals` now and
  extracting `stages` later would move columns between tables. That is a reshape. (D23)
- **`goal_cycles` — may be deferred.** It is a new table with an FK to `goals`; adding it
  in v2 changes nothing that already exists. Purely additive.
- Everything else v1 uses is needed anyway.

Design models so extension is additive. Don't build speculative tables.

### D52 — Themes are data, and must be swappable by someone who isn't the author

Requirement: *"if in future I want to change the theme of the app, I should be able to do
it easily, not necessarily by myself."*

That is a stronger constraint than "support dark mode." It means retheming must not
require reading component code. So:

1. **Every colour lives in one file** as CSS variables. A theme is a block of variable
   values, nothing more. Adding a theme = adding a block.
2. **Zero raw colour values in components.** No hex, no `rgb()`, no Tailwind colour
   utilities like `bg-slate-800`. Only semantic tokens. **Lint-enforced**, like the other
   two invariants (D42).
3. **Token names stay semantic, never chromatic.** `accent-text`, not `amber-600`;
   `on-track`, not `green`. A renamed colour must not require renaming a token.
4. **Light and dark are just two entries**, not a hardcoded pair. The mechanism should
   accept a third without restructuring.

Someone handed the repo should be able to reskin the whole app by editing one file.

---

### D53 — `IsoDateTime` is local wall-clock, never UTC

Discovered while building the Wave 2.0 seam, and **forced rather than chosen**.

`Daypart.startTime`/`endTime` are wall-clock `"HH:mm"` strings, and `dateUtils.dateOnly()`
is `slice(0, 10)`. Those two only agree with each other if the timestamp they are compared
against is also local. So `IsoDateTime` is `YYYY-MM-DDTHH:mm:ss` — **no `Z`, no offset.**

`new Date().toISOString()` is therefore a bug anywhere in this codebase. It would put any
user east of UTC in the wrong daypart, and after roughly 18:30 local it would record
sessions against the wrong `date` — silently, because the unit tests pass date strings in
directly and never see it.

There is exactly one sanctioned clock read: **`localNow()` in `lib/daypart.ts`.** `core/`
still never reads the clock at all (D34); it receives these strings as parameters.

The cost is honest: a wall-clock stamp with no offset is ambiguous if the user changes
timezone, and it syncs to Postgres as a naive local time. Accepted, because the app is
single-user on Windows + Android (D41) and the daypart model is inherently wall-clock — a
morning session is at 7am wherever you are. Revisit only if multi-user (v2) lands.

### D54 — A stage gets at most one session per date

`PlanSlot.id` is `plan-<stageId>-<date>`, with no daypart or occurrence component, so the
identity scheme already asserts this. It was not *enforced*: `minRestDays` is optional and
usually null, so a retained slot plus a fresh placement could both land on one date with
the same id, and `bulkPut` collapsed them — a week silently one session short. Reproduced
at 14 slots / 12 unique ids in an ordinary three-goal week. Now enforced in
`placeRemaining` and covered by tests.

Making it explicit because it is a real modelling constraint, not just a bug fix: **cadence
counts days, not sessions.** "4×/week" means four days, and a stage cannot be scheduled
twice in one day even across two eligible dayparts. That fits the fixed time-box (D12) and
the recovery limits (D20). If a stage ever legitimately needs two sessions in one day, both
the id scheme and this rule have to change together — it is not a one-line relaxation.

The rule binds **both** placement paths, which is where the first fix was incomplete. A
logged session and a planned slot are the same thing for one date, so a slot on a date the
user has since completed is not retained either. Otherwise the day you just finished keeps
showing an outstanding session, and — worse — `layoutWeek` returns a different answer for
the same inputs depending on whether a prior plan was passed as `existing`, which breaks
the idempotence rule in `Architecture.md` §4.2. Caught by the planner seam tests, not by
the pure-scheduler ones.

### D55 — `fake-indexeddb` is a devDependency; the `core/` ⇄ Dexie seam is tested

The pure scheduler has thorough unit tests and `lib/daypart.ts` has its own. Neither can
see a **seam** bug, and the seam is where the real ones have been:

- The night-daypart anchor bug was handled correctly *inside* `daypart.ts` and lost at the
  call site — checking in at 01:00 showed an empty plan.
- The D54 retention bug above only appears when a prior plan meets logged history, which
  requires an actual database round trip.

So `tests/features/planner.test.ts` runs the real Dexie schema against `fake-indexeddb`
and asserts the properties that only exist at the seam: one `planWeek` row and one outbox
row per week however often layout runs (D45), `version` monotonic from 1, `reconcileNow`
writing nothing (D32), the night session still resolving after midnight (D53), no partial
sessions (D27), and a logged session actually clearing that day.

The dependency is dev-only and adds nothing to the bundle. It found a real bug on the first
run, which is the whole argument for it.

### D56 — The checkpoint prompt is gated on scope, not on a unit label

Reported from manual testing: *"which chapter are you on?"* appeared on a **gym** goal,
which reads as absurd.

The prompt is gated on `stage.scopeUnitLabel` alone, but the thing it feeds —
`pace.scopeStatus` — returns all-null unless **`scopeUnitTotal` *and* `targetDate`** are
both set. So a goal with a label and nothing else gets asked a question whose answer is
stored and then never used by anything. The gate and the consumer disagree.

**The prompt is gated on exactly what `scopeStatus` needs: `scopeUnitTotal != null &&
targetDate != null`.** Same condition, one source of truth.

On the underlying worry — *"if a goal other than GATE has scope, how would you ask about
it?"* — the unit label is user-defined and the question is generated from it, so a
12-week training block asks *"which week are you on?"* That is correct, not absurd. The
absurdity was only ever asking a goal that has **no** scope at all. Gym with no unit total
and no target date is a pure cadence goal (PRD §6.7: *"cadence debt is the required-vs-
actual comparison for every single-stage goal"*), and it is never asked anything.

This does not touch stages. Multi-stage goals remain `[later]` (D23); every v1 goal has one
implicit stage, and scope hangs off that stage exactly as before.

### D57 — The projection ships on the first checkpoint; the band carries the honesty

PRD §6.7 tagged measured-pace projection `[later]`, "requires ~2 weeks of data". In
practice `scopeStatus` emits one as soon as a single checkpoint exists, because
`measuredPerUnit = doneSessions / latestValue` is computable from one.

**Keeping that, deliberately.** The projection is already a **range**, and the band
widens as checkpoints are few (`paceProjectionBaseUncertaintyDays / checkpointCount`).
One checkpoint therefore produces a visibly wide range, which is an honest statement of
what is known — not a confident date. Gating it would show *nothing* for two weeks,
and "nothing" is not more honest than "somewhere in this wide window"; it just
withholds.

This does not weaken D25. D25 forbids **confident projections without data** and
requires a narrowing range rather than a point. A range that starts wide and narrows as
checkpoints accumulate is exactly what D25 asks for — the "~2 weeks" in the PRD was a
proxy for confidence, and the band measures confidence directly.

The failure mode to watch is the opposite one: if the band ever renders *narrow* on
thin data, that is a real D25 violation and the coefficients in `core/constants.ts` are
wrong.

### D58 — Deterministic ids are `text`, and the id scheme is the reason

Most rows carry a random UUID. Four kinds do not — their ids are derived from their
content so two devices independently producing "the same" row produce the **same id**,
which is what lets last-write-wins (D45) resolve instead of duplicate:

| Row | id | Why deterministic |
|---|---|---|
| user | `local-user` | one user, one row; a per-device UUID forks it |
| daypart | `daypart-morning` … | two fresh devices seeding four each would sync to eight |
| plan week | `week-<weekStart>` | D45 swaps the week wholesale — both devices must name it identically |
| plan slot | `plan-<stageId>-<date>` | **D54 is expressed as this id colliding** |

The server schema originally declared every `id` as Postgres `uuid`, so the **first
sync push would have failed on a type error** for exactly the tables the plan lives in.

**The columns follow the ids, not the other way round.** Those four `id` columns, every
FK referencing them, and `stages.eligible_dayparts` (an array *of* daypart ids) are
`text`. Making the ids UUIDs instead would have broken D54's identity rule and D45's
week naming — the determinism is load-bearing.

Recorded because the migration is easy to undo by accident: regenerating it with
`drizzle-kit generate` produces per-column `ALTER`s that Postgres rejects mid-flight
("Key columns are of incompatible types: uuid and text"). `0002` is hand-edited to drop
the FKs, convert, and recreate them, and says so at the top.

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

### D59 — `/api/sync` gets a shared key, and the key is honestly labelled "not auth"

Wave 3 put every row the app holds behind one unauthenticated `POST /api/sync`, on a
public URL. That is a change in kind, not degree: `/api/push/subscribe` only ever let a
stranger add a push token, while sync exposes the whole dataset for **read and write**.
Auth being deferred (context, top of this file) was decided when no endpoint could do
that.

Full auth is still deferred. What ships is a shared key in an `x-sync-key` header,
compared against `SYNC_KEY` on the server.

**It is not authentication and the code says so in those words.** The client is a
browser, so the value must reach it via `NEXT_PUBLIC_SYNC_KEY`, which Next inlines into
the JS bundle — and Serwist then precaches that bundle. Anyone who opens devtools can
read it. It raises the cost from "the URL is the entire secret" to "you have to look",
which stops crawlers and drive-by requests and stops nothing else. Recording it this
way matters more than the mechanism: a security control with an inflated label is worse
than none, because the next person trusts it.

Two consequences that are deliberate, not oversights:

- **It fails open.** With `SYNC_KEY` unset the check is skipped entirely. That is
  precisely today's behaviour, so an unset variable is not a regression — whereas
  failing closed would brick sync on any deployment that missed the variable, and a
  wedged outbox is far harder to notice than an open endpoint.
- **A 401 stops the retry loop.** Every other transport failure backs off and retries,
  because the outbox must survive. A rejected key is the one failure retrying cannot
  fix — a rotated key with a client still serving a precached bundle would flush
  forever, never drain, and render as an ordinary `pending`. It sets `blocked`, the
  indicator says so plainly, and it clears on the next accepted run. Still not an
  action (D46): the fix is a deployment variable, not something the user can do.

Rejection reasons are also trimmed on the wire — they were returning the failing SQL,
column list included, to an unauthenticated caller. Nothing on the client reads
`reason` (only `seq`), so the detail moved to the server log.

**The real gate, when it is wanted:** a passphrase entered once per device, held in
`localStorage`, sent as the same header and compared to a non-public variable. That
keeps strangers out for real, because nothing secret ships in the bundle. It costs a
gate screen and a recovery story for a forgotten passphrase, which is why it is written
down here rather than built. See **O14**.

### D60 — The daypart cap is a scheduling constraint, not an admission test

`activeCap` (D7, D11) was enforced **nowhere**. `layoutWeek` ignored it entirely, and
the goals screen computed occupancy as *"how many active stages list this daypart as
eligible"*. Reported from use: with two goals, both eligible everywhere, all four
dayparts read "2 of 2 used" — before a single session had been scheduled anywhere.

The counting rule was the bug, and it could not have been right. Eligibility is a
**set** (D7): meditation eligible for morning-or-evening does not occupy both, it
occupies whichever one the scheduler picks, and it may pick differently on different
days. Occupancy is therefore not knowable when a goal is created. **Only layout knows
where a session actually lands**, so that is where the cap belongs.

The unit is `(date, daypart)`: at most `activeCap` distinct stages placed in one daypart
on one day. D11's constraint is about attention — *"how many separate things am I doing
this evening"* — which is a daily question. A weekly cap would let one session a week
permanently consume a slot, and a lifetime cap is just the eligibility count again.

Consequences, each deliberate:

- **The cap is enforced in `retainValidExisting` as well as `placeRemaining`.** A
  retained slot occupies its daypart exactly as a fresh one does, so a cap checked only
  on placement is silently exceeded by any week laid out before the cap was lowered.
  This is the D54 failure shape, which is why it is called out here rather than left to
  be rediscovered.
- **Retention is processed scarcest-first (D9), not in map order.** When the cap binds,
  the stage with the fewest alternatives keeps the slot, and the result no longer
  depends on the order the caller passed `existing` in (§4.2 rule 1).
- **A capped-out day is left short. Nothing is evicted to make room** (D21): capacity is
  a ceiling, not a target. The stage tries again the next day.
- **`getDaypartCapacity` reads the plan**, and returns two numbers instead of one —
  today's occupancy, and how many days this week still have room. One is not enough to
  act on: a daypart can be full tonight and open on four other days, and *"can I start
  another goal here?"* is the question D31 exists to answer.

**Known gap, recorded rather than fixed.** `pace.cadenceStatus` computes feasibility
from rest gaps and `maxPerWeek`, and does not know about the cap. So a stage starved by
a full daypart is under-placed without the check-in screen explaining why. The goals
screen does now say "full all week", which is the visible fact, but the two surfaces do
not yet agree. Fixing it means teaching `pace.ts` about capacity, which is a larger
change than this one and wants its own decision.

---

### D61 — The app icon and loading mark are a dart and dartboard, and infinite CSS loops are allowed

The mark comes from `task-shot 2.0`'s `src/components/Loading.tsx` — three rings
blinking inner-to-outer, then a dart thrown in from the top right. It was only ever a
loading state there; the predecessor shipped `vite.svg` as its actual icon. Promoted
here to both: the loop is the loading state, and its landed frame is the app icon.

The palette lineage is direct, not a fresh pairing applied to an old idea.
`task-shot`'s `index.css` set `--secondary: 47 69 93` (`#2F455D`, today's `ink`) and
dark `--accent: 215 148 42` (`#D7942A`, today's dark `accent-fill`). §2's "carried
forward from `task-shot`" already meant this file.

**One thing changes on the way over.** A dartboard is conventionally red and green;
§2.3 bans red outright. The board is `accent-fill`, the dart is `ink` — two tones, no
third colour axis, and `ink`'s existing light/dark values already happen to be the
right contrast colour against the board on both themes, so no new token was needed.

**This required amending §6.1.** "Nothing infinite" was written against a real cost: a
JS-driven loop (the original used `motion/react`) keeps the main thread busy and drains
battery on a budget phone indefinitely. A `@keyframes` animation on `opacity`/
`transform` only runs on the compositor and costs close to nothing while idle, so that
reasoning doesn't reach it. §6.1 now permits infinite **only** under that condition;
shimmer, pulsing dots, and parallax stay banned, but on the grounds that they're built
to pull attention (§1) — the argument that was actually doing the work, restated so it
survives the exception. §6.2's duration cap is scoped to transitions with perceived
latency, which a loop doesn't have.

`motion/react` is **not** ported — nothing here needs a library the project doesn't
already have (D50). The whole loop is CSS: four elements, one shared 2600ms duration,
each carrying its own stagger in keyframe percentages so nothing can drift relative to
another however long it runs. `prefers-reduced-motion` drops straight to the assembled,
static mark rather than freezing on the loop's mid-fade frame — a dedicated override
in `globals.css` takes precedence over the project's existing blanket
animation-collapse rule, which would otherwise land on `opacity: 0`.

The four manifest icons and `favicon.ico` are generated PNGs (flat two-tone geometry, no
rasteriser dependency added) sharing the same coordinates as the `DartMark` component in
`src/components/dart-mark.tsx`, so the static mark, the loop's resting frame, and the
icon files are provably the same drawing.

### D63 — Today opens on the plan; stating your time is an explicit, occasional act

Today was a gate. `CheckinView` rendered a form first, and the session list did not
exist until the user typed a number and pressed "Check in" — `logSlot` even
early-returned unless a check-in was active. So the most common thing a user does,
*open the app and see what to do*, cost a form every time, including on the ordinary
days when nothing about the schedule had changed. The app's stated purpose is to remove
worry; making the user file a return before it will tell them anything works against
that.

**Today now shows the sessions the plan already put in the current daypart.** Stating
available time moves into an explicit panel, called **"Adjust today"** on screen, for
the days that are not ordinary.

**This does not contradict D8.** The plan is still laid out ahead, reconciliation still
happens when a time is stated, and D8's requirement that "the gap is visible
immediately" is *better* served: the gap is now on the default screen — *"2h 30m
planned · 1h 45m left"* — instead of behind a form. What changed is only that
reconciliation stopped being the price of admission.

**The default list is unpacked, and that is the point.** Packing against the time
remaining in the daypart would have shown "won't fit" without being asked, which
presumes the whole evening is free and is exactly the kind of unrequested verdict D21
rules out — capacity is a ceiling, not a target. So the default states the two numbers
and lets the user draw the conclusion. **"Won't fit today" appears only after a time is
stated.**

Three consequences worth knowing:

- **`reconcileNow`'s `availableMinutes` is `number | null`**, and `null` is a real
  branch that skips packing entirely. It is not a large sentinel: `reconcileDaypart`
  allocates a knapsack table of `availableMinutes + 1` cells, so `Infinity` throws and
  "big enough" quietly allocates an enormous array on a budget phone (D47). Since
  nothing can be dropped when no limit was given, there is also nothing for the packing
  pass to decide.
- **The stated time lives in the `check_ins` row, not in component state.** A reload or
  a PWA resume would otherwise forget it silently. Time already spent is derived from
  the day's `session_logs` rather than decremented in memory, which is both reload-safe
  and unable to drift from what was actually recorded. `getLatestCheckIn` already
  existed, bounded on `[date+daypartId]`, and was dead code until now.
- **The stored concept keeps its name.** `check_ins`, `LocalCheckIn`, `CheckIn` in the
  frozen `core/types.ts`, `putCheckIn` and the `checkIns` sync table are all unchanged.
  The fact being recorded did not change — the user said they had N minutes for this
  daypart at time T — and renaming it would reshape the schema, a frozen types file and
  the sync protocol at once, which D51 forbids. The rename is UI text only.

---

### D62 — Re-planning after a pull is injected into the engine, not imported by it

> Numbering note: D60 and D61 were taken by two parallel branches not yet on `main`
> (`fix/daypart-capacity`, `feature/dart-icon`). Reserved D62 to avoid a collision.

`relayoutWeek` was called from four screens — the two goal-form paths, daypart
settings, and check-in — and from nothing in `sync/`. Every one of those is a *local*
edit. A device that received goals, stages or dayparts **by pull** therefore kept
whatever plan it already had. Observed directly: a second device pulled down 5 goals
and 6 active stages and its plan still held the 2 slots laid out when one goal
existed. The goals were listed; Today was empty. Nothing was broken, nothing was
reported, and the plan was silently months stale.

So something has to re-plan after a pull. The question is who owns it, because the
obvious answers are all wrong in a specific way.

**Rejected — `sync/` imports `features/plan/planner`.** It inverts the layering:
`sync/` sits below `features/` (Architecture.md §8), and pull already refuses to touch
`db/local/mutations.ts` for the same reason. It is not caught by an ESLint guard, which
makes it worse, not better — the guards exist because layering violations are invisible
otherwise.

**Rejected — a UI effect watching `lastPullAt`.** This one is not merely inelegant; it
cannot work. `memo.write({ cursors, lastPullAt: now() })` runs on **every round of every
run**, so `lastPullAt` moves after a run that pulled zero rows. An effect on it would
re-plan constantly, and re-planning writes an outbox row, which bumps the outbox
high-water mark, which the write-trigger already watches: enqueue → sync → new
`lastPullAt` → re-plan → enqueue. A closed cycle at `WRITE_DEBOUNCE_MS`. That is the
D47 bug exactly — a request every 1.5s whose only symptom is a status indicator that
never settles, which reads as "working on it" rather than as a fault.

**Chosen — the UI hands `relayoutWeek` down at `startSync`; the engine calls it.**
`sync/` declares the shape (`RelayoutAfterPull = (now) => Promise<unknown>`) and knows
nothing else. `use-sync-status.ts` is already the composition root — it is the one place
that starts the engine, and it is on the UI side of the seam — so it is where the two
get introduced. The dependency points up, and the engine stays testable with a spy.

Three details that are load-bearing:

- **Registration is on `startSync`, not `configureSync`.** `configureSync` resets
  `state` and nulls `inFlight`. `useSyncStatus`'s effect is double-invoked under
  StrictMode, so registering there would clear a live run's coalescing guard and let a
  second run push the same head of the outbox twice. `startSync` is idempotent, and the
  registration sits above its `started` guard so a remount re-registers harmlessly.
- **The trigger is what `applyPull` wrote, not that a pull happened.** `ApplyOutcome`
  gains `inputsChanged`, true only when a **daypart, goal or stage row was actually
  written** — not received. The server re-sends an overlap on every pull by design, and
  a page that loses every LWW race changed nothing. `planWeeks` are deliberately
  excluded: they are layout's *output*, so applying one can never raise the flag, and
  nothing the relayout itself writes can re-trigger it.
- **Once per run, after the rounds, with the debt held in a module flag** that clears
  only when the relayout returns. If it throws, the run backs off and the next one
  retries — there is no second pull coming to re-raise the flag, because the rows are
  already in the mirror.

It settles in one extra round trip. B pulls A's goal, re-plans, and the outbox row it
leaves behind gets pushed on the next sync; A pulls B's week and adopts it verbatim
without re-planning, because a week is not an input. Then quiet.

**Session logs are excluded, by decision and not by oversight.** They *are* a layout
input — `checkin-view.tsx` re-plans after every local `logSession`, and `layoutWeek`
reads history. Including them here is loop-safe (append-only, insert-if-absent, so a
re-sent row applies zero). It was left out because layout depends on `now` for
"dayparts remaining today", so two devices re-planning off each other's logs produce
slightly different weeks and trade them back and forth on every check-in — churn on the
most frequent sync there is, for a plan D45 already treats as derived and disposable.

The cost is real and worth stating plainly: **a device shows a session another device
already completed until its next local re-plan.** Revisit if that becomes annoying in
use; the fix is one more counter in `applyPull`.

---

### D64 — The weekly max is a ceiling on the week's total, not an input to the plan

Reported from use: weekly max and min rest days *"are useless, they totally mismatch"*
the cadence. Correct, and the model was the incoherent part, not the labels.

`layout.ts` did `required = Math.min(required, stage.maxPerWeek)`. So **the weekly max
silently overrode the stated cadence**: 5×/week under a max of 3 planned 3, with
nothing on any screen saying why. At its worst it was worse than that — the form
stored `Math.max(0, Number(...))`, so a max of `0` was reachable, `Math.min(required,
0)` placed nothing, and the goal simply vanished from the plan.

That was never what the field was for. D20 introduced it as a **recovery ceiling so
that voluntary catch-up could not itself become harmful** — missing two sessions must
not produce a 6-day training week. D26 lists it under "plus recovery constraints",
separate from the three cadence shapes. The UI presented it as a peer of cadence, and
peers that disagree read as a contradiction, which is exactly how it read.

**Decision: the weekly max bounds the week's total — scheduled plus caught-up — and
never the plan.** Three changes, and they have to be all three:

- **`layout.ts` stops reading it.** The plan places the cadence the user stated (D26).
  Nothing reduces it silently, which is the D14 requirement: a schedule that cannot
  explain a number must not produce that number.
- **`pace.isFeasible` stops reading it too**, and this is the part worth deriving
  rather than asserting. The clause was `doneInWindow + requiredRemaining >
  maxPerWeek`. But `requiredRemaining === 0` returns true one line earlier, so any
  call reaching the clause has `doneInWindow < required`, making `doneInWindow +
  requiredRemaining` *exactly* `required`. It reduced to `required > maxPerWeek` and
  carried **no information about actual progress at all** — a config-validity check
  wearing feasibility's clothes, announcing "not reachable this week" about a week
  that was perfectly reachable. Deleting it is a correction, not a loss of cover;
  `doneInWindow` becomes unused and goes with it.
- **The form refuses a max below the cadence.** It is the user contradicting
  themselves, and it is the only place both numbers are on screen together. This is
  the same shape as the existing *"Required days can't outnumber the weekly cadence"*
  check, which was already there and already right. The two fields also now say what
  they do: *ceilings for catch-up, not a second cadence.*

Note what those two silent behaviours were doing **in opposite directions on the same
data**: layout quietly shrank the week to 3, while the check-in screen quietly called
the same week unreachable. Fixing one and leaving the other would have swapped which
surface lies.

The ceiling itself is untouched and still enforced, in the one place it belongs —
`checkin/lib.ts:voluntaryCandidates`, which already withholds a stage once the week's
done count has reached it (Architecture.md §9.3, which described it this way all
along). When it binds, the stage is simply not offered for catch-up, with nothing
said. Under D21 an unexplained *absence* is the conservative direction — the app must
never nag toward capacity — so that stays as it is.

**Stored data that already contradicts itself** is left with a defined behaviour
rather than a migration: the plan honours the stated cadence, the stale ceiling inerts
catch-up only, and the next edit of that goal surfaces the validation error that heals
it. `/api/sync` passes the column straight through and rows predating this exist, so
the form guarantee is a UI-level one, not an invariant the core may assume.

**`minRestDays` is deliberately not touched.** It is a genuine scheduling constraint —
`layout.respectsRest` honours it when placing, and an over-tight gap already surfaces
as `feasible: false` on the check-in screen rather than silently. It is a peer of
cadence in a way the weekly max never was.

**The D60 gap stays open, and this is not it.** `isFeasible` is the function D60's note
is about, so it needs saying: `cadenceStatus(stage, history, now)` still cannot see the
daypart cap, because that needs the plan and the dayparts, which are not its arguments.
A stage starved by a full daypart is still under-placed with nothing said at check-in.

Two tests asserted the removed behaviour and were replaced, not deleted quietly:
`layout.test.ts` *"caps total placements at max_per_week even when cadenceCount asks
for more"* and `pace.test.ts` *"respects maxPerWeek as a hard ceiling on feasibility"*.
Five now cover the decision, including the max-of-zero erasure. 197 → 200.
### D65 — The required rate is a three-rung ladder of division, and the app climbs only as far as its inputs reach

**Proposed. Not yet built.**

Reported as *"with AI, suggest sessions per week."* **Refuted.** There is no inference
here. D19 already specifies computing the rate backwards, budget-first; D25 already
says the required line is pure arithmetic that exists on day one and needs zero data.
D39 defers AI to v2, so labelling this AI work moved it behind a wall it was never on
the wrong side of — and that is the whole reason it is still unbuilt. It is division.

What has actually been missing is not a technique but an **input inventory**. The
required rate is not one number; it is three, each needing one more input than the
last, and the failure mode is stating a rung the inputs do not support:

| Rung | Arithmetic | Needs | Available |
|---|---|---|---|
| **1 · units/week** | `remainingUnits ÷ weeksLeft` | scope total + target date | **day one, zero data** |
| **2 · sessions/week** | rung 1 `× sessionsPerUnit` | \+ an effort figure per unit | prior at creation, or first checkpoint |
| **3 · hours/week** | rung 2 `× sessionMinutes ÷ 60` | \+ the time-box (always set) | wherever rung 2 is |

**Rung 1 always shows. Rung 2 shows only when a real `sessionsPerUnit` exists, and the
app never invents one** — that is D25's actual content, and the gap is stated in words
(*"how long a chapter takes isn't known yet"*), not filled with a plausible number.

Rung 2 is the one the user asked for, and it is wanted **at goal creation**, which is
precisely when no checkpoint exists. Measurement (D17, D57) arrives too late to help
choose a cadence. So `sessionsPerUnit` gets a second source: **an optional
user-supplied prior on the stage**, which D17 already sanctions in those words — *"an
optional rough upfront estimate may serve as a starting prior, superseded by
measurement as soon as enough data exists."* Measured always wins once it exists; the
prior is never blended with it and never retro-fitted.

That prior is the **one schema change in this decision**: a nullable
`stages.estimated_sessions_per_unit`. Additive under D51 (new nullable column on an
existing table), and it requires a change to the frozen `core/types.ts`, which is
proposed here rather than made (Phases.md). *If review would rather not touch the
frozen file, cutting the prior leaves rungs 1 and 3 intact and defers rung 2 to the
first checkpoint — a real product loss at exactly the moment the number is most useful,
and the reason for the recommendation.*

**Rung 2 names its source, and that is what carries the honesty.** Sourced from
measurement it is `requiredUnitsPerWeek × measuredPerUnit`, and on one checkpoint
`measuredPerUnit` is `doneSessions ÷ latestValue` at n = 1 — the same thin data D57
allows the projection to ship on, but arriving as a **point**, with none of the band
that made D57 defensible. D57 names this exact failure: a narrow render on thin data is
a real D25 violation.

Resolved by **attribution rather than a second uncertainty model**: the figure is always
stated with where it came from — *"at your estimate of 2 sessions/chapter"* against *"at
your measured 6.7, from 3 checkpoints"*. The reader can see how much to trust it, the
count is right there, and nothing is invented. Giving rung 2 its own widening band was
considered and rejected: it would be a second confidence mechanism, tuned by a second
coefficient, saying what the checkpoint count already says. **The band stays on the
projection, which is where a range means something — a finish date.** A rate is
attributed; a date is bracketed.

**Rung 2 is a comparison, never a verdict.** It reads *"your cadence gives 3 sessions a
week; this target needs 4.2"* and stops. It does not tell the user to change the
cadence, it never colours red, and when the target has become unreachable it says so
plainly and offers to reduce or extend — D15 verbatim. And it is stated about the
protocol, never the outcome (D3): *"behind on sessions"*, never *"behind on passing."*

**The target date is a goal-level date, and needs no column to become one.**
`stages.target_date` stays exactly where it is — moving it to `goals` is the reshape
D51 forbids, and D24 needs it per-stage anyway. Every v1 goal has one implicit stage
(D23), so for v1 the goal's date *is* that row. When multi-stage lands, the goal's date
is the **final stage's** authored date and every earlier stage's is derived backwards
from it, flagged by the `deadline_derived` column that already exists for this. What
changes now is only the UI: **target date is asked at the goal level, independently of
scope**, instead of sitting inside the scope block as a sub-field of "how many
chapters". A date with no scope yields *"14 weeks left"* and nothing more — no rung is
reachable, and the app says nothing further rather than manufacturing a line.

**D56 is untouched.** Its checkpoint gate is `scopeUnitTotal != null && targetDate !=
null`, which stays exactly right when a date can exist alone: a dateless, scopeless gym
goal is still asked nothing.

**One honesty defect this exposed, fixed in the same change.**
`ScopeStatus.requiredPerUnit` is not a requirement. It is
`sessionsAvailableInRange ÷ remainingUnits` — the sessions the *current cadence*
allows each unit, a budget ceiling. `pace-summary.tsx` renders it as *"N
sessions/chapter **to reach the target**"*, which reads as a bar to clear when it is a
budget not to exceed, and it is the D25 failure shape: a number stated with more
authority than its derivation carries. Renamed to `allowedSessionsPerUnit`, with the
rung-1 and rung-2 figures added alongside it. `ScopeStatus` lives in `core/pace.ts`,
not the frozen `core/types.ts`, so this rename is in bounds.

### D66 — The hierarchy axis is sequential phases. There is no third level, and subjects are not one

**Proposed. Settles the axis; builds nothing.**

Reported as *"GATE → subjects → chapters."* That is three levels, and it cannot be
built as three because **it mixes two different axes with a thing that is not an axis
at all**:

| Reported level | What it actually is | Where it already lives |
|---|---|---|
| syllabus → revision → tests | **sequential phases** — one active at a time | `stages` (D18, D23), deadlines derived backwards (D24) |
| subjects | **parallel divisions** — all live at once | nothing |
| chapters | **scope units** — a count, not a container | `scope_unit_label` / `scope_unit_total` (D28) |

Chapters are already modelled and are not a level: they are the number a checkpoint
reports (D13). Stages are already modelled and *are* the axis. Subjects are the only
genuinely new thing, and they are the one that must not be built.

**The axis is sequential phases (stages). A goal is a sequence of stages, each holding
a count. Nothing nests inside a stage.**

Why subjects are refused, in order of weight:

- **A subject level is per-item content tracking wearing a container.** D12 fixes a
  time-box regardless of contents and CLAUDE.md forbids ever asking what was inside a
  session. Per-subject progress means per-subject checkpoints, which means the coarse
  single question of D13 becomes eight questions a week.
- **Its only real payoff is scope-cut advice, which D27 declines.** Knowing you are
  behind on Algorithms specifically is actionable only as *"drop something"*, and D27
  states the size of the gap and stops — deliberately avoiding per-unit importance
  metadata *"entirely"*, in those words.
- **Parallel stages would silently break the sequence.** `sortOrder` plus
  `state: pending | active | done` encodes one-at-a-time, and D24's backwards
  derivation assumes a chain. Subjects-as-stages would be several `active` at once,
  which is a different data shape sharing a table.

**Two supported ways to express subjects, both already built:**

1. **One goal per subject**, when the subjects genuinely differ in protocol and the
   user wants them scheduled independently. This works and does not explode — D60's cap
   is keyed to `(date, daypart)`, so with `activeCap: 2` two subjects surface per
   daypart per day and the rest rotate in by staleness. The honest cost is *N entries
   in the goals list and no single scope number for the whole exam*, not breakage.
2. **Chapters as scope units across the whole goal**, which is the default and the
   cheaper answer: one number, one weekly question, one required line.

**Recorded because it will otherwise be rediscovered as a bug:** `layout.ts` filters
`stages.filter(s => s.state === "active")` and nothing anywhere enforces that a goal
has at most one active stage. The sequential semantics of D18/D23 are **recorded, not
enforced** — two active stages on one goal schedule in parallel today, quietly. Whoever
builds the multi-stage UI owns that invariant, and it belongs in `layoutWeek` or in the
stage-advance mutation, not in a form.

Multi-stage stays `[later]` (PRD §6.3). This decision does not promote it; it fixes the
shape it will have when it lands, so that the next person to read *"GATE → subjects →
chapters"* does not start over.

### D67 — Week start is a synced setting threaded through the core, and it is a layout input

**Proposed. Not yet built.**

`isoWeekStart` hardcodes Monday. Making it configurable is a small change that touches
one pure-core file and five callers — and it has one consequence that is not small.

**It forks the plan.** `plan_weeks.id` is `week-<weekStart>` (D58), and D45 makes the
week the atomic unit of plan sync. Two devices disagreeing about the week start
therefore produce **two differently-named week rows, neither of which loses a
last-write-wins race**, and each device reads its own via
`getPlanSlotsForWeek(isoWeekStart(today))`. The plan silently forks across devices and
D45's atomic-week guarantee is void. So:

- **The setting is per user and synced. It is never per device**, and there is no
  local-only variant of this field.
- **It must be registered as a layout input in D62's `applyPull`.** `inputsChanged` is
  currently `dayparts + goals + stages > 0`; `users` rows are applied on the line above
  and deliberately excluded from that count. A pulled week-start change would therefore
  re-key the week on device B *without* re-planning — Today reads the new id, finds
  nothing, and goes blank with nothing reported. That is the D62 bug shape exactly, and
  it is why "which table holds it" matters less than "the holder is counted." Adding
  `users` to the counter is loop-safe on D62's own test: `applyMutable` counts only
  rows it actually wrote, and relayout never writes `users`, so nothing it does can
  re-raise the flag.
- **Changing it locally re-lays out immediately**, the same as a daypart boundary edit
  (D44). Inputs changed; regenerate (D32).

**Home: a nullable `users.week_starts_on`.** A new nullable column on an existing table
is additive (D51); `users` is already synced, already LWW, already has exactly one row,
and week start is a user preference rather than a new entity. `Weekday` already exists
in the frozen `core/types.ts`, so **this item needs no change to the frozen file.**

**Default: Monday, changed explicitly in settings** — `null` means Monday. The ask was
*"default to the day the user first opened the app"*, and it is declined for a concrete
reason rather than a stylistic one: **there is no race-free way to seed a user-scoped
default on an offline-first second device.** `seedIfEmpty` runs on first paint, before
any pull can arrive, and writes `local-user` through `putUser`, which enqueues. So the
Android device seeds *its* first-open weekday, wins LWW on the shared row by virtue of
being later, and silently re-cuts the week on the desktop — the exact fork this decision
exists to prevent, arriving through the door marked "convenience". A guessed default
that can move on its own is worse than a boring one the user picks once. Monday is one
tap from anything else, and D41's two devices make this a live case, not a hypothetical.

**Threading.** `isoWeekStart(date, weekStartsOn)` takes the day as a **required**
parameter, not one defaulting to `"mon"` — a default would let call sites go unconverted
and compile. Six call sites: `core/pace.ts` (`cadenceStatus`), `features/plan/planner.ts`
×2, `db/local/queries.ts` (`getDaypartCapacity` — D60 added this one, and it is why the
list is longer than it was when this was first scoped), `features/checkin/lib.ts` ×2.
`core/score.ts` is already clean: it takes `windowStart`/`windowEnd` as parameters, so
**`pace.ts` is the only file inside `core/` that gains an argument** and D42's purity is
untouched — this is a parameter, not a clock read.

Three costs, all accepted and all one-time:

- **The cadence window shifts under the user once.** *"4×/week, you've done 2"* is
  recomputed against different boundaries, so a session logged last Sunday may move into
  or out of "this week". That is a recompute reported calmly (D15), not a fault, and it
  never touches a logged fact.
- **The remaining week reshuffles once.** `layoutWeek` filters `existing` by
  `slot.weekStart === weekStart`, so after a boundary change nothing is retained and
  D32's churn preference has nothing to prefer. Unavoidable: the old placements belong
  to a week that no longer exists.
- **The old `plan_weeks` row is orphaned and stays.** Nothing derives its id any more,
  so it is unreadable rather than wrong. It is deliberately not deleted: `applyDelete`
  acks `planWeeks` without acting — the plan is replaced wholesale, never deleted
  piecemeal (D45) — so a delete path would be a change to the atomic-week model to
  reclaim one row. Left inert.

---

### D68 — A one-off task is a time-box for one daypart, not a to-do item

**Built.** Requested directly: *"add any task right on today's page, and it might be an
independent task not related to any goal… done logs it, skipped goes to missed."*

**This runs at PRD §1**, which says the app is *"explicitly not built for… task
management. This is not a to-do app, and a to-do list is not a degraded version of it."*
That line is not repealed, and the feature is shaped so it stays true. What makes a
to-do list a different product is not that items exist — it is that they **persist**:
they carry a due date, they get re-prioritised, and an unfinished one rolls to tomorrow
and accumulates. This app's entire spine is the opposite (D20: *"missed sessions die and
get recorded; catch-up is voluntary, never imposed as debt"*).

So a task here is a **session that belongs to no goal**:

- It is anchored to `(date, daypartId)` exactly like a `PlanSlot`.
- It carries a fixed time-box exactly like a `Stage` (D12).
- It is answered **Done** or **Skipped** exactly like a session, and neither is a
  verdict (D15).
- **When its daypart ends unanswered, it is missed and it dies there.** It does not
  reappear tomorrow. That is the same rule `missedForWeek` already applied to slots,
  reused rather than re-derived.
- There is no priority, no due date, no project, no ordering, no re-schedule.

Strip any one of those and it becomes the thing PRD §1 refuses. Keep them and it is the
existing model with a title instead of a goal.

**A new `tasks` table, not a goal + stage.** Modelling a task as a one-cadence goal was
the cheap route and it is wrong twice over: it would consume the daypart's `activeCap`
(D60), and it would appear in the goals list, the capacity counts and the "On track"
summary — a passport renewal reported as a pursuit with a pace. `SessionLog.stageId` is
also non-null in the frozen `core/types.ts`, so a task cannot borrow the log table
either. A new table is purely additive (D51).

**`Task` is added to `core/types.ts`, which is otherwise frozen.** Nothing existing
changed, and **nothing in `core/` reads it** — the scheduler never sees a task, so D42's
purity and D34's determinism are untouched. It lives there because that file is the
shared domain contract the Dexie mirror, the Drizzle schema and the sync wire types all
map to; three private copies would be three chances to drift.

**Mutable, not append-only.** A task is created pending and rewritten once when it is
answered, so it is LWW on `updatedAt` with a `deletedAt` tombstone — not a union like
`session_logs`. This is the honest classification: a log is a fact the moment it exists;
a task is a small piece of state with two possible endings.

**Done tasks count against stated time.** `spentMinutes` on Today now sums done sessions
*and* done tasks. Tasks never enter the knapsack — `reconcile.ts` is untouched and
`relayoutWeek` is deliberately **not** called after answering one, since a task was never
in the plan — but they consume real minutes, and *"1h stated · 1h left"* immediately
after a 20-minute task would be the app lying about arithmetic it exists to get right.

**Consequences worth knowing:**

- `MissedOccurrence` is now a discriminated union on `source: "session" | "task"`. The
  discriminant is load-bearing: `/missed` looks a session's name up through
  `stageId → goalId`, and a task has no stage, so an unconditional lookup rendered every
  task as *"Deleted goal"*.
- The Dexie mirror gains a **`version(2)`** block. Editing `version(1)` in place would
  not create the object store on a device that already opened v1 — i.e. on exactly the
  installed PWAs this app is for.
- Tasks are pruned by `pruneHistoryBefore` alongside logs and check-ins, so the pull is
  floored on them too (`historyFloor`). Prune without the floor and every sync drags the
  whole history back down.
- **A future history view must union `tasks` with `session_logs`.** The task row is its
  own record of what happened; there is no log written for it.
- **There is deliberately no delete.** A mistyped task is answered *Skipped*, which is
  the same neutral outcome everything else in this app gets.

---

### D69 — The sync indicator spins while syncing and explains itself on demand

**Supersedes** `design.md` §6.3's "sync status changes — cross-fade only", and the
comment in `sync-status.tsx` that kept the `syncing` icon deliberately still. User's
call, and the reason it was wrong is specific rather than a change of taste.

**Why the old rule failed.** `syncing` and `pending` render in the same amber at 16px in
the nav bar — an arc and a dot. Held still, they are indistinguishable in practice, so
the indicator was reporting five states in a vocabulary the user couldn't read. Rotation
on `syncing` isn't emphasis; it is what makes "working on it" and "queued" different
things on screen. It also self-terminates: the spinner exists exactly as long as a flush
is in flight, so it can't become ambient noise the way a pulsing dot would.

This does not reopen §6.1's ban. **Looping shimmer, pulsing dots and parallax stay
banned** — they loop with nothing behind them, purely to attract the eye. The spinner
loops because a real operation is running. Same D61 constraints hold: CSS-declarative
(`animate-spin`), `transform` only, no JS driving it, and the global
`prefers-reduced-motion` collapse in `globals.css` handles it with no special case (a
single 0.01ms iteration of a 0→360° rotation lands back at rest).

**The popover.** The indicator gains a disclosure — hover, focus or tap — that says in
plain words which state is showing, what the amber dot and its number mean, and, for
every state, that nothing needs doing. `lastPullAt` finally has a reader: "last checked
the server 4m ago".

**This is not a sync button, and D46 is intact.** The trigger reveals an explanation and
touches nothing: no fill, no press state, no code path into the engine. D46 forbids
*acting* on sync, not *understanding* it — and an always-visible status the user can't
decode was only half-keeping the decision. The clock read lives inside the popup, which
mounts on open, so a relative time can't cause a hydration mismatch.

**The `aria-live` region is deliberately gone.** It never actually announced — it sat on
a div whose accessible name came from `aria-label`, which screen readers don't reliably
re-announce. Making it work would have meant speaking every `syncing → pending →
syncing` transition of a retry loop out loud, which is D46's "never pull attention" lost
on a different channel. The state is on the trigger's label for anyone who focuses it,
and in the popover in full for anyone who asks. Available, never announced.

`offline` also stops using the full-signal wifi glyph. At 16px, wifi bars read as
*connected*; the crossed-out signal (`WifiOff`) reads as the state it actually is.

---

### D70 — A task can attach to a goal; the log only ever gains a reference, never content

**Built.** Extends D68. Requested directly: a goal's session card gets an optional
task field; typing a title and tapping Done attaches that task to the goal; leaving
it empty behaves exactly as before; "Add a task" gains an optional goal picker.

**The D12 tension, and why this doesn't amend it.** An early framing of this request
(storing the typed text as content directly on the session log) would have reversed
D12 outright — "never ask what was inside a session" — and was rejected in discussion
before any code was written. What shipped instead: `SessionLog` gains `taskId: string
| null`, a **reference**, structurally identical to the `stageId`/`daypartId` it
already carries. The title itself lives on its own `Task` row (a legitimate object per
D68), never on the log. **D12 stands exactly as written** — the log still records only
status/minutes/date/who, never content. No amendment needed; this decision exists
because it's a real schema change to a frozen file and to sync, not because anything
was reversed.

**`Task.stageId: string | null`** — attachment is by stage, not goal, matching
`SessionLog`/`Checkpoint` everywhere else in this schema; a goal is reached through
its stage, and D19b makes one stage the ordinary case. `null` is the exact D68 stray
task, unchanged.

**Marking a stage-linked task Done also writes a paired voluntary session log**
(`setTaskStatus`, `db/local/mutations.ts`) — so an attached task actually counts
toward that goal's cadence/pace, the same credit a manually-logged catch-up session
gets (D20), rather than only toward the task's own history. The log's `minutes` is
**the task's own stated duration**, credited as-is — reversed from this decision's
first draft, which fixed it to the stage's `sessionMinutes` on a literal reading of
D12 ("time-boxes, not contents… fixed regardless of actual content"). Live use showed
that reading conflated two different things: D12 fixes the box of a *planned session*
so its length can't be renegotiated by *what happened inside it*; a voluntary task the
user explicitly time-boxed themselves is the user stating their own duration, not
content describing a fixed box. Crediting anything other than what they said they
spent is the actual violation of the spirit here. **Marking it Skipped does not write
a log** — matching the fact that a voluntary session has no "skip" concept today:
nothing was scheduled here to skip, so there's nothing to record as missed.

**Known limitation, named rather than engineered around.** Unlike the voluntary
catch-up section on Today, which is gated on `maxPerWeek`/`minRestDays` *before* a
candidate ever renders, a task attached to a goal has no such gate at creation. Several
tasks attached to one goal, all marked Done, can produce more voluntary logs in a week
than `maxPerWeek` would otherwise allow. Not fixed in this pass.

**Goal detail's Session history interleaves, rather than a separate section.** A
`"done"` attached task always has a paired log by construction above — that log is
what renders, with the task's title shown inline via the `taskId` lookup. Only a
`"skipped"` attached task has no log at all, so it's the one case rendered as its own
row, merge-sorted into the same list by date (`historyPage`,
`features/goals/goal-detail/lib.ts`). Simplified from the original two-cursor
merge-pagination sketch: a single goal's attached tasks are read once, bounded
(`getTasksForStage`, capped at 200) rather than kept paginated in lockstep with the
growing `session_logs` stream — D47's concern is a table that grows without bound
overall, and one goal's own attached tasks don't.

**Schema, additive throughout (D51):** `core/types.ts` gains the two nullable fields
above; Dexie gets a third version block (`version(3)`, widening `tasks`' indexes to
`[stageId+date]` — never edit a shipped version block, same reason as D68's
`version(2)`); Postgres gets migration `0004_goal_attached_tasks.sql` (two nullable
FK columns, `session_logs.task_id` → `tasks.id` and `tasks.stage_id` → `stages.id`,
no cascade on either — nothing hard-deletes a task or a stage today, so this is the
same dormant-path convention the rest of the schema already uses). **Not applied to
Supabase** — left for the user, same as `0003` was.

---

## Open questions

- ~~O1 — Planning horizon~~ → resolved by **D16**.
- ~~O2 — Backlog promotion~~ → resolved by **D31** (manual, capacity always visible).
- **O3 — Data entry** (largely addressed by D12/D13/D17). Confirmed principle: the
  user should never face a blank form; logging is confirming a prompt the app already
  made.
- ~~O4 — Rescheduling scope~~ → resolved by **D20**.
- ~~O5 — Short slots~~ → resolved by **D27**.
- ~~O6 — Tech stack~~ → resolved by **D38**.
- ~~O13 — Phone OS~~ → resolved by **D41**: Windows + Android only, both Chrome.
- ~~O7 — Ballast vs exhaustion~~ → dissolved by **D22**; there is no ballast.
- ~~O8 — Cold start~~ → resolved by **D25**.
- ~~O9 — Stage transitions~~ → resolved by **D27**.
- ~~O10 — Scope cutting~~ → resolved by **D27**.
- ~~O11 — Stage deadline hardness~~ → resolved by **D30** (advisory).
- ~~O12 — v1 scope~~ → resolved: Option B (D28). Detailed in `Phases.md`.
- **O14 — Real access control for `/api/sync`.** D59 ships a bundle-readable key that
  deters scanners and nothing else. The dataset is one URL away from anyone who looks.
  Open until either a device passphrase or real auth lands; revisit before the app
  holds anything the author would mind a stranger reading or overwriting.
