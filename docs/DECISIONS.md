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
