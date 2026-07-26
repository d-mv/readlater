import type { Bookmark } from "../lib/supabase";

const YOUTUBE_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"]);

export function detectBookmarkType(url: string): Bookmark["type"] {
  const hostname = new URL(url).hostname.toLowerCase();
  return YOUTUBE_HOSTS.has(hostname) ? "youtube" : "article";
}
