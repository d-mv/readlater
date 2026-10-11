import type { Bookmark } from "../lib/supabase";

const YOUTUBE_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"]);
const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);

// Saved URLs end up in href attributes, so anything but http(s) — notably
// javascript: and data: — is rejected at every entry point. Mirrors
// hasAllowedScheme in the capture edge function and the DB check constraint.
export function isHttpUrl(url: string): boolean {
  try {
    return ALLOWED_PROTOCOLS.has(new URL(url).protocol);
  } catch {
    return false;
  }
}

export function detectBookmarkType(url: string): Bookmark["type"] {
  if (!isHttpUrl(url)) throw new TypeError("Only http(s) URLs can be saved");
  const hostname = new URL(url).hostname.toLowerCase();
  return YOUTUBE_HOSTS.has(hostname) ? "youtube" : "article";
}
