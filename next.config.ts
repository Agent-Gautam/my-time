import type { NextConfig } from "next";
import { withSerwist } from "@serwist/turbopack";

// Next.js 16 runs Turbopack by default, and `@serwist/next` only injects a
// webpack config — the two are mutually exclusive and the build fails outright.
// `@serwist/turbopack` is the supported path: the worker is compiled by a route
// handler (src/app/serwist/[path]/route.ts) rather than a bundler plugin.
const nextConfig: NextConfig = {
  /* config options here */
};

export default withSerwist(nextConfig);
