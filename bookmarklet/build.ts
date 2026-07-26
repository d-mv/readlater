import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// encodeURIComponent escapes every reserved character (":", "/", ";", "="...),
// tripling the size of anything URL-shaped. encodeURI leaves those reserved
// characters alone and only escapes what's actually unsafe in a javascript:
// URI (whitespace, quotes, braces...) — except "#", which it deliberately
// leaves raw since it's a legal URI character; here that's a bug because a
// stored bookmark URL is fragment-parsed, so a raw "#" would truncate
// everything after it. Escape it manually to keep hex colors safe.
function encodeBookmarklet(code: string): string {
  return encodeURI(code).replaceAll("#", "%23");
}

// Strips whitespace that's only there for readability. String literals are
// passed through untouched; outside of strings, whitespace is dropped unless
// it separates two identifier/keyword characters, in which case a single
// space is kept so tokens don't merge.
function minifyJs(source: string): string {
  const isWordChar = (ch: string | undefined) => ch !== undefined && /[\w$]/.test(ch);
  let out = "";
  let quote: string | null = null;

  for (let i = 0; i < source.length; i++) {
    const ch = source[i];

    if (quote) {
      out += ch;
      if (ch === "\\") out += source[++i];
      else if (ch === quote) quote = null;
      continue;
    }

    if (ch === "'" || ch === '"') {
      quote = ch;
      out += ch;
      continue;
    }

    if (/\s/.test(ch)) {
      let j = i;
      while (j < source.length && /\s/.test(source[j])) j++;
      if (isWordChar(out[out.length - 1]) && isWordChar(source[j])) out += " ";
      i = j - 1;
      continue;
    }

    out += ch;
  }

  return out;
}

// The bookmarklet just opens a popup to the app's own /capture route, which
// saves the bookmark using the already-logged-in Supabase session — no
// shared secret involved, and CSP-immune since opening a window is a
// navigation, not a fetch/eval the target page's CSP can block.
export function buildBookmarklet(source: string, appOrigin: string): string {
  if (!appOrigin) throw new Error("APP_ORIGIN is required");

  const substituted = minifyJs(source).replaceAll("__APP_ORIGIN__", appOrigin);
  return `javascript:${encodeBookmarklet(substituted)}`;
}

if (import.meta.main) {
  const appOrigin = process.env.APP_ORIGIN ?? "";
  const source = readFileSync(join(import.meta.dir, "source.js"), "utf8");

  const bookmarklet = buildBookmarklet(source, appOrigin);
  const outPath = join(import.meta.dir, "dist.txt");
  writeFileSync(outPath, bookmarklet);
  console.log(`Bookmarklet written to ${outPath}`);
}
