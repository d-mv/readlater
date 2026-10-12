import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { CircuitBreaker, CircuitBreakerOpenError } from "./circuitBreaker";
import { parseArticle, type ParsedArticle } from "./parseArticle";
import { parseYoutube, type ParsedYoutube } from "./parseYoutube";
import { fetchMeta } from "./youtubeMeta";
import { makeThumbnailUploader } from "./storage";
import { closeBrowser, renderWithBrowser } from "./browserRender";
import { writeFileSync } from "node:fs";
import { isTransientError } from "./errors";
import { log } from "./logger";
import { withTimeout } from "./timeout";
import { startWatchdog, type Watchdog } from "./watchdog";

export { CircuitBreaker, CircuitBreakerOpenError };

const POLL_INTERVAL_MS = 15_000;
// When the queue stays empty, back the poll interval off toward this ceiling
// instead of hammering the DB every 15s around the clock.
const MAX_POLL_INTERVAL_MS = 60_000;
// Stale-processing recovery is a safety net for crashes, not something that
// needs to run every cycle — once a minute is plenty.
const STALE_RECOVERY_EVERY = 4;
const BATCH_SIZE = 5;
const ERROR_MESSAGE_MAX_LENGTH = 500;
const BOOKMARK_TIMEOUT_MS = 45_000;
const DB_REQUEST_TIMEOUT_MS = 15_000;
// A transient failure (open breaker, 429, 5xx, network, timeout) puts the row
// back in the queue after these delays; the attempt after the last one is
// final, so a bookmark gets MAX_ATTEMPTS tries in total.
export const RETRY_BACKOFF_MS = [60_000, 5 * 60_000, 30 * 60_000] as const;
export const MAX_ATTEMPTS = RETRY_BACKOFF_MS.length + 1;
const MAX_RETRY_BACKOFF_MS = 30 * 60_000;
// On SIGTERM the in-flight bookmark gets this long to finish before it's
// handed back to the queue (Docker's default stop grace period is 10s, so the
// deploy should give the container ~30s: `stop_grace_period`).
export const SHUTDOWN_DRAIN_MS = 20_000;
const HEARTBEAT_PATH = "/tmp/worker-heartbeat";
// A cycle waits at most 60s and a bookmark is capped at 45s, so five minutes
// without a heartbeat means the loop is stuck: exit and let Docker restart
// the container (`restart: unless-stopped`).
export const WATCHDOG_STALL_MS = 5 * 60_000;
const WATCHDOG_CHECK_EVERY_MS = 30_000;

// Every Supabase request gets a hard timeout so a hung connection can't stall
// the poll loop forever (and keep the heartbeat from advancing).
export const fetchWithTimeout: typeof fetch = Object.assign(
  (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) =>
    fetch(input, {
      ...init,
      signal: init?.signal
        ? AbortSignal.any([init.signal, AbortSignal.timeout(DB_REQUEST_TIMEOUT_MS)])
        : AbortSignal.timeout(DB_REQUEST_TIMEOUT_MS),
    }),
  { preconnect: fetch.preconnect },
);

/** The service-role client, or null when the environment doesn't configure one. */
export function supabaseFromEnv(env: NodeJS.ProcessEnv): SupabaseClient | null {
  return env.SUPABASE_URL && env.SUPABASE_SECRET_KEY
    ? createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
        global: { fetch: fetchWithTimeout },
      })
    : null;
}

export const supabase = supabaseFromEnv(process.env) as SupabaseClient;

export const uploadThumbnail = supabase
  ? makeThumbnailUploader(supabase)
  : () => Promise.resolve("");

export const supabaseCircuitBreaker = new CircuitBreaker({
  name: "supabase-db",
  failureThreshold: 3,
  resetTimeoutMs: 60_000,
  onStateChange: (from, to) => {
    log.warn("circuit breaker state changed", { breaker: "supabase-db", from, to });
  },
});

// Rows the worker can process. A pending row of any other type (the schema
// also allows note/pdf, which are inserted ready and have nothing to fetch)
// is failed explicitly rather than handed to a parser.
const PROCESSABLE_TYPES = ["article", "youtube"] as const;

export interface Bookmark {
  id: string;
  url: string;
  type: (typeof PROCESSABLE_TYPES)[number];
  /** Tries already spent on this row (failed transiently and re-queued). */
  attempts: number;
}

type BookmarkStatus = "pending" | "processing" | "ready" | "failed";

// Compare-and-set on the row's status: the write only applies while the row
// is still in `from`, so the status itself is the ownership token. A refresh
// that re-queues a row mid-parse, a second worker during a deploy, or the
// stale-processing sweep all make a later write here match nothing instead
// of clobbering the newer state.
export async function transition(
  client: SupabaseClient,
  id: string,
  from: BookmarkStatus,
  to: BookmarkStatus,
  fields: Record<string, unknown> = {},
): Promise<{ moved: boolean; error: string | null }> {
  const { data, error } = await client
    .from("bookmarks")
    .update({ ...fields, status: to })
    .eq("id", id)
    .eq("status", from)
    .select("id");
  if (error) return { moved: false, error: error.message };
  return { moved: (data?.length ?? 0) > 0, error: null };
}

let pollCycleCount = 0;

// Shutdown coordination: pollOnce stops picking up bookmarks once `stopping`
// is set, and `inFlight` is the bookmark being processed right now.
const worker: {
  stopping: boolean;
  inFlight: { id: string; done: Promise<void> } | null;
} = { stopping: false, inFlight: null };

let heartbeatPath: string | null = null;
let watchdog: Watchdog | null = null;

/** Feeds the watchdog and touches the heartbeat file the Docker HEALTHCHECK watches. */
function heartbeat() {
  watchdog?.beat();
  if (!heartbeatPath) return;
  try {
    writeFileSync(heartbeatPath, String(Date.now()));
  } catch (err) {
    log.warn("failed to write heartbeat", { err });
  }
}

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

// Bookmarks stuck in 'processing' (an ungraceful container restart or a
// worker crash) go through the same retry budget as a transient failure: back
// to 'pending' with a backoff while attempts remain, 'failed' after that. Each
// row moves with a compare-and-set on 'processing', so a row a live worker
// finishes meanwhile is left alone.
const STALE_MESSAGE = "Processing timed out or worker restarted";

export async function recoverStaleProcessing(client: SupabaseClient = supabase) {
  const staleThreshold = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const { data, error } = await client
    .from("bookmarks")
    .select("id, attempts")
    .eq("status", "processing")
    .or(`processed_at.is.null,processed_at.lt.${staleThreshold}`);

  if (error) {
    log.error("stale-processing recovery failed", { err: error.message });
    return;
  }

  for (const row of (data ?? []) as { id: string; attempts: number | null }[]) {
    const attempts = (row.attempts ?? 0) + 1;
    const fields = {
      attempts,
      error_message: STALE_MESSAGE,
      processed_at: new Date().toISOString(),
    };
    const result =
      attempts < MAX_ATTEMPTS
        ? await transition(client, row.id, "processing", "pending", {
            ...fields,
            next_attempt_at: nextAttemptAt(attempts),
          })
        : await transition(client, row.id, "processing", "failed", fields);
    if (result.error) {
      log.error("stale-processing recovery failed for a bookmark", {
        bookmarkId: row.id,
        err: result.error,
      });
    } else if (result.moved) {
      log.warn("recovered a stale processing bookmark", {
        bookmarkId: row.id,
        attempts,
        retrying: attempts < MAX_ATTEMPTS,
      });
    }
  }
}

function nextAttemptAt(attempts: number): string {
  const delayMs = RETRY_BACKOFF_MS[attempts - 1] ?? MAX_RETRY_BACKOFF_MS;
  return new Date(Date.now() + delayMs).toISOString();
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

  if (!(PROCESSABLE_TYPES as readonly string[]).includes(bookmark.type)) {
    await transition(client, bookmark.id, "pending", "failed", {
      error_message: `Unsupported bookmark type: ${String(bookmark.type)}`,
      processed_at: new Date().toISOString(),
    });
    return;
  }

  const claim = await transition(client, bookmark.id, "pending", "processing", {
    processed_at: new Date().toISOString(),
  });
  if (claim.error) {
    // Still pending — the next cycle retries it.
    log.error("failed to claim bookmark", { bookmarkId: bookmark.id, err: claim.error });
    return;
  }
  if (!claim.moved) {
    log.warn("bookmark is no longer pending; skipping", { bookmarkId: bookmark.id });
    return;
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

    const done = await transition(client, bookmark.id, "processing", "ready", {
      ...sanitizeFields(result as unknown as Record<string, unknown>),
      error_message: null,
      processed_at: new Date().toISOString(),
      // A refresh re-parses the page; a translation of the previous body would
      // otherwise keep showing (the reader prefers the translation).
      translated_content_md: null,
      translated_lang: null,
    });
    if (done.error) throw new Error(`Database update failed: ${done.error}`);
    if (!done.moved) {
      log.warn("bookmark changed while processing; dropping the result", {
        bookmarkId: bookmark.id,
      });
    }
  } catch (err) {
    const attempts = bookmark.attempts + 1;
    const retry = isTransientError(err) && attempts < MAX_ATTEMPTS;
    const fields = {
      attempts,
      error_message: formatErrorMessage(err),
      processed_at: new Date().toISOString(),
    };

    if (retry) {
      const next_attempt_at = nextAttemptAt(attempts);
      log.warn("bookmark processing failed transiently; will retry", {
        bookmarkId: bookmark.id,
        url: bookmark.url,
        attempts,
        nextAttemptAt: next_attempt_at,
        err,
      });
      const requeued = await transition(client, bookmark.id, "processing", "pending", {
        ...fields,
        next_attempt_at,
      });
      if (requeued.error) {
        log.error("failed to re-queue bookmark", { bookmarkId: bookmark.id, err: requeued.error });
      }
      return;
    }

    log.error("bookmark processing failed", {
      bookmarkId: bookmark.id,
      url: bookmark.url,
      attempts,
      err,
    });
    const failed = await transition(client, bookmark.id, "processing", "failed", fields);
    if (failed.error) {
      log.error("failed to mark bookmark as failed", {
        bookmarkId: bookmark.id,
        err: failed.error,
      });
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
): Promise<number> {
  if (supabaseCircuitBreaker.getState() === "OPEN") {
    log.warn("supabase-db circuit breaker is open; skipping poll cycle");
    return 0;
  }
  let pendingCount = 0;
  try {
    await supabaseCircuitBreaker.execute(async () => {
      pollCycleCount += 1;
      if (pollCycleCount % STALE_RECOVERY_EVERY === 1) {
        await recoverStaleProcessing(client);
      }

      // Rows waiting out a retry backoff aren't due yet.
      const { data: pending, error } = await client
        .from("bookmarks")
        .select("id, url, type, attempts")
        .eq("status", "pending")
        .or(`next_attempt_at.is.null,next_attempt_at.lte.${new Date().toISOString()}`)
        // FIFO: oldest saved first, so a burst of new captures can't starve
        // an older bookmark (or one coming back from a retry backoff).
        .order("created_at", { ascending: true })
        .limit(BATCH_SIZE);

      if (error) {
        throw new Error(`Failed to fetch pending bookmarks: ${error.message}`);
      }

      pendingCount = pending?.length ?? 0;
      for (const bookmark of pending ?? []) {
        if (worker.stopping) break;
        heartbeat();
        const done = processBookmark(bookmark, client, runners).catch((err: unknown) => {
          log.error("unexpected failure processing bookmark", { bookmarkId: bookmark.id, err });
        });
        worker.inFlight = { id: bookmark.id, done };
        try {
          await done;
        } finally {
          worker.inFlight = null;
        }
      }
    });
  } catch (err) {
    // The breaker can't be open here (checked above), so this is the cycle
    // itself failing.
    log.error("poll cycle failed", { err });
  }
  return pendingCount;
}

/**
 * Graceful stop: no new bookmarks are picked up, the in-flight one gets
 * `drainMs` to finish, and if it doesn't it is handed back to the queue
 * (processing → pending, without spending an attempt) rather than left for
 * the stale-processing sweep to fail. Then the browser is closed.
 */
export async function shutdown(
  client: SupabaseClient = supabase,
  opts: { drainMs?: number; closeBrowserFn?: () => Promise<void> } = {},
): Promise<void> {
  const drainMs = opts.drainMs ?? SHUTDOWN_DRAIN_MS;
  worker.stopping = true;

  const job = worker.inFlight;
  if (job) {
    log.info("shutting down; waiting for in-flight bookmark", { bookmarkId: job.id, drainMs });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finished = await Promise.race([
      job.done.then(() => true),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), drainMs);
      }),
    ]);
    clearTimeout(timer);
    if (!finished) {
      // next_attempt_at is set explicitly so the DB's retry-reset trigger can
      // tell this hand-back apart from a user-initiated refresh.
      const released = await transition(client, job.id, "processing", "pending", {
        next_attempt_at: new Date().toISOString(),
      });
      log.warn("in-flight bookmark did not finish; returned it to the queue", {
        bookmarkId: job.id,
        moved: released.moved,
        err: released.error,
      });
    }
  }

  await (opts.closeBrowserFn ?? closeBrowser)();
}

/** Test hook: clears shutdown and heartbeat state between tests. */
export function resetWorkerState() {
  worker.stopping = false;
  worker.inFlight = null;
  heartbeatPath = null;
  watchdog?.stop();
  watchdog = null;
}

/** Everything main() reaches outside this module; tests substitute it. */
export interface WorkerRuntime {
  env: NodeJS.ProcessEnv;
  client: SupabaseClient;
  heartbeatPath: string;
  schedule: (loop: () => void, ms: number) => ReturnType<typeof setTimeout>;
  cancel: (timer: ReturnType<typeof setTimeout> | undefined) => void;
  onSignal: (signal: "SIGINT" | "SIGTERM", handler: () => void) => void;
  exit: (code: number) => void;
  closeBrowserFn: () => Promise<void>;
  /** Starts the stall watchdog; `onStall` runs once the heartbeat is too old. */
  startWatchdog: (onStall: (silentForMs: number) => void) => Watchdog;
}

/** Starts the poll loop and installs the SIGINT/SIGTERM handlers. */
export function main(overrides: Partial<WorkerRuntime> = {}): void {
  const runtime: WorkerRuntime = {
    env: process.env,
    client: supabase,
    heartbeatPath: HEARTBEAT_PATH,
    schedule: setTimeout,
    cancel: clearTimeout,
    onSignal: process.on.bind(process),
    exit: process.exit.bind(process),
    closeBrowserFn: closeBrowser,
    startWatchdog: (onStall) =>
      startWatchdog({
        stallMs: WATCHDOG_STALL_MS,
        checkEveryMs: WATCHDOG_CHECK_EVERY_MS,
        onStall,
      }),
    ...overrides,
  };

  const missing = ["SUPABASE_URL", "SUPABASE_SECRET_KEY"].filter((name) => !runtime.env[name]);
  if (missing.length > 0) {
    log.error("missing required environment variables; exiting", { missing });
    runtime.exit(1);
    return;
  }

  heartbeatPath = runtime.heartbeatPath;
  watchdog = runtime.startWatchdog((silentForMs) => {
    log.error("poll loop stalled; exiting so the container is restarted", { silentForMs });
    runtime.exit(1);
  });
  // Recursive setTimeout (not setInterval) so cycles never overlap and the
  // delay can grow while the queue is empty. pollOnce never rejects.
  let interval = POLL_INTERVAL_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const loop = async () => {
    heartbeat();
    const pending = await pollOnce(runtime.client);
    heartbeat();
    if (worker.stopping) return;
    interval = pending > 0 ? POLL_INTERVAL_MS : Math.min(interval * 2, MAX_POLL_INTERVAL_MS);
    timer = runtime.schedule(loop, interval);
  };
  void loop();

  let shuttingDown = false;
  const onSignal = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info("received signal; shutting down", { signal });
    runtime.cancel(timer);
    watchdog?.stop();
    try {
      await shutdown(runtime.client, { closeBrowserFn: runtime.closeBrowserFn });
    } finally {
      runtime.exit(0);
    }
  };
  runtime.onSignal("SIGINT", () => void onSignal("SIGINT"));
  runtime.onSignal("SIGTERM", () => void onSignal("SIGTERM"));

  log.info("worker started", { pollIntervalMs: POLL_INTERVAL_MS });
}

if (import.meta.main) main();
