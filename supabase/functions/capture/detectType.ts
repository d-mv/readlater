export type BookmarkType = "article" | "youtube";

const YOUTUBE_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"]);

export function detectType(url: string): BookmarkType {
  const hostname = new URL(url).hostname.toLowerCase();
  return YOUTUBE_HOSTS.has(hostname) ? "youtube" : "article";
}
