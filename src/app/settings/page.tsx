import { ThemeToggle } from "@/components/theme-toggle";
import { DaypartSettings } from "@/features/settings/daypart-settings";

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
    </main>
  );
}
