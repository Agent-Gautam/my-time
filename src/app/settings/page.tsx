import { ThemeToggle } from "@/components/theme-toggle";
import { DaypartSettings } from "@/features/settings/daypart-settings";
import { NotificationSettings } from "@/features/settings/notification-settings";
import { StartToday } from "@/features/settings/start-today";

export default function SettingsPage() {
  return (
    <main className="flex flex-col gap-8 py-8">
      <div>
        <h1 className="text-title font-semibold text-ink">Settings</h1>
      </div>

      <section className="flex flex-col gap-4">
        <div>
          <h2 className="text-section font-semibold text-text">Theme</h2>
          <p className="text-body text-text-muted">
            Auto follows your own night daypart, not the OS clock.
          </p>
        </div>
        <ThemeToggle />
      </section>

      <section className="flex flex-col gap-4">
        <div>
          <h2 className="text-section font-semibold text-text">Dayparts</h2>
          <p className="text-body text-text-muted">
            Morning, afternoon, evening, night — your own boundaries, and how
            many active goals each can hold at once.
          </p>
        </div>
        <DaypartSettings />
      </section>

      <section className="flex flex-col gap-4">
        <div>
          <h2 className="text-section font-semibold text-text">Reminders</h2>
          <p className="text-body text-text-muted">
            A nudge at the start of each daypart. It only says it&rsquo;s time to
            check in &mdash; never what&rsquo;s in your plan.
          </p>
        </div>
        <NotificationSettings />
      </section>

      <section className="flex flex-col gap-4 border-t border-border pt-8">
        <div>
          <h2 className="text-section font-semibold text-text">Start Today</h2>
        </div>
        <StartToday />
      </section>
    </main>
  );
}
