import { CircuitBreaker } from "./circuitBreaker";
import { HttpStatusError, isBreakerFailure } from "./errors";
import { USER_AGENT } from "./http";
import { log } from "./logger";
import type { YoutubeMeta } from "./parseYoutube";

export const youtubeCircuitBreaker = new CircuitBreaker({
  name: "youtube-oembed",
  failureThreshold: 3,
  resetTimeoutMs: 30_000,
  // 5xx, timeouts and network errors count; a 4xx (e.g. a private or
  // removed video) is YouTube answering correctly.
  isFailure: isBreakerFailure,
  onStateChange: (from, to) => {
    log.warn("circuit breaker state changed", { breaker: "youtube-oembed", from, to });
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
        "User-Agent": USER_AGENT,
      },
    });
    if (!response.ok) throw new HttpStatusError(response.status, "from YouTube oEmbed");
    const json = await response.json();
    return {
      id: extractVideoId(url),
      title: String(json.title ?? "").replace(/\u0000/g, ""),
      uploader: String(json.author_name ?? "").replace(/\u0000/g, ""),
      thumbnail: String(json.thumbnail_url ?? "").replace(/\u0000/g, ""),
    };
  });
}
