# Database tests (pgTAP)

Integration tests for `supabase/migrations/`: RLS, triggers, constraints, SQL
functions, storage policies and the Realtime publication. They run against
the **local** Supabase stack only.

```sh
bun run test:db                 # start stack if needed → db reset → supabase test db
KEEP_STACK=1 bun run test:db    # leave a stack the script started running
bunx supabase test db           # just the tests, against an already-reset local DB
```

The runner is `supabase/run-db-tests.sh` (needs Docker). It stops the stack
afterwards only if it started it.

## Layout

- `_helpers.psql` — included by every file (`\ir _helpers.psql`): loads
  pgTAP, seeds users A (`…000a`) and B (`…000b`), and provides
  `tests.authenticate_as(uuid)`, `tests.authenticate_anon()`,
  `tests.authenticate_service_role()` (sets `role` + `request.jwt.claims`
  for the transaction; `reset role` goes back to `postgres`).
- Each `NN_*.sql` file is one transaction that rolls back. `now()` is fixed
  within it, so "was bumped" checks compare an old fixture value to `now()`.
- `00_inventory.sql` pins the exact set of public tables, functions,
  triggers, policies and bookmarks indexes: adding one to a migration fails
  it until it's listed there and covered below.

## Coverage checklist

| DB object | Test file |
|---|---|
| `bookmarks` policy "owner access" (select/insert/update/delete, with check, anon) | 01 |
| `get_public_bookmark()` (public only, safe columns, anon/auth grants, no enumeration) | 01 |
| `bookmarks_url_http_only` | 02 |
| `bookmarks_url_required_unless_note`, `bookmarks_pdf_path_requires_type`, type/status/view_mode checks | 02 |
| `url_normalized` generated column + `bookmarks_url_normalized_uniq` (global — see note) | 02 |
| bookmarks defaults, PK/FK, indexes, replica identity | 00, 02 |
| `bookmarks_touch_updated_at` trigger/function | 03 |
| `bookmarks_reset_retry` trigger/function (user vs worker re-queue) | 03 |
| `bookmarks_record_deletion` trigger/function, `bookmark_deletions` + policy "owner read", user cascade | 03 |
| `tags` (per-user `tags_user_id_name_key`, `user_id default auth.uid()`, policy "owner access") | 04 |
| `bookmark_tags` policy "owner access" (cross-user links refused), cascades | 04 |
| `bookmark_tags_touch_bookmark` (attach/detach/tag delete bump; no cross-user bump) | 04 |
| `rate_limits` (no policies/grants), `bump_rate_limit()`, `bump_rate_limit_for_user()` | 05 |
| buckets `bookmark-pdfs` / `bookmark-assets` (privacy, size, MIME allow-lists — values only) | 06 |
| storage.objects policies "owner read/write/delete own pdfs" | 06 |
| `list_orphaned_storage_objects()` (min age, limit, both buckets, service_role only) | 06 |
| `supabase_realtime` publication column list | 07 |
| `search_vector` + `bookmarks_search_idx` (weights, websearch syntax, RLS, default config) | 07 |

Not testable at the SQL level: bucket MIME/size enforcement (done by the
Storage API) and Realtime delivery itself.

Known limitation pinned by a test (02): `bookmarks_url_normalized_uniq` is
global, not per user — the documented single-user assumption
(`docs/plan.md` §6). Flip that test when the index becomes per user.
