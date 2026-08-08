# my-time

Personal planning app. Tell it your goals and how much time you have; it says what to do
now and whether you'll still make it. Solo user, built entirely with Claude Code.

**Stack:** Next.js (App Router) · Vercel · Supabase Postgres + Drizzle · Dexie/IndexedDB ·
Serwist PWA · Tailwind + shadcn/ui · Vitest. Targets Windows + Android, both Chrome.

## Docs

| File | Contents |
|---|---|
| `docs/PRD.md` | What to build. Features tagged `[v1]` / `[later]`. |
| `docs/Architecture.md` | Layers, schema, scheduler boundary, folder structure. |
| `docs/DECISIONS.md` | **Why.** 52 numbered decisions with reasoning. |
| `docs/Phases.md` | Build order. What's next. |
| `docs/memory.md` | Current state — **update at the end of every session.** |
| `docs/design.md` | Colours, type, spacing. |

Read `Architecture.md` before touching structure, and `DECISIONS.md` before arguing with
an existing choice — the reasoning is probably already there. **Cite `D-numbers`** in
commits and PRs when a change turns on a recorded decision.

If you're about to contradict a decision, don't silently do it. Say which `D-number` and
why, get agreement, then update `DECISIONS.md` in the same change.

---

## Two invariants — mechanically enforced, never bypass

**1. `src/core/**` is pure.**
No imports from `db/`, `app/`, `sync/`, or `react`. No `fetch`. **No reading the clock** —
time is always a parameter. This is what makes the scheduler deterministic and testable.
(D34, D42)

**2. The UI never touches the network.**
Client components may not call `fetch` and may not import `db/server/`. They read and
write Dexie only. Only `sync/` and route handlers talk to the server. This is what makes
offline the default path instead of a special case. (D33, D42)

Both are guarded by ESLint `no-restricted-imports` in CI. If a guard fires, the design is
being violated — fix the code, don't relax the rule.

## Never build these

Each of these has been explicitly decided against. They will look like helpful additions.
They are not.

- **Streaks, badges, gamification, anything red.** A miss recomputes a number and reports
  it calmly. Nothing punishes. (D15)
- **Any "you're behind on your outcome" message.** The user is accountable for showing
  up, never for the result. "Behind on gym sessions" — yes. "Behind on gaining 3kg" — never.
  (D3)
- **Confident projections without data.** Requirements are arithmetic and shown from day
  one. Predictions need measurement and ship as a **narrowing range**, never a point.
  Don't invent a number to fill a gap. (D25)
- **Nagging to fill free time.** Capacity is a ceiling, not a target. Show that a slot is
  free; never prompt the user to use it. (D21, D31)
- **Automatic carry-forward of missed sessions.** They die and get recorded. Catch-up is
  voluntary and credited, never imposed as debt. (D20)
- **A sync button.** Sync is automatic. Its *status* is always visible; it is never an
  action. (D46)
- **Per-item content tracking.** Time-boxes, not contents. No video lists, no question
  banks. Never ask what was inside a session. (D12)
- **Blank forms.** The app scheduled the work, so logging is confirming a prompt. (O3)
- **Scope-cut suggestions.** Report the size of the gap; never recommend what to drop.
  (D27)
- **AI anything, in v1.** Deferred to v2 behind a provider interface. (D39)

## Working rules

**Dependencies** — the stack above is the default, not a freeze. Suggest something better
whenever you have a real reason. **Ask before adding any dependency.** (D50)

**Schema** — model the full decided design, even where v1 leaves a table with one implicit
row. Deferred features are gated in the UI, not missing from the database. v2 must be
additive, not a migration. Migrations are explicit Drizzle files, reviewed and committed.
(D29)

**Performance is a requirement, not polish** (D47):
- Never `.toArray()` a growing table. Bounded, indexed Dexie queries only.
- Paginate or virtualise history and missed-session lists.
- Route-level code splitting; defer below-the-fold work.

**Scheduler** — all tunable coefficients live in one exported object in
`core/constants.ts`. They will be wrong at first; tuning must be a one-file change.

**Tests** — the pure core is what's worth testing. Any change to `layout`, `reconcile`,
`score` or `pace` needs unit tests. UI does not need tests.

**Scope** — do what was asked. No unrequested refactors, no files outside the structure in
`Architecture.md` §8, no speculative abstraction.

**Test data is borrowed, never left behind.** If a session creates data in the app to try
something out — a seeded goal or stage, a hand-made task, a session log, a checkpoint, a
check-in, a push subscription, a row poked in via the console or a script — **that session
removes it before it ends.** Not "the next session will notice"; it won't, and a fake goal
is indistinguishable from a real one a week later. Three specifics, because each has
already gone wrong or nearly has:

- **`dropGoal` is not removal.** It soft-deletes (D48), which is the right behaviour for
  the user's own data and the wrong one for yours — the row still syncs and still shows up
  in reads that don't filter state. Delete test rows outright:
  `localDb.goals.delete(id)` and the matching `stages` / `sessionLogs` / `checkpoints`.
- **Clean the server too.** Anything that reached Supabase via the outbox or an API route
  is still there after you clear IndexedDB. Delete it in the SQL editor, in FK order.
- **Say what you did in `docs/memory.md`.** One line — what you made, that it's gone. If
  something genuinely has to survive the session, name it there explicitly so the next
  session knows it is deliberate and can remove it.

Prefer a test over seeded data wherever the question can be answered by one — `tests/`
runs against `fake-indexeddb` (D55) and leaves nothing behind at all.

**Deploy** — `main` auto-deploys to production. It stays green. Work on branches; they get
preview URLs. (D40)

## Vocabulary

Use these words precisely; they're defined in `PRD.md` §5.

**Goal** — the thing being pursued. **Protocol** — what you do (cadence, box, when);
the only thing the user is accountable for. **Verdict** — what you hoped it produced,
tested on a review date; may be subjective. **Cycle** — one attempt at a goal, ending in a
verdict plus drop/continue/renew. **Stage** — the unit of scheduling; most goals have
exactly one. **Daypart** — morning/afternoon/evening/night, user-defined boundaries.
**Session** — one scheduled instance of a stage, fixed time-box. **Check-in** — user
arrives, states available time, plan reconciles.

## Commands

```bash
npm run dev            # local dev
npm run build          # production build
npm run test           # vitest
npm run lint           # eslint, incl. the two invariant guards
npm run db:generate    # drizzle: generate migration from schema
npm run db:migrate     # drizzle: apply migrations
```

## End of session

Update `docs/memory.md`: what got done, what's in progress, what's next. It's the handoff
to the next session — treat it as required, not optional.

## Token usage
No need to generate extra docs to explain what you have done, you can tell that in simple bullets.
