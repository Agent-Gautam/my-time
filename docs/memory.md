# my-time — Memory

Working state across sessions. **Update at the end of every session** — this is the
handoff, and with parallel tracks running it is the only shared view of progress.

**Conflict rule:** append under **your own track heading only**. Do not rewrite other
tracks' sections.

---

## Where things stand

**Phase:** Wave 0 complete → Wave 1's four tracks are unblocked.
**Live:** https://my-time-nu-brown.vercel.app (auto-deploys from `main`).
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

**Wave 1** — four tracks (A scheduler, B data layer, C design system, D shell/PWA/push)
can now start in parallel, each in its own `git worktree` per `Phases.md`'s conflict
rules. Track A (the scheduler) is the one to give the most capable session.

---

## Track log

### Wave 0 — Foundation
**Done.**

- `create-next-app` (TS, App Router, Tailwind v4, ESLint, `src/`) + `shadcn/ui init`
  (style `base-nova`, first component `button.tsx`).
- GitHub repo: https://github.com/Agent-Gautam/my-time (public). Vercel project
  `gautam-anands-projects/my-time` linked to it; `main` auto-deploys to
  https://my-time-nu-brown.vercel.app (verified 200).
- Supabase project `my-time` (ref `xpczvrctuvaoqrpayfge`, org "Personal", region
  `ap-south-1`). Pooler connection string in `.env.local` (gitignored); required env
  vars documented in `.env.example` (`DATABASE_URL`, VAPID keypair, `CRON_SECRET`).
- Installed the full stack from `Architecture.md` §3: `drizzle-orm` + `postgres` +
  `drizzle-kit`, `dexie` + `dexie-react-hooks`, `@serwist/next` + `serwist`, `web-push`,
  `vitest`. `package.json` should not need touching again outside Wave 1 tracks adding
  their own deps.
- `src/core/types.ts` written and frozen — `Goal`, `Stage`, `Daypart`, `SessionLog`,
  `Checkpoint`, `PlanSlot`, `CheckIn` per `Architecture.md` §5. Types only.
- ESLint (`eslint.config.mjs`) enforces both CLAUDE.md invariants via
  `no-restricted-imports`/`no-restricted-syntax`: `src/core/**` can't import `db/`,
  `app/`, `sync/`, or `react`; `src/app/**` + `src/features/**` (excluding
  `app/api/**`) can't import `db/server/` or call `fetch`.
- `npm run` scripts match `CLAUDE.md` exactly, plus `start` (Next.js prod runtime).
  `db:generate`/`db:migrate` are wired to `drizzle.config.ts` but won't resolve until
  Track B adds `src/db/server/schema.ts` — expected, not a bug.
- GitHub Actions CI (`.github/workflows/ci.yml`) runs lint + test on push/PR.

**Gotchas hit along the way:**

- **A second session was drafting `docs/design.md` in this same checkout at the same
  time**, against `Phases.md`'s "Wave 0 runs alone" rule. Its `git add -A` swept up
  this session's in-progress scaffold into one tangled commit. No content was lost, but
  the history was split back into three clean commits before the first push (design.md
  · scaffold+types+ESLint · Drizzle/CI/env wiring) since nothing had been pushed yet.
  If running sessions in parallel, use `git worktree` from the start, per `Phases.md`.
- **Supabase pooler hostname isn't `aws-0-<region>`** — for this project it's
  `aws-1-ap-south-1.pooler.supabase.com:6543`. Don't assume the node number; verify
  with a live connection before writing it down.
- **`supabase orgs list` didn't show the "Personal" org on the first call** — a second
  call surfaced it. If the org you expect is missing, re-list before picking a
  different one.

### Track A — Scheduler (`core/`)
*not started*

### Track B — Data layer (`db/`, `drizzle/`)
*not started*

### Track C — Design system
**Done.** Built in `../my-time-design` on `track/design`.

- **D52 mechanism:** every colour lives in `src/app/theme.css` as two blocks —
  `:root, .theme-light { ... }` and `.theme-dark { ... }` — each just the token
  table from `design.md` §2/§2.3 as hex values, nothing else. Adding a theme means
  adding a third `.theme-<name>` block there; nothing else changes. `src/app/globals.css`
  holds the Tailwind wiring (`@theme inline`) that maps both the app's semantic
  tokens (`bg`, `surface`, `accent-text`, `on-track`, ...) and every shadcn slot
  (`--primary`, `--muted`, `--destructive`, ...) onto those same variables via
  `var()` — every value in that block is a reference, never a literal, so shadcn
  primitives theme themselves with zero per-component work.
- **Lint:** `eslint.config.mjs` gained a `noRawColour` block (same shape as the
  two invariant guards) scanning `src/app/**`, `src/features/**`,
  `src/components/**` for hex literals, `rgb()/hsl()/oklch()/...`, raw Tailwind
  palette utilities (`bg-slate-800`), and raw `bg-black`/`text-white`. Caught two
  real violations in the shadcn-generated `dialog.tsx`/`sheet.tsx` (`bg-black/10`
  scrim) — added a `--scrim` token rather than leaving them as an exception.
- **Theme switching:** mode (`light`/`dark`/`auto`) resolved before first paint by
  an inline `<script>` in `layout.tsx`'s `<head>` (no import — must run with zero
  bundle dependency), applying a `theme-{light,dark}` class to `<html>`.
  `src/lib/theme.ts` holds the same resolution logic for client-side use (via
  `useSyncExternalStore`, not effect+setState — the repo's `react-hooks/set-state-in-effect`
  lint rule rejects the naive version) plus a stub `resolveAutoTheme` that takes an
  optional daypart list and falls back to `prefers-color-scheme` — real daypart
  boundaries aren't wired up yet (Track A/B own that shape); whoever wires them
  just needs to pass a `{ name, startTime, endTime }` array in.
- **Two easy-to-violate rules from `design.md` both caught mid-build:** shadcn's
  generated `dialog.tsx`/`sheet.tsx` used `backdrop-blur-xs` on their overlays —
  removed (no backdrop-filter, D-motion rule). The generated `skeleton.tsx` used
  `animate-pulse`, which is an infinite loop — design.md §6.1 bans that outright
  ("nothing infinite... no looping shimmer, no pulsing dots"); made it a static
  fill instead. Worth re-checking any *future* `npx shadcn add` output against
  both rules before merging — the generator doesn't know about either.
- Installed in one pass (package.json is frozen after Wave 0): input, label,
  textarea, select, checkbox, radio-group, switch, card, dialog, sheet, badge,
  separator, tabs, tooltip, dropdown-menu, sonner, skeleton — alongside the
  existing button. Removed `next-themes`, which the shadcn CLI pulled in as a
  transitive dep of the `sonner` component; rewired `sonner.tsx` to use our own
  `useThemeMode()` hook instead (D50 — didn't ask before it landed, so it came
  back out rather than staying an unapproved dependency).
- Inter via `next/font/google` (self-hosted, no runtime request), tabular
  numerals as a `.numeric` utility class, type scale as named Tailwind font-size
  tokens (`text-display` … `text-caption`) matching `design.md` §4.2 role names
  directly. Spacing needed no override — Tailwind v4's default 4px scale already
  matches §5's steps.
- `/styleguide` (`src/app/styleguide/`) renders every token, the type scale, the
  spacing scale, status colours, and every installed component, with a live
  light/dark/auto toggle at the top. `npm run lint`, `npm run build` both pass;
  checked manually in Chrome in both themes (dialog/sheet/toast/dropdown all
  interactive-tested).
- **Handoff to Track D:** layout.tsx is ready for the service-worker
  registration snippet — Track D should hand it over rather than editing
  `layout.tsx` directly, per the track split.

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
