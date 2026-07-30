# my-time — Memory

Working state across sessions. **Update at the end of every session** — this is the
handoff, and with parallel tracks running it is the only shared view of progress.

**Conflict rule:** append under **your own track heading only**. Do not rewrite other
tracks' sections.

---

## Where things stand

**Phase:** planning complete → Wave 0 not yet started.
**Nothing is built.** The repo contains documentation only.
All six planning documents are done.

| Document | State |
|---|---|
| `docs/PRD.md` | ✅ signed off |
| `docs/Architecture.md` | ✅ drafted |
| `docs/DECISIONS.md` | ✅ 52 decisions, live — append as you go |
| `CLAUDE.md` | ✅ written (replaced the planned `rules.md`, D49) |
| `docs/Phases.md` | ✅ written |
| `docs/design.md` | ✅ drafted — Track C unblocked |
| `docs/memory.md` | ✅ this file |

## Next action

**Wave 0** (`Phases.md`), one session, alone. Scaffold + deploy + freeze shared contracts.
Everything else waits on it.

All four Wave 1 tracks are unblocked once Wave 0 lands.

---

## Track log

### Wave 0 — Foundation
*not started*

### Track A — Scheduler (`core/`)
*not started*

### Track B — Data layer (`db/`, `drizzle/`)
*not started*

### Track C — Design system
*not started — `docs/design.md` is written, so this is unblocked*

### Track D — Shell / PWA / push
*not started*

---

## Decisions still open

Tracked in `DECISIONS.md` under "Open questions". Currently outstanding:

- **First-run seeding** — seed sensible default daypart boundaries, or make the user set
  them? *(Leaning: seed defaults; boundaries are editable anyway.)*
- **Display face** — Inter throughout, or a warmer serif for the one big number per
  screen? Not blocking.
- **`auto` theme boundary** — does dark begin at the *night* daypart or at *evening*?
- **Scheduler coefficients** — deliberately unfixed. Tuned once the app is in real daily
  use; they live in `core/constants.ts` so tuning is a one-file change.

## Gotchas worth remembering

- **Vercel Hobby cron is unusable for reminders** — once per day, ±59 min. Verified.
  Scheduling goes through Supabase `pg_cron`. (D37)
- **The plan must sync.** Layout is deterministic but takes `existing` placements as an
  input, so it is path-dependent — two devices legitimately diverge. Synced atomically
  per week. (D45)
- **`core/` purity and the no-fetch-in-UI rule are ESLint-enforced.** A firing guard means
  the design is being violated; fix the code, not the rule. (D42)
- **Amber has two tokens.** `accent-fill` (~2:1) is background-only; `accent-text` is the
  contrast-safe one. Swapping them is the exact legibility bug the predecessor shipped.
  (`design.md` §2.2)
- **No `backdrop-filter` / large blurs.** Main cause of jank on budget Android.
  (`design.md` §6.1)
