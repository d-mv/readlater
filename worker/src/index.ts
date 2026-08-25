import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { CircuitBreaker, CircuitBreakerOpenError } from "./circuitBreaker";
import { parseArticle, type ParsedArticle } from "./parseArticle";
import { parseYoutube, type ParsedYoutube } from "./parseYoutube";
import { fetchMeta } from "./youtubeMeta";
import { makeThumbnailUploader } from "./storage";
import { closeBrowser, renderWithBrowser } from "./browserRender";

export { CircuitBreaker, CircuitBreakerOpenError };

const POLL_INTERVAL_MS = 15_000;
const BATCH_SIZE = 5;
const ERROR_MESSAGE_MAX_LENGTH = 500;
const BOOKMARK_TIMEOUT_MS = 45_000;

export const supabase =
  process.env.SUPABASE_URL && process.env.SUPABASE_SECRET_KEY
    ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY)
    : (null as unknown as SupabaseClient);

export const uploadThumbnail = supabase
  ? makeThumbnailUploader(supabase)
  : () => Promise.resolve("");

export const supabaseCircuitBreaker = new CircuitBreaker({
  name: "supabase-db",
  failureThreshold: 3,
  resetTimeoutMs: 60_000,
  onStateChange: (from, to) => {
    console.warn(`[CircuitBreaker] supabase-db state changed: ${from} -> ${to}`);
  },
});

export interface Bookmark {
  id: string;
  url: string;
  type: "article" | "youtube";
}

let isPolling = false;

function sanitizeValue(val: unknown): unknown {
  if (typeof val === "string") {
    return val.replace(/\u0000/g, "");
  }
  return val;
}

function sanitizeFields<T extends Record<string, unknown>>(obj: T): T {
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    clean[k] = sanitizeValue(v);
  }
  return clean as T;
}

export function formatErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  return raw.replace(/\u0000/g, "").slice(0, ERROR_MESSAGE_MAX_LENGTH) || "Unknown error";
}

export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

// Mark bookmarks stuck in 'processing' (e.g. from an ungraceful container restart or worker crash) as 'failed'
// so they do not loop forever or block the queue.
export async function recoverStaleProcessing(client: SupabaseClient = supabase) {
  const staleThreshold = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const { error } = await client
    .from("bookmarks")
    .update({
      status: "failed",
      error_message: "Processing timed out or worker restarted",
      processed_at: new Date().toISOString(),
    })
    .eq("status", "processing")
    .or(`processed_at.is.null,processed_at.lt.${staleThreshold}`);

  if (error) {
    console.error("recoverStaleProcessing error:", error.message);
  }
}

export async function processBookmark(
  bookmark: Bookmark,
  client: SupabaseClient = supabase,
  runners: {
    parseYoutubeFn?: typeof parseYoutube;
    parseArticleFn?: typeof parseArticle;
    fetchMetaFn?: typeof fetchMeta;
    uploadThumbnailFn?: (url: string) => Promise<string>;
    renderHtmlFn?: typeof renderWithBrowser;
  } = {},
) {
  const parseYt = runners.parseYoutubeFn ?? parseYoutube;
  const parseArt = runners.parseArticleFn ?? parseArticle;
  const metaFn = runners.fetchMetaFn ?? fetchMeta;
  const thumbFn = runners.uploadThumbnailFn ?? uploadThumbnail;
  const renderFn = runners.renderHtmlFn ?? renderWithBrowser;

  const { error: markProcessingError } = await client
    .from("bookmarks")
    .update({ status: "processing", processed_at: new Date().toISOString() })
    .eq("id", bookmark.id);

  if (markProcessingError) {
    console.error(
      `Failed to mark bookmark ${bookmark.id} as processing:`,
      markProcessingError.message,
    );
  }

  try {
    const parsePromise: Promise<ParsedArticle | ParsedYoutube> =
      bookmark.type === "youtube"
        ? parseYt(bookmark.url, { fetchMeta: metaFn, uploadThumbnail: thumbFn })
        : parseArt(bookmark.url, undefined, renderFn);

    const result = await withTimeout(
      parsePromise,
      BOOKMARK_TIMEOUT_MS,
      `Processing timed out after ${BOOKMARK_TIMEOUT_MS / 1000}s`,
    );

    const { error: updateReadyError } = await client
      .from("bookmarks")
      .update({
        ...sanitizeFields(result as unknown as Record<string, unknown>),
        status: "ready",
        error_message: null,
        processed_at: new Date().toISOString(),
      })
      .eq("id", bookmark.id);

    if (updateReadyError) {
      throw new Error(`Database update failed: ${updateReadyError.message}`);
    }
  } catch (err) {
    console.error(`Error processing bookmark ${bookmark.id} (${bookmark.url}):`, err);
    const { error: updateFailedError } = await client
      .from("bookmarks")
      .update({
        status: "failed",
        error_message: formatErrorMessage(err),
        processed_at: new Date().toISOString(),
      })
      .eq("id", bookmark.id);

    if (updateFailedError) {
      console.error(`Failed to mark bookmark ${bookmark.id} as failed:`, updateFailedError.message);
    }
  }
}

export async function pollOnce(
  client: SupabaseClient = supabase,
  runners: {
    parseYoutubeFn?: typeof parseYoutube;
    parseArticleFn?: typeof parseArticle;
    fetchMetaFn?: typeof fetchMeta;
    uploadThumbnailFn?: (url: string) => Promise<string>;
    renderHtmlFn?: typeof renderWithBrowser;
  } = {},
) {
  if (isPolling) return;
  if (supabaseCircuitBreaker.getState() === "OPEN") {
    console.warn("Supabase database circuit breaker is OPEN. Skipping poll cycle.");
    return;
  }
  isPolling = true;
  try {
    await supabaseCircuitBreaker.execute(async () => {
      await recoverStaleProcessing(client);

      const { data: pending, error } = await client
        .from("bookmarks")
        .select("id, url, type")
        .eq("status", "pending")
        .limit(BATCH_SIZE);

      if (error) {
        throw new Error(`Failed to fetch pending bookmarks: ${error.message}`);
      }

      for (const bookmark of pending ?? []) {
        try {
          await processBookmark(bookmark, client, runners);
        } catch (err) {
          console.error(`Unexpected failure processing bookmark ${bookmark.id}:`, err);
        }
      }
    });
  } catch (err) {
    if (err instanceof CircuitBreakerOpenError) {
      console.warn(`[pollOnce] ${err.message}`);
    } else {
      console.error("Poll cycle error:", err);
    }
  } finally {
    isPolling = false;
  }
}

if (import.meta.main) {
  pollOnce().catch((err) => console.error("Initial poll cycle failed", err));

  setInterval(() => {
    pollOnce().catch((err) => console.error("Poll cycle failed", err));
  }, POLL_INTERVAL_MS);

  process.on("SIGINT", async () => {
    await closeBrowser();
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    await closeBrowser();
    process.exit(0);
  });

  console.log(`worker started, polling every ${POLL_INTERVAL_MS / 1000}s`);
}
