import { defineConfig, devices } from "@playwright/test";

import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "./e2e/supabaseEnv";

// Dedicated ports (not Vite's defaults 5173/4173) with --strictPort: reusing
// "whatever answers on 5173" once ran the suite against another project's
// dev server.
const PORT = 5183;
const PREVIEW_PORT = 5184;

// The build the offline-sw project serves; gitignored, kept apart from the
// deployable dist/.
const PREVIEW_DIR = "dist-e2e";

// The service-worker spec needs a production build; everything else runs
// against the dev server.
const SERVICE_WORKER_SPEC = /offline-sw\.spec\.ts$/;

// Process env beats app/.env in Vite, so the app under test always talks to
// the fake backend's host (e2e/fakeBackend.ts).
const FAKE_SUPABASE_ENV = {
  VITE_SUPABASE_URL: SUPABASE_URL,
  VITE_SUPABASE_PUBLISHABLE_KEY: SUPABASE_PUBLISHABLE_KEY,
};

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  timeout: 30_000,
  expect: { timeout: 7_000 },
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "desktop",
      testIgnore: SERVICE_WORKER_SPEC,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "mobile",
      testIgnore: SERVICE_WORKER_SPEC,
      // A 390px phone (iPhone 12–15 width) on Chromium, so
      // `bunx playwright install chromium` is the only browser needed.
      use: {
        ...devices["Pixel 7"],
        viewport: { width: 390, height: 844 },
      },
    },
    {
      name: "offline-sw",
      testMatch: SERVICE_WORKER_SPEC,
      use: {
        ...devices["Desktop Chrome"],
        baseURL: `http://localhost:${PREVIEW_PORT}`,
        serviceWorkers: "allow",
      },
    },
  ],
  webServer: [
    {
      command: `bunx vite --port ${PORT} --strictPort`,
      url: `http://localhost:${PORT}`,
      // Never reuse: a dev server someone started by hand points at the real
      // project from app/.env, while the specs fake the one below.
      reuseExistingServer: false,
      env: FAKE_SUPABASE_ENV,
    },
    {
      // vite-plugin-pwa only emits and registers the service worker in a
      // build. ~5 s; no vue-tsc here, `bun run build` covers types.
      command:
        `bunx vite build --outDir ${PREVIEW_DIR} --emptyOutDir --logLevel warn && ` +
        `bunx vite preview --outDir ${PREVIEW_DIR} --port ${PREVIEW_PORT} --strictPort`,
      url: `http://localhost:${PREVIEW_PORT}`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: FAKE_SUPABASE_ENV,
    },
  ],
});
