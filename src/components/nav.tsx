"use client";

// The app's four surfaces. Bottom bar on mobile — the phone is the primary device
// and one-tap logging happens with a thumb — and a sticky top bar from `md` up.
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
        "border-border bg-surface fixed inset-x-0 bottom-0 z-40 border-t",
        "md:sticky md:top-0 md:bottom-auto md:border-t-0 md:border-b",
      )}
    >
      {/* Matches the content measure in layout.tsx so the bar lines up with the page. */}
      <ul className="mx-auto flex max-w-2xl items-stretch justify-around md:justify-start md:gap-1 md:px-4">
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
                  "md:min-h-11 md:flex-row md:gap-2",
                  active ? "text-accent-text font-medium" : "text-text-muted hover:text-text",
                )}
              >
                <Icon aria-hidden className="size-5 md:size-4" />
                {label}
              </Link>
            </li>
          );
        })}

        {/*
          Seam for the sync-status indicator (Wave 2d owns `components/sync-status.tsx`;
          the supervisor mounts it here at merge time). It is status, never an action —
          it must not become another <li> in this list of links (D46).
        */}
      </ul>
    </nav>
  );
}
