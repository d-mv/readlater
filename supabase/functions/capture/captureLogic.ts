const ALLOWED_SCHEMES = new Set(["http:", "https:"]);

// Shared by both the explicit `url` field and the "is this shared text
// actually just a URL" check below, so a scheme restriction applied to one
// path can't be bypassed via the other. A matched URL flows straight to the
// worker's fetch, so accepting javascript:/data:/file:/etc. here isn't just
// a data-quality issue — it hands the worker something it shouldn't fetch.
export function hasAllowedScheme(url: string): boolean {
  try {
    return ALLOWED_SCHEMES.has(new URL(url).protocol);
  } catch {
    return false;
  }
}

export function isBareUrl(s: string): boolean {
  const t = s.trim();
  try {
    const parsed = new URL(t);
    return t === parsed.toString() && ALLOWED_SCHEMES.has(parsed.protocol);
  } catch {
    return false;
  }
}

export function truncateTitle(text: string, max = 100): string {
  if (text.length <= max) return text;
  const slice = text.slice(0, max);
  const lastSpace = slice.lastIndexOf(" ");
  const cut = lastSpace > 0 ? slice.slice(0, lastSpace) : slice; // fallback: no space found, hard cut
  return cut.trim() + "…";
}

// Mirrors the `url_normalized` generated column in the bookmarks table
// (lower(regexp_replace(url, '/+$', ''))) so a post-conflict lookup queries
// by the same value Postgres computed on insert.
export function normalizeUrl(url: string): string {
  return url.toLowerCase().replace(/\/+$/, "");
}
