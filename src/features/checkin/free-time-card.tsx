// FreeTimeCard — shown on the Today page when the current wall-clock time doesn't
// fall inside any configured daypart (a gap between them).
//
// Shows an encouraging message and tells the user when their next daypart begins.

import { Button } from "@/components/ui/button";
import type { LocalDaypart } from "@/db/local/schema";

interface FreeTimeCardProps {
  nextDaypart: LocalDaypart | null;
  onBrowse: () => void;
}

const MESSAGES = [
  "You're free right now — enjoy the moment. ✨",
  "No plans, no pressure. Take a breath. 🌿",
  "This is your unscheduled time. Make it yours. 🌤️",
  "A quiet gap in the day. Rest or wander. 🍃",
  "Free time. The best kind. 🌸",
];

/** Stable pseudo-random message pick keyed by the hour so it doesn't flicker. */
function pickMessage(hour: number): string {
  return MESSAGES[hour % MESSAGES.length]!;
}

export function FreeTimeCard({ nextDaypart, onBrowse }: FreeTimeCardProps) {
  const hour = new Date().getHours();
  const message = pickMessage(hour);

  return (
    <div className="flex flex-col items-center gap-6 rounded-2xl border border-border bg-surface px-6 py-10 text-center shadow-sm">
      {/* Decorative orb */}
      <div
        aria-hidden
        className="flex size-20 items-center justify-center rounded-full text-4xl"
        style={{
          background:
            "radial-gradient(circle at 35% 35%, hsl(200 80% 70% / 0.25), hsl(260 60% 65% / 0.18))",
          boxShadow: "0 0 32px hsl(200 80% 60% / 0.15)",
        }}
      >
        🌿
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-title font-semibold text-ink">{message}</p>
        {nextDaypart ? (
          <p className="text-body text-text-muted">
            <span className="font-medium text-text">{nextDaypart.name}</span> starts at{" "}
            <span className="font-medium text-text">
              {formatTime(nextDaypart.startTime)}
            </span>
            .
          </p>
        ) : (
          <p className="text-body text-text-muted">No dayparts scheduled ahead.</p>
        )}
      </div>

      <Button
        variant="outline"
        size="sm"
        onClick={onBrowse}
        className="self-center"
      >
        Browse dayparts
      </Button>
    </div>
  );
}

/** Format "HH:mm" to a readable "9:00 AM" style. */
function formatTime(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const date = new Date();
  date.setHours(h!, m!, 0, 0);
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}
