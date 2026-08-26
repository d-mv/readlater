# Implementation notes — reduce app↔DB calls & egress

Branch `perf/reduce-db-traffic`. Deviations and conservative choices made
during execution, for review before merge.

## Deviations from the original plan

- **Steps 2 + 3 merged.** "Client-side filtering" and "Realtime replaces
  polling" are the same architectural shift (`bookmarks.value` stops being a
  server-filtered view and becomes the loaded working set), so they landed in
  one commit rather than two.

- **Pagination vs. derived state.** Infinite scroll (chosen over a bounded
  fetch) means `unreadCount`, `allTags`, and client-side tag filtering derive
  from only the pages loaded so far. Accepted per the product call. Real
  `updated_at`-delta sync is the follow-up if the first-page fetch per session
  ever becomes visible. The load-more sentinel is `v-if`'d on
  `visibleBookmarks.length > 0` so an empty Archived tab doesn't auto-page the
  whole library.

- **Search reduced to submit-only** (not per-keystroke debounce). Clearing the
  box still reloads the full list immediately. Body-text search now costs one
  query per explicit search instead of one per keystroke.

- **Realtime payload excludes body columns** via a publication column list, and
  the table is set `REPLICA IDENTITY FULL` so RLS can be evaluated on DELETE
  events (default identity only carries the PK, which isn't enough to check
  `user_id`). Low write volume makes the extra WAL negligible.

- **Realtime INSERT is dropped while a search is active** — a new row may not
  match the search; the user re-runs the search to see it. UPDATE/DELETE still
  apply to rows already in view.

- **`get_public_bookmark` return type changed**, so the migration is
  `drop function` + `create` (Postgres can't `create or replace` across a
  return-type change). Grants re-added for `anon, authenticated`.

- **Import bulk-insert failure reports every row as skipped** rather than
  falling back to per-row inserts. Keeps the "doesn't throw" contract; loses
  per-row granularity only in the rare total-failure case (client-side
  dedup already removes the common unique-URL collisions).

- **`getUser()` → auth-store `userId`.** The store already holds the session in
  memory (`onAuthStateChange`), so the insert paths read `useAuthStore().userId`
  instead of a `GET /auth/v1/user` round-trip.

## Migrations (apply before/with the deploy)

1. `20260826120000_realtime_bookmarks_publication.sql` — additive, safe to
   apply any time.
2. `20260826120001_public_bookmark_projection.sql` — pairs with the
   `PublicReaderView` change; apply as part of the deploy.

Both via `bunx supabase db push --project-ref egkakmlkerlmsigoegoe`.

## Deferred (Kairos follow-ups)

- True `updated_at`-based delta sync with delete tombstones.
- Optional: refresh the offline-cached copy when an article is edited /
  translated (pre-existing gap, not introduced here).
