# Snippet capture design

> **Status: implemented.** Kept for the reasoning behind a separate
> JWT-authed edge function instead of extending `capture`. For the current
> behavior as shipped, see [`docs/architecture.md`](../architecture.md#3-capture-paths).

Adds a second capture mode to the existing "Add" dialog: alongside saving a URL (current behavior), the user can paste a rich-text snippet copied from anywhere and save it as a formatted note. Additive only — does not replace the bookmarklet or URL-save flow.

## Context

The bookmarklet doesn't work on every site (CSP, `javascript:` URI restrictions, mobile browsers), so relying on it as the only fast-capture path is fragile. The app already has a `note` bookmark type (`content_md`, `type: "note"`, `status: "ready"`, no dedupe) used by `ShareTargetView.vue`'s bare-text branch via `store.addNote()` — this feature extends that same concept with formatting preserved, entered directly in the app instead of via OS share sheet.

## Dialog UI

`AddBookmarkDialog.vue` (`app/src/components/list/AddBookmarkDialog.vue`) gets a segmented-control switch at the top: **URL** / **Snippet**, defaulting to URL. Switching modes swaps the input area and resets validation/error state; the dialog shell (open/cancel/submit, duplicate handling) is otherwise unchanged.

- **URL mode**: unchanged — existing `url` input, `store.add()`, duplicate-confirm flow.
- **Snippet mode**: a single `<textarea>`, paste or type into it directly. No title field (auto-derived), no URL field, no dedupe check (matches existing note behavior). Submit disabled until non-whitespace content is present.

## Client-side paste handling

On `@paste`, read both `event.clipboardData.getData('text/html')` and `getData('text/plain')`. The textarea itself only ever shows/holds the plain text (native textarea behavior — rich formatting isn't rendered there, just captured alongside).

On submit, branch:
- **HTML was captured** → `store.addSnippet(html, text)` — new store action, calls a new server-side edge function that converts HTML to Markdown and inserts the row.
- **No HTML captured** (plain typing, or a source that didn't provide `text/html`) → falls back to the existing `store.addNote(text)` (client-side only, no round trip) — no behavior change from today's plain-note path.

```ts
async function addSnippet(html: string, text: string): Promise<{ error: string | null }> {
  const { data, error } = await supabase.functions.invoke("snippet", { body: { html, text } });
  if (error) return { error: error.message };
  bookmarks.value.unshift(data.bookmark);
  return { error: null };
}
```

`supabase.functions.invoke` attaches the current session's JWT automatically — no manual auth wiring needed.

## New edge function: `supabase/functions/snippet`

JWT-authenticated (`verify_jwt = true` in `config.toml`) — deliberately **not** built on the existing `capture` function, which authenticates via a static `CAPTURE_KEY` bearer token for non-browser callers (iOS Shortcuts, share-target automations with no session) and hardcodes `OWNER_USER_ID` on insert. Mixing a JWT-authenticated browser path into that function would muddy its auth model; `snippet` instead runs the insert as the user's own session (RLS), like the rest of the browser-facing app.

```ts
const supabase = createClient(SUPABASE_URL, ANON_KEY, {
  global: { headers: { Authorization: req.headers.get("Authorization")! } },
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json("not found", 404);

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return json("unauthorized", 401);

  const { html, text } = await req.json();
  const converted = typeof html === "string" ? new TurndownService().turndown(html).trim() : "";
  const content = converted || (typeof text === "string" ? text.trim() : "");
  if (!content) return json("snippet is empty", 400);

  const { data, error } = await supabase
    .from("bookmarks")
    .insert({
      url: null,
      title: truncateTitle(content),
      content_md: content,
      type: "note",
      status: "ready",
      user_id: user.id,
    })
    .select("*, tags(id, name, color)")
    .single();

  if (error) return json(error.message, 500);
  return json({ bookmark: data });
});
```

`"*, tags(id, name, color)"` is inlined directly (it's the same select string the frontend's `BOOKMARK_SELECT` constant holds, in `stores/bookmarks.ts:9`) rather than pulled from a shared module — one string used by one function doesn't justify a `_shared/` abstraction yet.

### HTML → Markdown conversion

Uses `npm:turndown` (same library and default config already used server-side in `worker/src/parseArticle.ts:44` — `new TurndownService().turndown(html)`, no options). Spiked directly under `deno run` to confirm compatibility before committing to this approach: Deno resolves `npm:turndown` and its dependency `@mixmark-io/domino` (turndown's own bundled DOM implementation) without needing `jsdom` at all — confirmed working with a multi-element sample (heading, bold, link, list) producing correct Markdown output.

## Error handling

- Empty submit → disabled client-side (`required`-equivalent on the textarea).
- Turndown output empty but `text` has content → falls back to `text` as `content_md`.
- Both empty after fallback → `400 "snippet is empty"`, shown in the dialog's existing `.error` slot.
- Insert failure → `500` with `error.message`, same generic error display URL mode already uses.
- Unauthenticated → `401` (not reachable in practice; dialog only renders for a logged-in user).

## Testing

- `supabase/functions/snippet/index.test.ts` (+ a small pure-function test for the `converted || text` fallback), mirroring `capture`'s existing `captureLogic.test.ts` structure.
- `stores/bookmarks.test.ts`: `addSnippet()` — mocks `supabase.functions.invoke`, asserts it unshifts the returned bookmark, asserts error propagation.
- `AddBookmarkDialog.test.ts`: mode switch renders the right input; paste with `text/html` calls `addSnippet`; paste with only `text/plain` (or typed text) calls `addNote`; error and empty-submit states.

## Files touched

- `supabase/functions/snippet/index.ts` — new edge function.
- `supabase/config.toml` — `[functions.snippet]` entry, `verify_jwt = true`.
- `app/src/stores/bookmarks.ts` — add `addSnippet()`.
- `app/src/components/list/AddBookmarkDialog.vue` — mode switch, textarea, paste handling, submit branching.

Each gets a corresponding test per the project's TDD convention (failing test first, then implementation).
