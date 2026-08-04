# File and PDF import design

> **Status: implemented.** Kept for the reasoning behind PDF getting its own
> `bookmarks.type` and a private Storage bucket, while Markdown/Word fold
> into the existing `note` type and keep no original. For the current
> behavior as shipped, see
> [`docs/architecture.md`](../architecture.md#3-capture-paths).

Adds a third mode to the existing "Add" dialog — **File** — alongside URL
and Snippet: upload a `.md`/`.markdown`/`.docx`/`.pdf` file and get it saved
as a readable bookmark. Additive only, no change to the existing modes.

## Context

The app already converts pasted HTML to Markdown server-side (`snippet` edge
function, `npm:turndown`). Uploaded files are the same problem with an extra
step: get bytes onto the server, figure out what kind of file it is, and
convert *that* to Markdown before treating it like any other note. PDFs
don't fit that pattern cleanly — a PDF's "conversion" (text extraction) is
lossy and sometimes fails outright (scanned/image-only PDFs have no text
layer at all), so unlike Markdown/Word, the original is worth keeping around
rather than discarding it once conversion is attempted.

## Two upload kinds, two edge functions

**Markdown/Word → `file-import`.** Both are "read it, convert it, trash it":
- `.md`/`.markdown` passes through as-is (decode, trim).
- `.docx` converts via `npm:mammoth` (docx → HTML) piped through the same
  `turndown` HTML→Markdown step `snippet` already uses — no new conversion
  library for the HTML half.
- Result inserts as `type: 'note', status: 'ready'`, identical in shape to a
  pasted snippet. The original file bytes are never written anywhere; they
  exist only for the duration of the request.
- Size limits: 500KB for Markdown, 5MB for Word — enforced both client-side
  (reject before spending a round trip) and server-side (the client check is
  UX, not the security boundary).
- Legacy `.doc` (pre-2007 binary format) is explicitly unsupported —
  `mammoth` only reads the `.docx` XML format, and adding a second parser
  for a format Word itself no longer defaults to wasn't worth it.

**PDF → `pdf-import`.** A separate function because the shape of the problem
is different, not just the file type:
1. Upload the original to Storage bucket `bookmark-pdfs` first
   (`{user_id}/{uuid}.pdf`), before attempting extraction — so the file
   survives even if extraction throws.
2. Attempt text extraction via `npm:unpdf`, not `pdfjs-dist` directly —
   `unpdf` wraps pdf.js specifically for serverless/edge runtimes with no
   DOM/canvas available; plain `pdfjs-dist`'s full pipeline expects one even
   though text-only extraction doesn't actually need rendering.
3. A PDF with no extractable text (scanned images, etc.) is an **expected
   outcome** (`pdf_parsed: false`, `content_md: null`), not a request
   failure — the reader falls back to showing the original.
4. If the `bookmarks` insert itself fails after the upload succeeded, the
   Storage object is removed rather than left orphaned
   (`supabase.storage.from(PDF_BUCKET).remove([path])`).
5. Size limit: 20MB — larger than Word's 5MB since PDFs (especially scanned
   ones) run bigger for the same content, chosen over 5MB/50MB as the
   middle ground between rejecting too many real files and risking slow
   edge-function extraction/high storage cost on the low-value tail.

Both functions mirror `snippet`'s auth model: JWT-authed
(`verify_jwt = true`), running the insert as the caller's own Supabase
session rather than a service-role/static-key path — there's no non-browser
caller for either (unlike `capture`), so there's no reason to weaken it.

```ts
// supabase/functions/file-import/index.ts (docx branch)
async function convertDocxToMarkdown(bytes: Uint8Array): Promise<string> {
  const { value: html } = await mammoth.convertToHtml({ buffer: Buffer.from(bytes) });
  return new TurndownService().turndown(html);
}
```

```ts
// supabase/functions/pdf-import/index.ts
const path = pdfObjectPath(user.id); // `${userId}/${crypto.randomUUID()}.pdf`
const { error: uploadError } = await supabase.storage
  .from(PDF_BUCKET)
  .upload(path, bytes, { contentType: "application/pdf" });
if (uploadError) return json(uploadError.message, 500);

let content = "";
try {
  content = normalizeExtractedText(await extractPdf(bytes));
} catch {
  content = ""; // no text layer / corrupt — not a request failure
}
const parsed = content.length > 0;
```

Both functions take their conversion step (`convertDocx` / `extractPdf`) as
an injectable parameter defaulting to the real implementation — lets
`index.test.ts` exercise the request-handling logic (auth, size limits,
insert, error paths) with a fake converter instead of needing real `.docx`/
`.pdf` binary fixtures for every branch. The real mammoth/unpdf pipelines
are still verified once each, directly, against a hand-built minimal `.docx`
and `.pdf` fixture (not part of the checked-in test suite — a one-off
sanity check that the libraries actually work end-to-end under Deno's npm
compat before committing to them).

## Why PDF gets its own `bookmarks.type` instead of folding into `note`

Notes and converted Markdown/Word files all reduce to the same shape:
`content_md` plus metadata, nothing else. PDF doesn't reduce that cleanly —
it needs to carry two extra pieces of state no other type has:
- `pdf_path` — the original may or may not still exist (the user can trash
  it once Markdown is trusted; see below).
- `pdf_parsed` — whether `content_md` is meaningful at all, which changes
  what the reader is allowed to show.

Bolting both onto `note` via nullable columns would work mechanically, but
`type = 'pdf'` makes "this bookmark has PDF-specific behavior" checkable
without also checking two other columns, and keeps the `note` type's
contract ("just `content_md`") intact for the two upload kinds that actually
satisfy it.

## Storage: private bucket, signed URLs, not `bookmark-assets`

YouTube thumbnails already go through Supabase Storage
(`worker/src/storage.ts`, bucket `bookmark-assets`), but that bucket is
public-read — fine for thumbnails (incidental, low-value if leaked), wrong
for a user's own uploaded document. `bookmark-pdfs` is a **private** bucket
instead: owner-scoped Storage RLS policies keyed off the object path's first
segment (`{user_id}/...`), and the reader/"Open original" both resolve a
60-second signed URL on demand (`store.getPdfSignedUrl()`) rather than ever
storing or exposing a bare public URL.

## Reader: dual view, persisted toggle, trash-original

`view_mode` (`'markdown' | 'original' | null`) is the persisted user choice;
`null` means "no explicit choice yet," and the effective view is computed
rather than written eagerly on insert:

```ts
const pdfEffectiveViewMode = computed(() => {
  if (!bookmark.value || bookmark.value.type !== "pdf") return "markdown";
  if (bookmark.value.view_mode) return bookmark.value.view_mode;
  return bookmark.value.pdf_parsed ? "markdown" : "original";
});
```

The toggle bar (mirrors the existing translate original/translated toggle
visually) only renders when both views actually exist —
`pdf_parsed && pdf_path` — otherwise there's nothing to switch to and the
single available view renders unconditionally. The original renders inline
via `<iframe :src="signedUrl">`, leaning on the browser's native PDF viewer
rather than a bundled PDF.js viewer component — this app already avoids
component-library dependencies, and an `<iframe>` covers "show the PDF" with
zero extra JS.

**Trash original PDF** (reader overflow menu, confirmation-gated like
Delete) is only offered once `pdf_parsed` — trashing the original of an
*unparsed* PDF would leave nothing to read at all, since `content_md` is
null in that case. Trashing removes the Storage object and clears
`pdf_path`; afterward both the toggle bar and "Open original" disappear
(their guard conditions are the same `pdf_path` check), and the bookmark
behaves like a plain Markdown note from then on.

## Testing

- `supabase/functions/file-import/{fileImportLogic,index}.test.ts` and
  `supabase/functions/pdf-import/{pdfImportLogic,index}.test.ts` — mirror
  `snippet`'s test structure (pure-function tests + handler tests against a
  fake Supabase client).
- `app/src/utils/{base64,fileKind}.test.ts` — the chunked base64 encoder and
  the extension/size-limit lookup shared between the store and the dialog.
- `stores/bookmarks.test.ts` — `addFile`/`addPdf` (edge function invocation,
  client-side validation short-circuiting before any network call),
  `setViewMode`, `getPdfSignedUrl`, `trashOriginalPdf`.
- `AddBookmarkDialog.test.ts` — File mode rendering, extension/size
  validation messages, routing `.pdf` to `addPdf` and everything else to
  `addFile`.
- `ArticleContent.test.ts`, `ReaderMenu.test.ts`, `ReaderHeader.test.ts`,
  `ReaderView.test.ts` — the iframe/loading-placeholder branch, the
  PDF-specific "Open original"/"Trash original PDF" menu items and their
  visibility conditions, and the end-to-end toggle → signed-url-fetch →
  persisted-`view_mode` flow.

## Files touched

- `supabase/migrations/20260804000001_pdf_support.sql` — `type` check,
  `pdf_path`/`pdf_parsed`/`view_mode` columns, `bookmark-pdfs` bucket +
  owner-scoped Storage RLS policies.
- `supabase/functions/file-import/`, `supabase/functions/pdf-import/` — new
  edge functions.
- `supabase/config.toml` — `[functions.file-import]`,
  `[functions.pdf-import]`, both `verify_jwt = true`.
- `app/src/utils/base64.ts`, `app/src/utils/fileKind.ts` — new shared
  helpers.
- `app/src/lib/supabase.ts` — `Bookmark.type` gains `'pdf'`; new
  `pdf_path`/`pdf_parsed`/`view_mode` fields.
- `app/src/stores/bookmarks.ts` — `addFile()`, `addPdf()`, `setViewMode()`,
  `getPdfSignedUrl()`, `trashOriginalPdf()`.
- `app/src/components/list/AddBookmarkDialog.vue` — File mode.
- `app/src/components/reader/ArticleContent.vue` — `showPdfOriginal`/
  `pdfUrl` props, inline PDF iframe branch.
- `app/src/components/reader/ReaderMenu.vue`,
  `app/src/components/reader/ReaderHeader.vue` — PDF "Open original" /
  "Trash original PDF" menu items.
- `app/src/views/ReaderView.vue` — view-mode computation, toggle bar, signed
  URL resolution, open/trash handlers.

Each gets a corresponding test per the project's TDD convention (failing
test first, then implementation).
