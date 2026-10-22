import type { Bookmark } from "../lib/supabase";

const YOUTUBE_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"]);
// Saved URLs end up in href attributes, so anything but http(s) — notably
// javascript: and data: — is rejected at every entry point. Mirrors
// hasAllowedScheme in the capture edge function and the DB check constraint:
// the raw string must start with http(s):// (URL() alone is laxer — it
// accepts "http:example.com" and strips tabs and leading spaces, which the
// stored string would still carry) and parse as a URL.
const HTTP_PREFIX = /^https?:\/\//i;

export function isHttpUrl(url: string): boolean {
  return HTTP_PREFIX.test(url) && URL.canParse(url);
}

export function detectBookmarkType(url: string): Bookmark["type"] {
  if (!isHttpUrl(url)) throw new TypeError("Only http(s) URLs can be saved");
  const hostname = new URL(url).hostname.toLowerCase();
  return YOUTUBE_HOSTS.has(hostname) ? "youtube" : "article";
}
