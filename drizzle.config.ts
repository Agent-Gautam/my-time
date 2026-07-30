import { defineConfig } from "drizzle-kit";

// drizzle-kit is not Next.js, so it does not read `.env.local` on its own.
// `process.loadEnvFile` is built into Node 20.12+ — no dependency needed (D50).
try {
  process.loadEnvFile(".env.local");
} catch {
  // Absent in CI and on Vercel, where DATABASE_URL is already in the environment.
}

export default defineConfig({
  schema: "./src/db/server/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
