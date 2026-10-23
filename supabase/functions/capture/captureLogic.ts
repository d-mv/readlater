const ALLOWED_SCHEMES = new Set(["http:", "https:"]);

// Shared by both the explicit `url` field and the "is this shared text
// actually just a URL" check below, so a scheme restriction applied to one
// path can't be bypassed via the other. A matched URL flows straight to the
// worker's fetch, so accepting javascript:/data:/file:/etc. here isn't just
// a data-quality issue — it hands the worker something it shouldn't fetch.
//
// The raw string must also start with http(s):// — the database's
// bookmarks_url_http_only check — since URL() accepts "http:example.com" and
// strips tabs; those would otherwise pass here and fail the insert with a 500.
const HTTP_PREFIX = /^https?:\/\//i;

export function hasAllowedScheme(url: string): boolean {
  return HTTP_PREFIX.test(url) && URL.canParse(url);
}

export function isBareUrl(s: string): boolean {
  const t = s.trim();
  try {
    const parsed = new URL(t);
    if (!ALLOWED_SCHEMES.has(parsed.protocol)) return false;
    return t === parsed.toString() || `${t}/` === parsed.toString();
  } catch {
    return false;
  }
}

// Mirrors the `url_normalized` generated column in the bookmarks table
// (20261022120000_url_normalized_keeps_path_case.sql) so a post-conflict
// lookup queries by the same value Postgres computed on insert: scheme and
// host lowercased, path and query kept as they are, trailing slashes stripped.
const ORIGIN = /^[^/?#]*\/\/[^/?#]*/;

export function normalizeUrl(url: string): string {
  const origin = ORIGIN.exec(url)?.[0] ?? "";
  return (origin.toLowerCase() + url.slice(origin.length)).replace(/\/+$/, "");
}
