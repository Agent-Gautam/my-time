"use client";

// The app's four surfaces. Bottom bar on mobile — the phone is the primary device
// and one-tap logging happens with a thumb. From `md` up it's a floating dock,
// vertically centered against the left edge rather than a full-width bar: it wraps
// its four icons and never stretches to the page's height, so it reads as a tool
// floating over the content rather than a fixed piece of chrome bounding it.
// Touch targets are >= 44px (`design.md` §5).

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { CalendarCheck, ListChecks, Settings, Sun } from "lucide-react";

import { cn } from "@/lib/utils";
import { localNow } from "@/lib/daypart";
import { seedIfEmpty } from "@/db/local/seed";

const LINKS = [
  { href: "/", label: "Today", icon: Sun },
  { href: "/goals", label: "Goals", icon: ListChecks },
  { href: "/missed", label: "Missed", icon: CalendarCheck },
  { href: "/settings", label: "Settings", icon: Settings },
] as const;

export function Nav() {
  const pathname = usePathname();

  // First-run seeding lives here because it has to live somewhere client-side and
  // this is the only component mounted on every route: `layout.tsx` is a server
  // component and Dexie is browser-only. `seedIfEmpty` is idempotent, so mounting
  // repeatedly is free. If a later wave adds a real client boot module, move it.
  useEffect(() => {
    void seedIfEmpty(localNow());
  }, []);

  return (
    <nav
      aria-label="Main"
      className={cn(
        // Mobile: fixed, edge-to-edge bottom bar.
        "bg-surface border-border fixed inset-x-0 bottom-0 z-40 border-t",
        // Desktop: a floating dock, vertically centered against the left edge —
        // never sticky to the top, never full-height. `ring-1` + `shadow-md` is the
        // one elevated-surface treatment outside cards/sheets (design.md §5); a
        // dock permanently floating over content earns it more than a card does.
        // `group` + the children's `md:group-hover`/`md:group-focus-within` below
        // drive one shared expand — hovering (or tabbing into) anywhere on the dock
        // reveals every label at once, not just the icon under the pointer. `group`
        // itself carries no CSS (it's a bare marker for the descendant selectors),
        // so it can't be `md:`-prefixed — the responsive gating already lives on
        // every rule that reacts to it.
        "group md:inset-x-auto md:top-1/2 md:bottom-auto md:left-4 md:-translate-y-1/2",
        "md:border-t-0 md:rounded-2xl md:border md:p-1.5 md:shadow-md md:ring-1 md:ring-foreground/10",
      )}
    >
      {/* Matches the content measure in layout.tsx so the mobile bar lines up with
          the page; the desktop dock drops the measure and just wraps its icons. */}
      <ul className="mx-auto flex max-w-2xl items-stretch justify-around md:mx-0 md:max-w-none md:flex-col md:items-center md:justify-center md:gap-1">
        {LINKS.map(({ href, label, icon: Icon }) => {
          const active = href === "/" ? pathname === "/" : pathname.startsWith(href);

          return (
            <li key={href} className="flex-1 md:flex-none">
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-11 flex-col items-center justify-center gap-0.5 px-3 py-2",
                  "text-label focus-visible:ring-ring rounded-md transition-colors",
                  "focus-visible:ring-2 focus-visible:outline-none",
                  // Desktop: icon-first row, pinned to a fixed left edge so the icon
                  // never shifts as the row widens — only the label's room grows.
                  // `width` is otherwise off-limits (design.md §6.1 bans animating
                  // layout properties, for 60fps on a budget Android phone) but this
                  // transition only ever runs behind `md:group-hover`/`focus-within`,
                  // i.e. a mouse-hover affordance that never reaches a touch device.
                  "md:min-h-11 md:w-11 md:flex-none md:flex-row md:justify-start md:gap-3",
                  "md:rounded-xl md:px-2.75 md:py-0",
                  "md:w-11 md:transition-[width] md:duration-200 md:ease-out",
                  "md:group-hover:w-36 md:group-focus-within:w-36",
                  active
                    ? "text-accent-text font-medium md:bg-accent-fill/15"
                    : "text-text-muted hover:text-text",
                )}
              >
                <Icon aria-hidden className="size-5 shrink-0" />
                {/* Always in the DOM (so it has an accessible name at rest, no
                    tooltip needed) — on desktop it's clipped to nothing until the
                    dock expands, then fades and grows in step with the row. */}
                <span
                  className={cn(
                    "md:max-w-0 md:overflow-hidden md:opacity-0 md:whitespace-nowrap",
                    "md:transition-all md:duration-200 md:ease-out",
                    "md:group-hover:max-w-24 md:group-hover:opacity-100",
                    "md:group-focus-within:max-w-24 md:group-focus-within:opacity-100",
                  )}
                >
                  {label}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
