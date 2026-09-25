# Read Later — plan

Open work, in one place. Consolidates the 2026-09-25 simplification audit, the
still-open items from the 2026-08-25 audit, the follow-ups left by the
YouTube-embed/editing and DB-traffic work, and the long-standing deferred
features. Current-state reference: [`architecture.md`](architecture.md).

Each item: **where** (file:line at `e18a989`), **problem**, **fix**, effort
(S/M/L). Line numbers drift — re-check before starting.

## Recommended order

1. [1.1](#11-flatten-migrations) — flatten migrations (housekeeping, unblocks a clean schema reference).
2. [2.1](#21-reading-position-lost-when-opening-from-the-list) and [2.2](#22-capture-shows-saved-when-nothing-was-saved) — small, user-visible bugs.
3. [2.3](#23-list-session-races-in-the-bookmarks-store) — the core store fix; also stops search results overwriting the offline list.
4. [2.4](#24-import-rows-are-cast-not-validated), [2.8](#28-shared-note-row-builder-for-edge-functions) — small and independent.
5. [7](#7-frontend-migrate-styling-to-tailwind-v4) — Tailwind v4 migration, after the 2.x fixes that touch the same components (2.5, 2.7).
6. Everything else by appetite.

**Cross-cutting pattern.** 2.1, 2.3, 2.5, 2.6, 2.7 and 2.9 are the same bug
shape: an async result is applied without checking it still belongs to the
current state. Same fix each time — capture a token (id / generation /
expected status) before the `await`, commit the result only if it still
matches.

---

## 1. Housekeeping

### 1.1 Flatten migrations

**Status:** repo side done (2026-09-25). Verified with a local `db reset`:
`pg_dump` of `public`, the publication column list, the replica identity,
the storage policies and the buckets are identical before and after.
**Remaining:** steps 2–3 below on the live project. They need
`bunx supabase login` first, and must happen before the next `db push`, or
the CLI will refuse because of the unknown remote versions.

`supabase/migrations/` has the flattened `20260825000001_initial_schema.sql`
plus three follow-ups from the DB-traffic work:

- `20260826120000_realtime_bookmarks_publication.sql` — adds `bookmarks` to
  `supabase_realtime` with an explicit column list; sets `REPLICA IDENTITY FULL`
  (its comment still justifies this — now wrong).
- `20260826120001_public_bookmark_projection.sql` — `get_public_bookmark`
  returns public-safe columns only.
- `20260827000000_fix_bookmarks_replica_identity.sql` — reverts FULL; uses
  covering unique index `bookmarks_replica_identity_idx (id, user_id)`.

**Fix.** Fold all three into `initial_schema.sql` in their *final* form
(publication column list, replica identity via the index — never FULL, the
projected `get_public_bookmark`), delete the three files.

**Live project** (`egkakmlkerlmsigoegoe`) already records these versions in
`supabase_migrations.schema_migrations`, so the schema must not be re-applied:

1. Confirm the live schema matches the folded file (`bunx supabase db diff --linked`
   should be empty after the change).
2. `bunx supabase migration repair --status reverted 20260826120000 20260826120001 20260827000000 --project-ref egkakmlkerlmsigoegoe`
3. `bunx supabase migration list --linked` — only `20260825000001` remaining, marked applied.

Risk: a fresh environment built from the flattened file must end with the same
publication/identity state — verify with `supabase db reset` locally. Effort S.

---

## 2. Correctness & simplification (2026-09-25 audit)

### 2.1 Reading position lost when opening from the list

**Status:** done (app 0.0.1). `ReaderView` keeps one `ProgressSession` per bookmark.

- **Where:** `app/src/views/ReaderView.vue:38-69`, `:330-331`.
- **Problem:** list rows have no body (`content_md === undefined`) until
  `fetchOne()`. The scroll container renders regardless, so the restore watch
  (keyed on id/status/container) fires during "Processing…", marks the id as
  restored with nothing to scroll, and never retries. The next scroll then
  overwrites the saved progress. Same on Realtime pending→ready. Also
  `lastWrittenProgress` / `pendingProgress` are module-level and would flush
  onto a different id if the view were reused.
- **Fix:** one `progressSession: { id; phase: "awaiting-body" | "tracking"; lastWritten; pending } | null`,
  created per id; restore and move to `tracking` only when `bodyLoaded`
  becomes true; flush writes `session.id`.
- **Tests:** seed a ready row without body and `progress: 0.5`, resolve
  `fetchOne`, assert `scrollTop` restored. Effort S.

### 2.2 Capture shows "Saved" when nothing was saved

**Status:** done (app 0.0.2). `add()` returns `AddBookmarkResult`; the views use `toCaptureOutcome()`.

- **Where:** `app/src/stores/bookmarks.ts:265-267`; `CaptureView.vue:43-53`,
  `ShareTargetView.vue:32-42`.
- **Problem:** the local duplicate check returns `{ error: null, duplicate: true }`
  with no `existingId`/`existingSavedAt`; both views then fall through to
  `finish()`. Three sidecar refs per view also allow `error` with a stale
  `duplicateId`.
- **Fix:** `add()` returns the existing row it already found locally. Both views
  use one `CaptureOutcome = working | saved | error{message} | duplicate{id, savedAt}`
  via a shared pure `toOutcome(result)`. Effort S.

### 2.3 List-session races in the bookmarks store

**Status:** done (app 0.0.3).

- **Where:** `app/src/stores/bookmarks.ts:126-229`.
- **Problem:** the list's meaning is re-derived from live `searchQuery` in four
  places; no async path checks it is still current.
  - `loadMore` in flight + a search → unfiltered rows appended to results, `hasMore = true`.
  - Search then quick clear → slower response wins; Realtime INSERTs and
    `loadMore` then operate on search hits.
  - `persistOfflineList()` runs after search fetches and Realtime events →
    the offline list becomes the search subset.
- **Fix:** `ListSession = recent{gen, cursor, hasMore} | search{gen, query} | offline{gen, query}`;
  commit a response only if `gen` matches; `loadMore` / Realtime INSERT /
  offline persist only in `recent`. Keep `hasMore` / `searchQuery` public
  (`ReadingListView.test.ts:144` writes `hasMore`). Effort M.

### 2.4 Import rows are cast, not validated

**Status:** done (app 0.0.4).

- **Where:** `app/src/utils/dataTransfer.ts:106-114`; `app/src/stores/dataTransfer.ts:61,81`.
- **Problem:** only `version` and `Array.isArray(bookmarks)` are checked. A row
  without `tags` throws *after* the bulk insert committed (tags lost, Import
  button stuck disabled); extra keys (`id`, `url_normalized`) fail the whole batch.
- **Fix:** per-row parser with the same field whitelist as `toExportBookmark`,
  `tags` defaulted to `[]`; malformed rows reported as skipped. Effort S.

### 2.5 Add dialog state

- **Where:** `app/src/components/list/AddBookmarkDialog.vue:12-38`, `:116-188`.
- **Problem:** `isOpen` / `error` / `submitting` / `duplicate` are independent.
  Close-and-reopen during a save: `submitting` stays true, the late result lands
  in the fresh form, and "Add anyway" calls `store.add("")` (reads the cleared `url`).
- **Also broken:** "Add anyway" (`confirmDuplicate`, `:175-188`) calls
  `store.add(url, { force: true })`. `force` only skips the *local* check; the
  insert then hits `bookmarks_url_normalized_uniq`, `add()` returns
  `{ error: null, duplicate: true, … }`, and the dialog closes — nothing saved,
  nothing refreshed. It should call `store.refresh(existingId)` like the
  capture/share-target prompts (or the prompt should say "already saved" and
  offer "open").
- **Fix:** `Phase = closed | editing{error} | submitting | confirmDuplicate{existingId, submitting}`
  plus an epoch bumped on open/cancel; one `runSubmit(fn)`. Effort S–M.

### 2.6 Offline cache has no in-flight state

- **Where:** `app/src/stores/offlineCache.ts:18-69`; `bookmarks.ts:546-552`.
- **Problem:** archive right after open → delete runs before the pending put,
  offline copy resurrected. Double-tap "Save offline" downloads every image
  twice. `init()` from a list mount overwrites the set mid-save.
- **Fix:** `entries: Map<id, "saving" | "saved">` + private in-flight promise map;
  reuse in-flight saves; remove cancels/awaits; `init` merges. Keep a
  `cachedIds` computed Set for callers. Effort S–M.

### 2.7 Reader edit / translate modes

- **Where:** `app/src/views/ReaderView.vue:183-248`, `:303-311`, template `:332-374`.
- **Problem:** six independent refs. Double Translate → two DeepL calls. Translate,
  then edit & save → the in-flight translation of the old text is written back
  and shown by default. The id-change reset leaves `editing` and drafts set.
- **Fix:** `ContentMode = reading{view, error?} | translating{forId} | editing{title, content}`
  with explicit transitions. Related store gap: `translateBookmark`
  (`bookmarks.ts:418-421`) applies a response without checking the content
  changed meanwhile. Effort M.

### 2.8 Shared note-row builder for edge functions

- **Where:** `truncateTitle` ×4, `wordCount`/`readingTimeFromWordCount` ×3,
  `decodeBase64`/`titleFromFilename` ×2 across `supabase/functions/*/…Logic.ts`.
- **Problem:** notes from `capture` (`capture/index.ts:73-84`) and the app's
  `addNote` (`bookmarks.ts:305-314`) are inserted without
  `word_count`/`reading_time` — never shown "N min" — while `snippet` /
  `file-import` notes are.
- **Fix:** `supabase/functions/_shared/noteRow.ts` (`readyNoteRow`, text metrics)
  and `_shared/file.ts`; keep CORS/`json` helpers local. Fix `addNote` too.
  Verify `_shared` is bundled on deploy. Effort S.

### 2.9 Worker status transitions are unguarded

- **Where:** `worker/src/index.ts:121-167`, `:199-212`.
- **Problem:** claim and finish write by `id` only. Refresh while processing →
  the old parse overwrites the re-queue; a failed claim is logged and parsing
  continues; two overlapping containers (deploy) both process a row. Worker's
  `Bookmark.type` is `"article" | "youtube"`, the schema allows `note | pdf`.
- **Fix:** `transition(id, from, to, fields)` = update `.eq("status", from)` +
  `.select("id")`; skip/log when no row moved; reject unknown types to `failed`. Effort S.

### 2.10 Stale pasted HTML in snippet mode

- **Where:** `AddBookmarkDialog.vue:15-16`, `:47-49`, `:139-141`.
- **Problem:** `snippetHtml` survives clearing the textarea — a typed note is
  saved as the old pasted snippet.
- **Fix:** keep `{ html, text }` captured together; drop the HTML when the text
  is cleared. **Decide:** clear on empty, or on any edit? Effort S.

Minor, below the bar but noted: file-size labels hard-coded in 4 places
(`AddBookmarkDialog.vue:8`, `:311`, `bookmarks.ts:343,361`) — `utils/fileKind.ts`
should own them.

---

## 3. Open from the 2026-08-25 audit

### 3.1 Articles bypass in-app DeepL translation
`ReaderMenu.vue:46` sends bookmarks with a `url` to translate.google.com; only
notes use `store.translateBookmark()` → `translate` edge function. Route
articles through DeepL too (cached `translated_content_md`, inline toggle).
Consider DeepL size limits for long articles. Effort S–M.

### 3.2 Worker SSRF hardening
`worker/src/parseArticle.ts` fetches arbitrary user-submitted URLs (and the
Playwright fallback navigates to them) with no loopback / private /
link-local rejection. Resolve the host and reject private ranges before
fetching; block redirects into them. Effort S–M.

### 3.3 Object-URL leak in offline hydration
`app/src/lib/offlineDb.ts:84` creates `blob:` URLs for cached images and never
revokes them. Revoke on reader unmount / article change. Effort S.

### 3.4 Offline image caching fails silently on CORS
`offlineCache.ts` `fetch(url)` for hot-linked source images fails under CORS
and is swallowed — the offline copy lacks images with no signal. Options:
`mode: "no-cors"` opaque blobs (renderable via `blob:`? verify), proxy through
the worker, or surface "images not cached". Needs a decision. Effort M.

---

## 4. Follow-ups (Kairos)

- **True `updated_at` delta sync** for the list, with delete tombstones — if the
  first-page fetch per session becomes visible. (Kairos task exists.)
- **Refresh the offline copy when an article is edited/translated** — the
  cached `articles` row is never updated after the first cache. (Kairos task exists.)

---

## 5. YouTube embed & inline editing — leftovers

Both shipped (click-to-play `youtube-nocookie.com` embed; `md-editor-v3`
editor with `content_edited` guard on both refresh paths). Remaining:

- **Backfill `youtube_video_id`** for rows captured before the column existed —
  the worker now derives the id from the URL (`youtubeMeta.ts` `extractVideoId`),
  so a one-off script can reuse that. Until then those rows show thumbnail only.
- **Preview fidelity spot-check** — compare `md-editor-v3` preview and the
  reader's `markdown-it` render on real content (headings/links/lists, a
  Turndown snippet).
- **Real small-viewport check** of the editor's single-pane toggle (<640px) —
  only unit-tested.
- **Real-browser pass** of the click-to-play embed; re-confirm the
  `youtube-nocookie.com/embed/<id>` URL shape.
- **Editor theming depth** — theme switching is wired; matching the `--rl-*`
  tokens is not. Revisit if it feels off-brand.
- **Offline editing** — out of scope; would need a write queue-and-replay that
  no write in the app has today.

---

## 6. Deferred features & hardening

- **Twitter/X capture** — bookmarklet DOM-scrape, or an optional URL field on
  Snippet mode as the lighter alternative.
- **Instagram AI summaries** — new type, worker module, `ANTHROPIC_API_KEY` secret.
- **PDF OCR** for scanned PDFs (today `pdf_parsed: false` → original-only view).
- **Tracking-param stripping** (`utm_*`, `fbclid`) in `url_normalized`, if
  near-duplicate saves show up.
- **Open Graph tags for `/s/:id`** — needs a small prerender edge function for
  crawler UAs (the app is a client-rendered SPA).
- **Optional schema hardening** — `check (url is not null or status = 'ready')`
  so a note/pdf can never enter the worker queue; split `processed_at`, which
  is both the processing lease timestamp and the completion time.
- **Single-user assumptions** to revisit if that ever changes: global
  `bookmarks_url_normalized_uniq` and global `tags.name` uniqueness.

---

## 7. Frontend: migrate styling to Tailwind v4+

**Reference implementation:** `~/code/kairos-v2/apps/client` — follow its
setup, theme structure and shared-component conventions. Shared components
live in `app/src/shared/ui/`.

**Why.** Styling today is hand-written scoped CSS (~1,300 lines across 21
SFCs) over `--rl-*` custom properties in `app/src/assets/tokens.css`. The
same button styles (`.btn`, `.btn-primary`, `.btn-secondary`) are redefined
in six components (`AddBookmarkDialog`, `ShareDialog`, `SettingsView`,
`ShareTargetView`, `ReaderView`, `CaptureView`), and two dialogs
reimplement the same backdrop/dialog shell.

### 7.1 Setup (mirror kairos)

- Deps (latest): `tailwindcss`, `@tailwindcss/vite`, `tailwind-merge`.
  Register `tailwindcss()` first in `app/vite.config.ts` plugins, before `vue()`.
- One entry stylesheet (`app/src/main.css`, replacing
  `assets/main.css` + `assets/tokens.css`):
  - `@import "tailwindcss";`
  - `@custom-variant dark (&:where([data-theme=dark], [data-theme=dark] *));`
    — keeps the existing `data-theme` attribute (theme store changes are in 7.3).
  - `@theme { … }` with light values, and a `[data-theme="dark"] { … }`
    override block. Base `html, body` rules follow.
- `app/src/shared/clsx.ts` — `clsx()` + `cn()` (tailwind-merge), copied from
  kairos with its test.
- Keep self-hosted `@fontsource` fonts. Kairos loads Google Fonts from a CDN;
  read-later is an offline-first PWA and must not.

### 7.2 Theme tokens

Adopt kairos's **semantic token names**, mapped from the current `--rl-*`
values:

| kairos token | read-later today |
|---|---|
| `--color-canvas` | `--rl-bg` |
| `--color-raised` | `--rl-surface` |
| `--color-recessed` | — (new: slightly darker than canvas) |
| `--color-line` / `--color-line-strong` | `--rl-border` / — |
| `--color-ink` / `-ink-muted` / `-ink-faint` / `-ink-inverse` | `--rl-text-primary` / `-secondary` / `-muted` / — |
| `--color-accent` / `-accent-hover` / `-accent-wash` / `-accent-ink` | `--rl-accent` / — / `--rl-accent-tint` / `--rl-on-accent` |
| `--color-danger` | `--rl-danger` (not in kairos, keep) |
| `--color-scrim`, `--color-focus` | — (new) |
| `--font-sans` / `--font-mono` + `--font-serif` | `--rl-font-ui` / `--rl-font-mono` / `--rl-font-serif` |

Keep `--rl-article-font-size` as a plain custom property; `stores/fontSize.ts`
writes it at runtime.

**Decided (2026-09-25):**
- **Palette and fonts — keep read-later's.** Current `--rl-*` colour values,
  Inter / Source Serif 4 / JetBrains Mono, all under kairos token names. Only
  the structure and naming follow kairos, not its look.
- **Root `font-size: 62.5%` — adopt** (1rem = 10px), together with a
  kairos-style `--text-*` scale derived from the current sizes. Every
  existing rem value has to be re-derived. Check article sizing separately:
  `stores/fontSize.ts` works in px (14–24) and sets
  `--rl-article-font-size`, so it isn't affected by the root size.
  Re-verify that the reader's line lengths and spacing still match.
- **Icons — keep `@tabler/icons-vue`** (kairos uses Lucide; not switching).
- **Theme — add "system"**, see 7.3.

### 7.3 Theme: light / dark / system

Follow kairos `src/shared/theme.ts`: the stored preference is a tri-state,
and the applied theme is resolved from it.

- `stores/theme.ts`:
  - `preference: "light" | "dark" | "system"`, persisted in `localStorage`
    under the existing `"theme"` key; a missing key means `system`.
  - `resolved: "light" | "dark"`, a computed (`system` resolves via
    `matchMedia("(prefers-color-scheme: dark)")`), written to
    `document.documentElement.dataset.theme`.
  - A `change` listener on the media query re-applies while the preference
    is `system`.
  - Replace `toggle()` with `setPreference(p)`.
- Pre-paint script in `app/index.html`: already treats a missing key as the
  system preference. Also treat an explicit `"system"` value that way, so
  there's no flash of the wrong theme.
- Consumers that need a concrete theme read `resolved`, not the preference:
  `md-editor-v3`'s `theme` prop in `ArticleContent.vue` takes
  `"light" | "dark"`.
- `ThemeToggle.vue` becomes a three-way control: cycle light → dark → system
  with distinct icon and label, or a small `Tabs`/segmented control on
  `SettingsView`.
- Tests:
  - store: stored value → resolved, a system change while on `system`, and
    no reaction to OS changes after an explicit choice;
  - pre-paint behaviour;
  - toggle labels.
- Update `architecture.md` §6 "Theme switching" when it ships.

### 7.4 Shared components — `app/src/shared/ui/`

Kairos conventions: typed `export interface XProps` / `XEmits` with
`withDefaults(defineProps<…>())`; a `class?: string` prop merged via
`cn()`; variant and size maps as `Record<Variant, string>`; a `.test.ts`
next to each. Don't copy the few kairos components that use untyped runtime
`defineProps({...})` (`Dialog`, `Pill`); follow
`~/.agents/contracts/component_standards.md`.

| Component | Replaces (read-later) |
|---|---|
| `Button.vue` (variants: primary, secondary/outlined, ghost, danger) | `.btn*` in 6 SFCs, `.retry-btn`, `.remove-btn`, `.cancel-btn` |
| `IconButton.vue` (required `title` → `aria-label`) | `.icon-btn`, theme toggle, reader header actions |
| `Dialog.vue` (scrim, header with close, slot) | shells in `AddBookmarkDialog`, `ShareDialog` |
| `Input.vue` (`area` for textarea, v-model, enter/escape emits) | URL/snippet inputs, `TagInput`, `LoginForm`, search box |
| `Tabs.vue` (segmented) | `StatusTabs`, Add-dialog mode switch |
| `Pill.vue` | tag chips (`TagFilterBar`, `TagInput`), type/"Translated" badges |
| `Message.vue`, `Empty.vue` | error / status / empty-list text across views |
| `Menu.vue` (kairos `ContextMenu` pattern) | `ReaderMenu` overflow menu |

Feature components stay under `components/list`, `components/reader` and
`components/auth`, and consume `shared/ui`.

### 7.5 Article typography

The rendered markdown (`ArticleContent.vue`, `v-html`, `:deep` rules) can't
carry utility classes. Keep one hand-written `.prose` block in `main.css`
under `@layer components`, using theme variables (`var(--color-ink)`,
`var(--font-serif)`, `--rl-article-font-size`). Alternatively use
`@tailwindcss/typography`, but restyling it to match the current reader costs
more than it saves. Check that Tailwind's preflight doesn't break
`md-editor-v3`'s own CSS (lists, headings in the preview pane).

### 7.6 Steps

0. **Tests first.** 108 `find('.class')` selectors (38 distinct classes) in
   the Vitest suites, plus Playwright specs, will break once class names
   disappear. Move them to roles, labels or `data-testid` while the old CSS
   is still in place, and keep the suite green.
1. Setup and tokens (7.1–7.2), with temporary `--rl-*` → new-token aliases
   so unmigrated components keep rendering.
2. Tri-state theme (7.3) — independent of styling, can land first.
3. `shared/clsx.ts` and the `shared/ui` primitives, each with tests
   (red → green).
4. Migrate components feature by feature: auth → list → reader → views.
   Delete each `<style scoped>` block as its component is converted.
   Bug-fix items 2.5 (`AddBookmarkDialog`) and 2.7 (`ReaderView`) touch the
   same files: land them before this step, or combine them.
5. Remove the aliases, `tokens.css` and old `main.css`. Grep that no `--rl-*`
   is left except `--rl-article-font-size`.
6. Verify:
   - `vue-tsc -b`, Vitest, Playwright and `vite build` all pass;
   - PWA precache and CSS size before vs. after;
   - a manual pass in both themes at phone width (list, reader, editor,
     dialogs, public view).

Effort L. Minor version bump for `app`.
