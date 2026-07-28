import type { YoutubeMeta } from "./parseYoutube";

function extractVideoId(url: string): string {
  const parsed = new URL(url);
  if (parsed.hostname === "youtu.be") return parsed.pathname.slice(1);
  const watchId = parsed.searchParams.get("v");
  if (watchId) return watchId;
  const match = parsed.pathname.match(/\/(?:embed|shorts)\/([^/]+)/);
  if (match?.[1]) return match[1];
  throw new Error(`could not extract video id from ${url}`);
}

export async function fetchMeta(url: string): Promise<YoutubeMeta> {
  const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
  const response = await fetch(oembedUrl);
  if (!response.ok) throw new Error(`oEmbed request failed: ${response.status}`);
  const json = await response.json();
  return {
    id: extractVideoId(url),
    title: json.title,
    uploader: json.author_name,
    thumbnail: json.thumbnail_url,
  };
}
