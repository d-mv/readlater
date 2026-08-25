# Audit Remediation Implementation Plan

> **Date:** August 25, 2026  
> **Status:** Complete ✅  
> **Reference:** [`docs/audit.md`](../audit.md) and [`docs/architecture.md`](../architecture.md)

---

## Overview

This plan outlines step-by-step remediation of all issues identified in the codebase audit across 5 phases. Each phase follows the Test-Driven Development (TDD) loop: write/update tests first, implement the fix, run tests, lint, and typecheck.

---

## Remediation Phases & Tasks

### Phase 1: Core Reliability & Logic Fixes
- [x] **1.1. Fix Offline Mode PostgREST Error Handling**
  - File: `app/src/stores/bookmarks.ts`
  - In `queryBookmarks()`, throw if Supabase returns an `error` so `fetch()` triggers its offline fallback. Only call `offlineDb.replaceBookmarksList` when fetch succeeds.
  - Test: `app/src/stores/bookmarks.test.ts`
- [x] **1.2. Fix Bare URL Root Domain Detection**
  - Files: `app/src/utils/captureText.ts`, `supabase/functions/capture/captureLogic.ts`
  - Ensure `isBareUrl("https://example.com")` correctly identifies bare root domains.
  - Tests: `app/src/utils/captureText.test.ts`, `supabase/functions/capture/captureLogic.test.ts`
- [x] **1.3. Fix Public Reader View for YouTube & PDF Embeds**
  - File: `app/src/views/PublicReaderView.vue`
  - Pass `:type`, `:youtube-video-id`, `:thumbnail-url` to `ArticleContent`.
  - Test: `app/src/views/PublicReaderView.test.ts`
- [x] **1.4. Preserve Reading Progress in Data Export & Import**
  - Files: `app/src/utils/dataTransfer.ts`, `app/src/stores/dataTransfer.ts`
  - Include `progress` in `ExportBookmark`, `toExportBookmark()`, and `importBookmarks()`.
  - Tests: `app/src/utils/dataTransfer.test.ts`, `app/src/stores/dataTransfer.test.ts`
- [x] **1.5. Fix PDF Domain/Type Formatting in List**
  - Files: `app/src/utils/format.ts`, `app/src/components/list/BookmarkRow.vue`
  - Format `type === 'pdf'` as `"PDF"` rather than defaulting to `"Note"`.
  - Tests: `app/src/utils/format.test.ts`, `app/src/components/list/BookmarkRow.test.ts`

### Phase 2: Frontend Performance & Bundle Optimization
- [x] **2.1. Async Lazy-Load `md-editor-v3` & Fix Vitest Teardown Exception**
  - Files: `app/src/components/reader/ArticleContent.vue`, `app/src/components/reader/ArticleContent.test.ts`
  - Dynamically load `MdEditor` only when editing is active via `defineAsyncComponent`.
  - Fix test environment cleanup so `@vavt/util` timers don't throw unhandled errors in jsdom.
  - Test: `bun run --cwd app test`
- [x] **2.2. Add Vite Preload Error Auto-Recovery**
  - File: `app/src/main.ts`
  - Register `vite:preloadError` listener to reload window automatically on stale chunk navigation.

### Phase 3: Worker & Edge Function Performance & Hardening
- [x] **3.1. Reuse Playwright Chromium Instance in Worker**
  - Files: `worker/src/browserRender.ts`, `worker/src/index.ts`
  - Launch browser once at worker boot or lazily reuse singleton instance; create new contexts/pages per job.
  - Tests: `worker/test/parseArticle.test.ts`
- [x] **3.2. Worker Polling Concurrency Guard & Stale Processing Recovery**
  - File: `worker/src/index.ts`
  - Prevent overlapping `pollOnce` cycles with `isPolling` flag.
  - Reset stale `processing` bookmarks older than 5 minutes back to `pending`.
- [x] **3.3. Worker Fetch Hardening (Timeout, Headers, Status)**
  - File: `worker/src/parseArticle.ts`
  - Add `AbortSignal.timeout(15_000)`, standard `User-Agent`, and check `res.ok`.
  - Tests: `worker/test/parseArticle.test.ts`
- [x] **3.4. Edge Functions Base64 Decoding Optimization**
  - Files: `supabase/functions/file-import/fileImportLogic.ts`, `supabase/functions/pdf-import/pdfImportLogic.ts`
  - Optimize `decodeBase64` implementation using `Uint8Array.from`.
  - Tests: `supabase/functions/file-import/fileImportLogic.test.ts`, `supabase/functions/pdf-import/pdfImportLogic.test.ts`

### Phase 4: Security, Dead Code & Dependency Cleanup
- [x] **4.1. Nginx Asset Configuration (404 on Missing Assets + Long-Term Caching)**
  - File: `app/nginx.conf`
  - Add `/assets/` block with `try_files $uri =404;` and immutable cache header.
- [x] **4.2. Clean Dead Code & Unused Dependencies**
  - Files: Root `package.json`, `worker/src/parseArticle.ts`, `app/src/lib/offlineDb.ts`, `app/src/utils/dataTransfer.ts`
  - Remove `mammoth` and `unpdf` from root `package.json`.
  - Clean up unused exports.
- [x] **4.3. Timing-Safe Auth Check in Capture Function**
  - File: `supabase/functions/capture/checkAuth.ts`
  - Enhance comparison with timing-safe XOR-based check.

### Phase 5: Documentation & Verification
- [x] **5.1. Update Architecture & Audit Documentation**
  - Files: `docs/architecture.md`, `docs/audit.md`, `docs/plans/2026-08-25-audit-remediation-plan.md`
- [x] **5.2. Run Full Test Suites, Linter, Typechecker & Build**
  - All test suites passing: 315/315 Vitest (app), 18/18 Bun (worker), 6/6 Bun (bookmarklet), 96/96 Deno (edge functions).
  - Clean `vue-tsc` typechecking with 0 errors.
