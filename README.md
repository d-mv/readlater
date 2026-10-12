# Read Later

Personal read-it-later app: capture a link (bookmarklet, PWA share-target,
iOS Shortcut, a pasted snippet, or an uploaded Markdown/Word/PDF file), get
it parsed into clean markdown on a self-hosted worker, read it later in a
Vue 3 PWA — offline-capable, with tags, full-text search, DeepL translation,
and optional public sharing per bookmark. Single owner; Supabase (Postgres,
Auth, Storage, Edge Functions) behind owner-only RLS, a worker that fetches
untrusted URLs behind an SSRF guard and egress proxy, and a CSP-hardened
frontend.

## Documentation

- [`docs/architecture.md`](docs/architecture.md) — current system reference:
  data model, capture paths, worker pipeline, frontend, auth, deployment,
  development. Start here.
- [`docs/plan.md`](docs/plan.md) — open work: production follow-ups,
  leftovers and deferred features, in recommended order.
- [`docs/redesign/README.md`](docs/redesign/README.md) — the Braun design
  language the UI follows.

## Development

| Path | What |
|---|---|
| `app/` | Vue 3 PWA (Bun, Vite, Vitest, Playwright e2e) |
| `worker/` | Bun worker, Docker (`bun test`) |
| `supabase/` | migrations, `config.toml`, Deno edge functions (`deno test`) |
| `bookmarklet/` | bookmarklet source and builder (`bun test`) |

`bun install` at the root installs the lefthook git hooks (lint, format,
typecheck, unused deps on commit; app build on push). CI
(`.github/workflows/ci.yml`) runs typecheck, lint and tests for the app and
the worker, and `deno check` + `deno test` for the edge functions. Exact
commands and the deploy order: architecture
[§9 Development & testing](docs/architecture.md#9-development--testing) and
[§8 Deployment](docs/architecture.md#8-deployment).

## Bookmarklet

The bookmarklet only opens a small popup on the app's `/capture` page, which
shows the page's title and URL with a **Save** button: nothing is saved until
you click it (or press Enter). It saves with the session you're logged in
with in that browser, so log in to the app there first. Only http(s) pages
can be saved. Popups don't work in some browsers (e.g. Samsung Internet on
Android); on Android use the PWA's share target instead.

Current build for `https://readlater.mlnkv.net` — save it as a bookmark's
URL:

```js
javascript:(()=%3E%7Bconst%20params=new%20URLSearchParams(%7Burl:location.href,title:document.title%7D);window.open(%22https://readlater.mlnkv.net/capture?%22+params.toString(),%22readlater-capture%22,%22width=380,height=260%22,);%7D)();
```

The popup is 380×260; a very long title or URL scrolls inside it. To build
it for another origin: `cd bookmarklet && APP_ORIGIN=https://… bun run build`
(writes `bookmarklet/dist.txt`, not committed).
