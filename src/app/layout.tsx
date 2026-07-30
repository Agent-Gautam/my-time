import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { SerwistProvider } from "@serwist/turbopack/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { THEME_STORAGE_KEY } from "@/lib/theme";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "my-time",
  description: "Tell it your goals and how much time you have.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "my-time" },
};

// The browser-chrome theme-color meta tag can't reference a CSS custom property,
// so these two values are a narrow, documented exception to D52 — keep them in
// sync with theme.css's --bg for .theme-light / .theme-dark by hand.
export const viewport: Viewport = {
  themeColor: [
    // eslint-disable-next-line no-restricted-syntax
    { media: "(prefers-color-scheme: light)", color: "#faf7f1" },
    // eslint-disable-next-line no-restricted-syntax
    { media: "(prefers-color-scheme: dark)", color: "#141a26" },
  ],
};

// Resolves light/dark before first paint so there is no flash. Mirrors
// lib/theme.ts's default (auto -> system preference) — it can't import that
// module directly since it must run synchronously with no bundle dependency.
const THEME_INIT_SCRIPT = `(function(){try{var KEY=${JSON.stringify(THEME_STORAGE_KEY)};var stored=localStorage.getItem(KEY);var mode=(stored==="light"||stored==="dark"||stored==="auto")?stored:"auto";var resolved=mode==="auto"?(window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"):mode;document.documentElement.classList.add("theme-"+resolved);}catch(e){document.documentElement.classList.add("theme-light");}})();`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col">
        <SerwistProvider
          swUrl="/serwist/sw.js"
          disable={process.env.NODE_ENV !== "production"}
        >
          <TooltipProvider>{children}</TooltipProvider>
          <Toaster />
        </SerwistProvider>
      </body>
    </html>
  );
}
