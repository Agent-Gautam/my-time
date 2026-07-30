import { createSerwistRoute } from "@serwist/turbopack";

// Serves the compiled service worker and its precache manifest from
// /serwist/sw.js. The response carries `Service-Worker-Allowed: /`, so a worker
// served from this sub-path still controls the whole origin.
export const { dynamic, dynamicParams, revalidate, generateStaticParams, GET } =
  createSerwistRoute({
    swSrc: "src/sw.ts",
  });
