import { defineConfig } from "vitest/config";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: [
      // md-editor-v3 has no "exports" map, so tests would load its CommonJS
      // build, which requires CodeMirror's CommonJS copies — a second
      // @codemirror/state next to the ESM one src/lib/editor.ts imports, and
      // an extension from one is rejected by the other. Its ESM entry is what
      // the app build uses ("module").
      { find: /^md-editor-v3$/, replacement: "md-editor-v3/lib/es/index.mjs" },
    ],
  },
  test: {
    environment: "jsdom",
    exclude: ["**/node_modules/**", "e2e/**"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,vue}"],
      exclude: [
        "src/**/*.test.ts",
        "src/**/*.d.ts",
        // App bootstrap: creates the Vue app, installs plugins and mounts into
        // #app. No logic of its own; exercised end-to-end by the Playwright suite.
        "src/main.ts",
      ],
      thresholds: {
        statements: 100,
        branches: 100,
        functions: 100,
        lines: 100,
      },
    },
  },
});
