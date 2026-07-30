import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Invariant 1 (CLAUDE.md): src/core/** is pure — no db/, app/, sync/, or react.
const corePurity = {
  files: ["src/core/**/*.{ts,tsx}"],
  rules: {
    "no-restricted-imports": [
      "error",
      {
        patterns: [
          {
            group: ["**/db", "**/db/**", "@/db", "@/db/**"],
            message: "src/core is pure: no importing from db/ (D34, D42).",
          },
          {
            group: ["**/app", "**/app/**", "@/app", "@/app/**"],
            message: "src/core is pure: no importing from app/ (D34, D42).",
          },
          {
            group: ["**/sync", "**/sync/**", "@/sync", "@/sync/**"],
            message: "src/core is pure: no importing from sync/ (D34, D42).",
          },
        ],
        paths: [
          { name: "react", message: "src/core is pure: no React (D34, D42)." },
        ],
      },
    ],
  },
};

// Invariant 2 (CLAUDE.md): the UI never touches the network — only sync/ and
// route handlers may import db/server/ or call fetch.
const uiNeverTouchesNetwork = {
  files: ["src/app/**/*.{ts,tsx}", "src/features/**/*.{ts,tsx}"],
  ignores: ["src/app/api/**/*.{ts,tsx}"],
  rules: {
    "no-restricted-imports": [
      "error",
      {
        patterns: [
          {
            group: ["**/db/server", "**/db/server/**", "@/db/server", "@/db/server/**"],
            message: "UI never touches the network: no importing db/server (D33, D42).",
          },
        ],
      },
    ],
    "no-restricted-syntax": [
      "error",
      {
        selector: "CallExpression[callee.name='fetch']",
        message: "UI never touches the network: no fetch — use sync/ or a route handler (D33, D42).",
      },
      {
        selector: "CallExpression[callee.property.name='fetch']",
        message: "UI never touches the network: no fetch — use sync/ or a route handler (D33, D42).",
      },
    ],
  },
};

// D52: themes are data, zero raw colour in components — semantic tokens only,
// enforced the same way as the two invariants above.
const HEX_COLOUR = "/#[0-9a-fA-F]{3,8}\\b/";
const COLOUR_FUNCTION = "/\\b(rgb|rgba|hsl|hsla|oklch|oklab|lab|lch)\\(/";
const TAILWIND_PALETTE_UTILITY =
  "/\\b(bg|text|border|ring|fill|stroke|from|via|to|decoration|outline|accent|caret|shadow|divide|placeholder)-(slate|gray|grey|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-(50|100|200|300|400|500|600|700|800|900|950)\\b/";
const TAILWIND_BW_UTILITY =
  "/\\b(bg|text|border|ring|fill|stroke|from|via|to|decoration|outline|accent|caret|shadow|divide|placeholder)-(black|white)\\b/";

const noRawColour = {
  files: [
    "src/app/**/*.{ts,tsx}",
    "src/features/**/*.{ts,tsx}",
    "src/components/**/*.{ts,tsx}",
  ],
  rules: {
    "no-restricted-syntax": [
      "error",
      {
        selector: `Literal[value=${HEX_COLOUR}]`,
        message: "No raw hex colour — add a semantic token to src/app/theme.css instead (D52).",
      },
      {
        selector: `TemplateElement[value.raw=${HEX_COLOUR}]`,
        message: "No raw hex colour — add a semantic token to src/app/theme.css instead (D52).",
      },
      {
        selector: `Literal[value=${COLOUR_FUNCTION}]`,
        message: "No raw colour functions (rgb/hsl/oklch/...) — add a semantic token to src/app/theme.css instead (D52).",
      },
      {
        selector: `TemplateElement[value.raw=${COLOUR_FUNCTION}]`,
        message: "No raw colour functions (rgb/hsl/oklch/...) — add a semantic token to src/app/theme.css instead (D52).",
      },
      {
        selector: `Literal[value=${TAILWIND_PALETTE_UTILITY}]`,
        message: "No raw Tailwind palette colours (e.g. bg-slate-800) — use a semantic token utility instead (D52).",
      },
      {
        selector: `TemplateElement[value.raw=${TAILWIND_PALETTE_UTILITY}]`,
        message: "No raw Tailwind palette colours (e.g. bg-slate-800) — use a semantic token utility instead (D52).",
      },
      {
        selector: `Literal[value=${TAILWIND_BW_UTILITY}]`,
        message: "No raw black/white utilities — use a semantic token utility instead (D52).",
      },
      {
        selector: `TemplateElement[value.raw=${TAILWIND_BW_UTILITY}]`,
        message: "No raw black/white utilities — use a semantic token utility instead (D52).",
      },
    ],
  },
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  corePurity,
  uiNeverTouchesNetwork,
  noRawColour,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
