// The dart-and-dartboard mark (D61), carried over from task-shot 2.0's loading
// animation and promoted to the app's icon. Two tones only: the board is
// `accent-fill`, the dart is `ink` — no red, per design.md §2.3. `ink` flips
// light-navy / dark-paper between themes, so the dart always reads against
// whichever board colour it's drawn on without any per-theme branching here.
//
// Geometry matches the generated app icons (public/icons/, favicon.ico) —
// changing these numbers means regenerating those too.
const RING_OUTER_R = 144;
const RING_OUTER_WIDTH = 48;
const RING_MID_R = 76;
const RING_MID_WIDTH = 40;
const BULL_R = 22;
const DART_TRANSFORM = "translate(256 256) scale(0.66) translate(-256 -256)";
const DART_FLIGHT = "M320 128 L320 192 L384 192 L448 128 L384 128 L384 64 Z";
const DART_TIP = "M313 173 L339 199 L290 248 L256 256 L264 222 Z";

/** The static mark — the loader's resting frame, usable anywhere on its own. */
export function DartMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 512 512" className={className} aria-hidden focusable="false">
      <g className="text-accent-fill" fill="none" stroke="currentColor">
        <circle cx="256" cy="256" r={RING_OUTER_R} strokeWidth={RING_OUTER_WIDTH} />
        <circle cx="256" cy="256" r={RING_MID_R} strokeWidth={RING_MID_WIDTH} />
        <circle cx="256" cy="256" r={BULL_R} fill="currentColor" stroke="none" />
      </g>
      <g className="text-ink" fill="currentColor" transform={DART_TRANSFORM}>
        <path d={DART_FLIGHT} />
        <path d={DART_TIP} />
      </g>
    </svg>
  );
}

/**
 * The throw, looping: bull, middle band, outer band, then the dart from the
 * top right, landing on the mark above. Infinite is permitted here under D61
 * — the animation is CSS-declarative on `opacity`/`transform` only, so it runs
 * on the compositor rather than the main thread, and it resolves into
 * `DartMark`'s own resting frame rather than becoming a generic spinner.
 * `prefers-reduced-motion` (globals.css) drops straight to that resting frame.
 */
export function DartLoader({ className }: { className?: string }) {
  return (
    <div role="status" aria-label="Loading" className={className}>
      <svg viewBox="0 0 512 512" className="size-full" aria-hidden focusable="false">
        <circle
          className="dart-loader__bull text-accent-fill"
          cx="256"
          cy="256"
          r={BULL_R}
          fill="currentColor"
        />
        <circle
          className="dart-loader__mid text-accent-fill"
          cx="256"
          cy="256"
          r={RING_MID_R}
          fill="none"
          stroke="currentColor"
          strokeWidth={RING_MID_WIDTH}
        />
        <circle
          className="dart-loader__outer text-accent-fill"
          cx="256"
          cy="256"
          r={RING_OUTER_R}
          fill="none"
          stroke="currentColor"
          strokeWidth={RING_OUTER_WIDTH}
        />
        <g
          className="dart-loader__dart text-ink"
          fill="currentColor"
          transform={DART_TRANSFORM}
        >
          <path d={DART_FLIGHT} />
          <path d={DART_TIP} />
        </g>
      </svg>
    </div>
  );
}
