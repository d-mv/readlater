import { defineConfig, devices } from "@playwright/test";

import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "./e2e/supabaseEnv";

// A dedicated port (not Vite's default 5173) with --strictPort: reusing
// "whatever answers on 5173" once ran the suite against another project's
// dev server.
const PORT = 5183;

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
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "mobile",
      // A 390px phone (iPhone 12–15 width) on Chromium, so
      // `bunx playwright install chromium` is the only browser needed.
      use: {
        ...devices["Pixel 7"],
        viewport: { width: 390, height: 844 },
      },
    },
  ],
  webServer: {
    command: `bunx vite --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    // Never reuse: a dev server someone started by hand points at the real
    // project from app/.env, while the specs fake the one below.
    reuseExistingServer: false,
    // Process env beats app/.env in Vite, so the app under test always talks
    // to the fake backend's host (e2e/fakeBackend.ts).
    env: {
      VITE_SUPABASE_URL: SUPABASE_URL,
      VITE_SUPABASE_PUBLISHABLE_KEY: SUPABASE_PUBLISHABLE_KEY,
    },
  },
});
