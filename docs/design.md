# my-time — Design

**Status:** draft for review. Implemented by Track C (`Phases.md`).

---

## 1. Intent

**Calm and relaxed.** The app exists to remove anxiety, so it must not manufacture
urgency. That rules out the visual language most productivity apps wear: high contrast,
red accents, badge counts, alarm states, anything that reads as a warning.

Closer to a reading app than a dashboard.

**Two things calm is not:**

- **Not low contrast.** Calm comes from space and restraint, not from washed-out text.
  The predecessor (`task-shot`) rendered tan text on cream, which is hard to read and
  therefore *stressful* — the opposite of the intent. Every token pair here is
  contrast-checked.
- **Not colourless.** Colour carries meaning (pace, status), it just carries it quietly.

## 2. Palette

Carried forward from `task-shot`: **warm amber/gold** as the accent, **cool navy/slate**
as the structural ground. That pairing is the visual identity and it stays.

What changes: surfaces become warm neutrals, amber is reserved for accent rather than
large fills, and text contrast meets WCAG AA.

### 2.1 Tokens

**Themes are data (D52).** Every colour in the app lives in **one file** as CSS
variables. A theme is a block of values; adding one is adding a block. Components use
semantic tokens only — **no hex, no `rgb()`, no `bg-slate-800`** — and this is
lint-enforced, because the requirement is that *someone who is not the author* can
reskin the app without reading component code.

Token names are semantic, never chromatic: `accent-text`, not `amber-600`. Renaming the
colour must never mean renaming the token.

| Token | Light | Dark | Use |
|---|---|---|---|
| `bg` | `#FAF7F1` | `#141A26` | Page ground — warm paper / deep navy |
| `surface` | `#FFFFFF` | `#1D283A` | Cards, sheets |
| `surface-2` | `#F1EBE0` | `#26334A` | Recessed areas, subtle fills |
| `border` | `#E3DACB` | `#33405A` | Hairlines, dividers |
| `text` | `#22262E` | `#EBE9E6` | Body — warm off-white in dark, never pure white |
| `text-muted` | `#5C6270` | `#A8B0BF` | Secondary text, labels |
| `text-subtle` | `#8A8F9A` | `#7A8494` | Tertiary — **large text only** |
| `ink` | `#2F455D` | `#EBE9E6` | Headings, strong structure |
| `accent-text` | `#96610F` | `#D2AE38` | Amber **as text** — contrast-safe |
| `accent-fill` | `#F0B429` | `#D7942A` | Amber **as background** — badges, active state |
| `accent-fg` | `#241A05` | `#141A26` | Text sitting on `accent-fill` |

### 2.2 The two-amber rule

**`accent-text` and `accent-fill` are not interchangeable.** This is the specific bug in
the predecessor and it is worth stating as a rule.

The pleasant amber (`#F0B429`) has roughly **2.0:1** contrast on light ground — fine as a
background, illegible as text. `accent-text` (`#96610F`) reaches **≈4.9:1** and is safe
for body copy.

So: **amber fills use `accent-fill`; amber words use `accent-text`.** Never swap them.

### 2.3 Status colours

Constrained by `CLAUDE.md` — a miss must not read as failure (D15).

| Token | Light | Dark | Meaning |
|---|---|---|---|
| `on-track` | `#3F7A63` | `#6FA88C` | Sage — meeting cadence, ahead of the line |
| `attention` | `#96610F` | `#D2AE38` | Amber — behind, rate has moved |
| `blocked` | `#A15843` | `#C67D64` | Muted clay — target no longer reachable |
| `neutral` | `#8A8F9A` | `#7A8494` | **Missed sessions.** Deliberately neutral. |

**No red anywhere in the app.** `blocked` is a desaturated clay — it reads as *attend to
this*, not as *you failed*. A missed session is grey, because it is information rather
than a verdict.

### 2.4 Priority is not a colour

Critical / normal / background (D10) are expressed through **typographic weight and
position**, not a third colour axis. Critical items may take `accent-text`; background
items sit in `text-muted`. Adding red/amber/green priority chips on top of the status
colours would make the interface shout, which defeats §1.

## 3. Theme switching

Three modes: **`light` · `dark` · `auto`**, selectable in settings.

**`auto` follows the user's own dayparts** rather than a hardcoded clock time. Daypart
boundaries are already user-defined (D7), so "dark during the night daypart" is free,
personal, and more correct than guessing at 6pm.

`prefers-color-scheme` is respected as the initial default before any preference is set.

**Implementation:** `class`-based dark mode with the theme resolved and applied **before
first paint** (inline script in `<head>`), so there is no flash of the wrong theme. Both
themes are first-class — dark is not a filter over light.

## 4. Typography

The predecessor set no font and inherited the system UI face. Choosing one:

**`Inter` variable, for everything.** Self-hosted via `next/font` — no external request,
so it works offline and doesn't violate the PWA model. Chosen because it holds up at
small sizes on cheap Android screens, which is the real constraint here.

If more character is wanted later, add a display face for headings only. That's a
one-token change; the workhorse stays.

### 4.1 Tabular numerals are mandatory

This app is full of changing numbers — minutes remaining, sessions done, required rate,
days left. Proportional digits make numbers **jitter as they update**, which reads as
instability.

```css
.numeric { font-variant-numeric: tabular-nums; }
```

Applied to every numeric display without exception. Non-negotiable, and easy to forget.

### 4.1.1 Durations have one format

**`lib/duration.ts` renders every length of time in the app.** Under an hour stays in
minutes (`45m`); an hour or more reads in hours (`1h 30m`), and a whole hour drops the
minutes entirely (`2h`, never `2h 0m`).

The rule exists because a quantity that renders as `150m` on one screen and `2h 30m` on
another reads as two different things. `2h 30m` is graspable at a glance; `150m` is
arithmetic, and this app exists to remove arithmetic.

Never inline `{minutes}m` in a component. Import `formatDuration`.

### 4.2 Scale

| Role | Size / weight | Notes |
|---|---|---|
| Display | 32px / 600 | The one big number per screen |
| Title | 22px / 600 | Screen headings |
| Section | 16px / 600 | Group labels |
| Body | 15px / 400 | Default — slightly larger than 14 for comfort |
| Label | 13px / 500 | Metadata, reasons |
| Caption | 12px / 400 | `text-subtle` only, never critical information |

Line height 1.5 for body, 1.25 for headings. Max measure ~68 characters on desktop —
full-width text is tiring, and this is an app you read.

## 5. Space and layout

- **4px base scale.** Spacing steps: 4 · 8 · 12 · 16 · 24 · 32 · 48.
- **Generous whitespace.** This is where calm actually comes from. When in doubt, more
  space rather than more colour.
- **Mobile-first, single column.** Desktop gets a centred max-width, not a wider grid —
  the content is a list, and sprawling it is worse.
- **Touch targets ≥ 44px.** The primary interaction is one-tap logging on a phone.
- **Radius:** 10px cards, 8px controls, 999px pills. Soft, not pill-everything.
- **Elevation:** one small shadow for cards, one larger for sheets. That's it. No
  layered-shadow depth system.

## 6. Motion

Subtle, and it **must hold 60fps on a budget Android phone**. That constraint decides
most of what follows.

### 6.1 Hard rules

- **Animate `transform` and `opacity` only.** Never `width`, `height`, `top`, `left`,
  `margin` or `padding` — those trigger layout every frame and are exactly what makes
  cheap phones stutter.
- **No `backdrop-filter`, no large blurs.** The single biggest source of jank on budget
  Android GPUs. (The predecessor's soft blurred card is precisely this trap.)
- **Respect `prefers-reduced-motion`** — reduce to opacity, or remove entirely.
- **Infinite is allowed only when it's CSS-declarative and compositor-only** — a
  `@keyframes` animation on `opacity`/`transform` alone, with no JS driving it (D61).
  It costs nothing on a budget phone's main thread, which is what "nothing infinite"
  was actually protecting against. **Looping shimmer, pulsing dots, and parallax stay
  banned** — not because they loop, but because they're built to pull attention (§1),
  which is a separate reason and the one doing the real work here.
- **CSS transitions by default.** A motion library only if something genuinely needs
  orchestration, and it needs asking first (D50).
- **A handful of concurrent animations, not a cascade.** Stagger lists at most 3 items.

### 6.2 Durations

| Kind | Duration | Easing |
|---|---|---|
| Micro — tap, toggle, check | 120–160ms | `ease-out` |
| Entrance — card, list item | 200–260ms | `ease-out` |
| Sheet / route transition | 260–300ms | `ease-in-out` |

Nothing exceeds 300ms. Slow animation reads as a slow app.

This table is about **perceived latency** — a transition that takes longer than 300ms
reads as the app being slow to respond. A looping animation (D61) has no such moment; it
isn't answering an action, so the cap doesn't apply to it. Stated here so the loading
loop isn't read as a silent exception.

### 6.3 Where motion earns its place

- **The check-off.** The most repeated interaction in the app — worth a small, precise
  transform. Not a celebration; no confetti, which would contradict §1 and D15.
- **Sync status changes** — cross-fade between states, and **rotation on `syncing`
  alone** (D69). The spinner is legibility, not emphasis: `syncing` and `pending` are
  both small and both amber, and motion is the only thing that separates "working on
  it" from "queued". It stops by itself. Every other state stays still.
- **List settle after reconciliation.** Should be rare anyway, since layout minimises
  churn (D32).
- **Theme change** — brief cross-fade, so an automatic daypart switch isn't a jolt.
- **The loading mark.** The app's own infinite loop (D61) — a dart landing on a
  board, resolving into the app's own icon on its resting frame. Not a spinner.

Everything else: no animation is the correct amount.

## 7. Accessibility

- **WCAG AA:** 4.5:1 for body text, 3:1 for large text and UI boundaries. Every pair in
  §2 is checked; `text-subtle` is large-text-only for exactly this reason.
- **Never colour alone.** Status carries an icon or a word as well — pace states must be
  readable without distinguishing sage from amber.
- Visible focus rings, keyboard-reachable everything (this runs on Windows too).
- Respect `prefers-reduced-motion` (§6.1).

## 8. Open

- **Display face.** Inter throughout, or a warmer serif for the one big number per
  screen? Easy to try later; not worth blocking Track C.
- **`auto` theme boundary.** Does dark begin at the *night* daypart, or at *evening*?
  Depends on the user's actual boundaries.
