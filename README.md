# Read Later

Personal read-it-later app: capture a link (bookmarklet, PWA share-target,
a pasted snippet, or an uploaded Markdown/Word/PDF file), get it parsed into
clean markdown on a self-hosted worker, read it later in a Vue 3 PWA —
offline-capable, with tags, full-text search, and optional public sharing
per bookmark.

## Documentation

- [`docs/architecture.md`](docs/architecture.md) — current system reference:
  data model, capture paths, worker pipeline, frontend, auth, deployment.
  Start here.
- [`docs/plans/`](docs/plans) — original design docs for individual features
  (new capabilities, PWA/offline, snippet capture), kept for the trade-off
  reasoning behind decisions already reflected in `architecture.md`.

## Bookmarklet

For bookmarklet (doesn't work in some browsers, like Samsung Browser for Android), use:

```js
javascript:(()=%3E%7Bconst%20params=new%20URLSearchParams(%7Burl:location.href,title:document.title%7D);window.open('https://readlater.mlnkv.net/capture?'+params.toString(),'readlater-capture','width=380,height=260');%7D)();
```
