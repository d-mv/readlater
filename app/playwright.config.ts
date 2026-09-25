import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  reporter: "list",
  // A dedicated port (not Vite's default 5173) with --strictPort: reusing
  // "whatever answers on 5173" once ran the suite against another project's
  // dev server.
  use: {
    baseURL: "http://localhost:5183",
  },
  webServer: {
    command: "bunx vite --port 5183 --strictPort",
    url: "http://localhost:5183",
    reuseExistingServer: true,
  },
});
