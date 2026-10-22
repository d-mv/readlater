# Read Later — plan

Open work, in one place: what's left from the 2026-09-25 simplification
audit, the 2026-08-25 audit, the 2026-10-11 three-way audit, the
YouTube-embed/editing follow-ups and the long-standing deferred features.
Current-state reference: [`architecture.md`](architecture.md).

Finished sections are condensed to a short **Done** note with the version or
commits that shipped them; details are in git history (this file's full
item-by-item text is at `dbc88e1`).

## Recommended order

1. [9](#9-2026-10-22-audit) — deploy what the 2026-10-22 audit fixed
   (one migration that must ship together with the edge functions), then
   its open items, tracked in Kairos.
2. [8](#8-2026-10-11-audit-app-080-worker-010) — the production-only steps:
   disable signup in the dashboard, add the Vault key the scheduled
   `storage-sweep` needs.
3. [5](#5-youtube-embed--inline-editing--leftovers) — the click-to-play
   real-browser pass and the `youtube_video_id` backfill.
4. [6](#6-deferred-features--hardening) and the product gaps in §8, by
   appetite.

---

## 1. Housekeeping

**Done.** 1.1 Flatten migrations — repo 2026-09-25, live 2026-09-26: the
three DB-traffic follow-ups were folded into
`20260825000001_initial_schema.sql` in their final form (publication column
list, replica identity via `bookmarks_replica_identity_idx`, projected
`get_public_bookmark`) and marked reverted in the live history. Later
changes are new migration files (architecture §2).

---

## 2. Correctness & simplification (2026-09-25 audit)

**Done** (app 0.0.1–0.0.10, worker 0.0.1, deployed 2026-09-26): 2.1 reading
position per `ProgressSession`; 2.2 capture outcome (`toCaptureOutcome`);
2.3 list-session generations; 2.4 import row parser; 2.5 Add dialog `Phase`
+ epoch, "Add anyway" → `store.refresh()`; 2.6 offline cache
`saving`/`saved` states; 2.7 reader `ContentMode` + translate guard; 2.8
shared `readyNoteRow()`; 2.9 compare-and-set worker transitions; 2.10
snippet HTML only while the textarea holds the pasted text.

Also done since: file-size labels come from `utils/fileKind.ts`
(`sizeLimitLabelForFileKind`, `510f0c1`).

---

## 3. Open from the 2026-08-25 audit

**Done.** 3.1 articles translate through DeepL (app 0.1.0; Google "Translate
page" stays as a secondary link). 3.2 worker SSRF guard (worker 0.0.2,
`17db09d`), widened in the 2026-10-11 audit (`15425a4`, `f5f5f25`: IPv6
block list, thumbnail guard, egress proxy pinning the browser to the vetted
IP). The only remaining gap — DNS rebinding on the worker's plain fetch — is
an accepted trade-off (architecture §10). 3.3 object-URL leak (app 0.0.10).
3.4 "images not cached" surfaced per article (app 0.6.0). 3.5 offline mode
fixes (app 0.4.2).

---

## 4. Follow-ups (Kairos)

**Done.** `updated_at` delta sync with delete tombstones (app 0.5.0,
`20261011120000_bookmarks_delta_sync.sql`); offline copy refreshed on
edit/translate (app 0.1.1).

---

## 5. YouTube embed & inline editing — leftovers

Both shipped (click-to-play `youtube-nocookie.com` embed; `md-editor-v3`
editor with `content_edited` guard on both refresh paths). The preview
fidelity and phone single-pane checks are real-browser e2e tests now
(`app/e2e/editor.spec.ts`, `68b9eda`). Remaining:

- **Backfill `youtube_video_id`** for rows captured before the column existed —
  the worker derives the id from the URL (`youtubeMeta.ts` `extractVideoId`),
  so a one-off script can reuse that. Until then those rows show thumbnail only.
- **Real-browser pass** of the click-to-play embed; re-confirm the
  `youtube-nocookie.com/embed/<id>` URL shape.
- **Editor theming depth** — theme switching is wired; matching the Braun
  tokens (`main.css`) is not. Revisit if it feels off-brand. CodeMirror's
  injected styles are allowed by a per-response CSP nonce (`d441c95`);
  browsers without `style-src-elem` (Safari < 15.4) show the editor unstyled.
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
  so a note/pdf can never enter the worker queue (the worker fails such rows
  today); split `processed_at`, which is both the processing lease timestamp
  and the completion time.
- **Single-user assumption**: URL uniqueness (`20261012101000`) and tags
  (`20261011171000`) are per user now. What still assumes one person is the
  capture key (`OWNER_USER_ID`).

Done since this list was written: per-user rate limits on every edge
function, request body caps and generic errors, CSP and security headers,
http(s)-only URLs, worker retries with backoff — all in the §8 audit.

---

## 7. Frontend: migrate styling to Tailwind v4+

**Done** (app 0.2.0–0.3.0; superseded visually by the Braun redesign below).
Tailwind v4 via `@tailwindcss/vite`, one `app/src/main.css`, kairos-v2 token
names, `shared/ui/` primitives with typed contracts, tri-state theme, no
`<style>` blocks left. Deviations from kairos worth remembering (also in the
architecture's *Styling* section where still relevant):

- `--spacing: 0.1rem` (1 unit = 1px) with the 62.5% root.
- Fonts stay self-hosted via `@fontsource`; kairos loads Google Fonts.
- `--text-*: initial`, so text utilities change only the font size.
- Base element rules belong in `@layer base` — unlayered rules beat every
  utility.
- Form controls need `leading-[normal]`, not `leading-normal` (1.5).
- No `color-mix(…var(--color-*)…)` in arbitrary values — Tailwind folds it
  into a static light-theme colour; derived colours get their own themed
  token (e.g. `--color-drop-target`).

---

## Braun redesign — done (app 0.7.0)

Replaced the Flat BeOS pixel style with the Braun / Dieter Rams language of
kairos-v2, drive_read and forth-circle-ims. Spec and deviations:
[`redesign/README.md`](redesign/README.md). Follow-ups shipped: larger list,
tab and tag text on phones (app 0.7.1, `c845d7a`); AA contrast for
`ink-muted`/`ink-faint` (app 0.8.0, `b8b4798`).

---

## 8. 2026-10-11 audit (app 0.8.0, worker 0.1.0)

Three-way review (security, frontend, worker/backend). Full list with fix
notes and live status: https://claude.ai/artifact/JJRcfoQm8CHYoimbZ5RTgz
(private). All findings H01–H09, M01–M13 and L01–L09 are fixed in the code
and deployed — `git log 8608782^..dbc88e1`. In short: http(s)-only URLs
(app, capture, DB constraint); capture/share-target save only on a click;
per-user tags with owner-only RLS; rate limits, body caps, generic errors
and server-side translate text in the edge functions; `storage-sweep`;
worker egress proxy, response caps, retries/backoff, SIGTERM drain,
heartbeat; store writes that check the server's answer; sign-out that
clears the device; CSP and security headers; a11y fixes.

**Still open — production state** (not in the code, do in the dashboard /
SQL editor):

- **Production signup is enabled** (`disable_signup: false`). Turn it off
  and set the minimum password length to 12 (Authentication → Sign In /
  Providers). `supabase/config.toml` documents this but only drives local
  dev.
- **storage-sweep needs its Vault key**: the job is scheduled by migration
  `20261012102000_schedule_storage_sweep.sql` (pg_cron + pg_net) and reads
  `project_url` and `service_role_key` from Vault at run time. Production has
  `project_url`; add `service_role_key` (SQL editor:
  `select vault.create_secret('<service role key>', 'service_role_key');`).
  Until then each run is a no-op and orphaned PDFs and deleted bookmarks'
  YouTube thumbnails stay in Storage (`POST …/storage-sweep?dry_run=1` shows
  the count).

**Accepted trade-offs** (architecture §10): the plain fetch's DNS-rebinding
window; CSP `connect-src https:`; client thumbnail delete denied (sweep
removes them); fixed-window rate limits. No longer trade-offs: Chromium runs
sandboxed (seccomp profile, `6c3b503`), the service key reaches the worker
on fd 3 and never sits in its env (`6c3b503`), the editor's styles use a CSP
nonce (`d441c95`), and sign-out removes supabase-js's stored session itself
(`20e53e3`).

**Product gaps not built:** undo for archive/delete, bulk actions, sort
options, offline full-text search, keyboard shortcuts, audit log,
capture-key rotation, share-link revoke UI.

---

## 9. 2026-10-22 audit

Five-way review (stores/offline, UI, worker, edge functions/DB,
tests/ops/docs); every finding is a Kairos task tagged `audit-2026-10-22`,
closed with its fix notes. Fixed so far (app 0.9.2–0.9.11, worker
0.2.2–0.2.6, `18fbbea..`): caller-supplied rate limits, backups shipped to the
VPS, account data surviving a session that ended without Sign out, worker
gzip bomb and Readability stalls, page charsets and post-redirect URLs,
jsdom crash, delta-sync watermark and tombstones, offline-copy blob: URLs
saved by edits, spurious logout on a refresh blip, share toggle state,
progress catch-up race, import duplicates and tag errors, `*` selects in
the offline copy, saves committing after sign-out.

**Deploy order for these changes:** apply migration
`20261022100000_rate_limits_server_side.sql` (with
`20261022110000_tag_touch_and_user_delete.sql`) and redeploy **all** edge
functions in the same step (the migration drops the old `bump_rate_limit`
signatures; old functions fail with 500 until redeployed), then the app and
the worker.

