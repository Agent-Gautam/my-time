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

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  corePurity,
  uiNeverTouchesNetwork,
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
