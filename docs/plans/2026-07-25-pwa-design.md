# PWA design

> **Status: implemented.** Kept for the reasoning behind app-level IndexedDB
> caching vs. Workbox runtime caching. For the current offline/PWA behavior
> as shipped, see [`docs/architecture.md`](../architecture.md#offline--pwa).

Turns the existing Vue 3 + Vite reading list into an installable, offline-capable PWA. Single-user, self-hosted — optimizes for simplicity over general-purpose robustness.

## Scope

- Installable (manifest, icons, standalone display).
- Offline reading: articles are cached so they can be reopened without network.
- Manual per-item caching: a download icon on unread rows lets you pre-cache before going offline, in addition to auto-caching whatever you open.
- Deleting or archiving a bookmark evicts it from the offline cache.

## App shell

`vite-plugin-pwa` (v1.3.0, Workbox-based, supports Vite 8) via `generateSW` mode in `vite.config.ts`. Precaches JS/CSS/fonts/icons, `CacheFirst`, `registerType: 'autoUpdate'` (no update-prompt UI — single-user, deploys take effect on next load).

Manifest: name "Read Later", `display: standalone`, `theme_color`/`background_color` matching `--rl-bg` per theme. Icons in `public/icons/`: `icon-192.png`, `icon-512.png`, `maskable-512.png`, generated from the user-supplied source image. `apple-touch-icon` + `apple-mobile-web-app-capable` meta tags in `index.html` for iOS "Add to Home Screen".

## Offline article data — app-level, not Workbox runtime caching

Article content (`content_md`) comes from a PostgREST query (`/rest/v1/bookmarks?...`), the same endpoint family as list/status queries that must stay network-fresh — so Workbox URL-pattern caching can't safely distinguish them. Instead: an IndexedDB store (`idb` package) with two object stores:

- `articles`: keyed by bookmark id → `{ content_md, images: Blob[], cachedAt }`. Images referenced in the markdown are fetched from Supabase Storage and stored as blobs, swapped to `blob:` URLs at render time when offline.
- `bookmarksList`: keyed by bookmark id → lightweight metadata (title, status, type, archived, read_at) so the list itself can render offline. Written after every successful `fetch()`; read as a fallback when `fetch()` fails offline.

One shared function, `cacheBookmark(id)`, used by two triggers:
- **Auto**: `ReaderView` calls it after successfully loading an article.
- **Manual**: a download icon on unread rows in `BookmarkRow.vue`, calling it without navigating to the reader. Tapping again evicts it (toggles download/cached icon state).

## Delete + eviction

- New `remove(id)` action in the bookmarks store: deletes the Supabase row, drops it from local state and from both IndexedDB stores.
- New delete icon in `ReaderHeader.vue` next to the existing archive button, with a confirm step (irreversible).
- `archive(id)` now also evicts the `articles` cache entry for that id (frees storage; list metadata gets naturally overwritten on next sync).

## Files touched

- `vite.config.ts`, `index.html` — PWA plugin + manifest wiring.
- `public/icons/*` — generated icon set.
- `src/lib/offlineDb.ts` — IndexedDB wrapper (new).
- `src/stores/offlineCache.ts` — Pinia store wrapping offlineDb, tracks cached ids (new).
- `src/stores/bookmarks.ts` — add `remove()`, hook eviction into `archive()`/`remove()`, offline fallback in `fetch()`.
- `src/components/list/BookmarkRow.vue` — download/cached icon for unread rows.
- `src/components/list/BookmarkList.vue`, `src/views/ReadingListView.vue` — wire the toggle through.
- `src/views/ReaderView.vue` — auto-cache on successful open.
- `src/components/reader/ReaderHeader.vue` — delete button + confirm.

Each gets a corresponding test per the project's TDD convention (failing test first, then implementation).
