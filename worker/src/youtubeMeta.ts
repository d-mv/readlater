import { CircuitBreaker } from "./circuitBreaker";
import type { YoutubeMeta } from "./parseYoutube";

export const youtubeCircuitBreaker = new CircuitBreaker({
  name: "youtube-oembed",
  failureThreshold: 3,
  resetTimeoutMs: 30_000,
  onStateChange: (from, to) => {
    console.warn(`[CircuitBreaker] youtube-oembed state changed: ${from} -> ${to}`);
  },
});

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
  return youtubeCircuitBreaker.execute(async () => {
    const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
    const response = await fetch(oembedUrl, {
      signal: AbortSignal.timeout(15_000),
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 (compatible; ReadLater/1.0)",
      },
    });
    if (!response.ok) throw new Error(`oEmbed request failed: ${response.status}`);
    const json = await response.json();
    return {
      id: extractVideoId(url),
      title: String(json.title ?? "").replace(/\u0000/g, ""),
      uploader: String(json.author_name ?? "").replace(/\u0000/g, ""),
      thumbnail: String(json.thumbnail_url ?? "").replace(/\u0000/g, ""),
    };
  });
}
