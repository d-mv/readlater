import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import {
  recoverStaleProcessing,
  processBookmark,
  pollOnce,
  formatErrorMessage,
  resetWorkerState,
  RETRY_BACKOFF_MS,
  shutdown,
  type Bookmark,
} from "../src/index";
import { CircuitBreakerOpenError } from "../src/circuitBreaker";
import { HttpStatusError } from "../src/errors";
import { log } from "../src/logger";
import { TimeoutError } from "../src/timeout";

afterEach(() => {
  resetWorkerState();
  mock.restore();
});

describe("formatErrorMessage", () => {
  test("extracts message from Error object and strips null bytes", () => {
    const err = new Error("Something went \0wrong");
    expect(formatErrorMessage(err)).toBe("Something went wrong");
  });

  test("converts non-Error values to string and truncates", () => {
    expect(formatErrorMessage("bad".repeat(300)).length).toBeLessThanOrEqual(500);
  });
});

describe("recoverStaleProcessing", () => {
  type Stale = { id: string; attempts: number | null };

  // select(...).eq("status","processing").or(stale) lists the stuck rows;
  // each is then moved with a compare-and-set on "processing".
  function staleClient(
    rows: Stale[],
    opts: { listError?: string; moves?: boolean; failMoveOf?: string } = {},
  ) {
    const listFilters: { eq?: [string, unknown]; or?: string } = {};
    const updates: Update[] = [];
    const client = {
      from: (table: string) => {
        expect(table).toBe("bookmarks");
        return {
          select: (_cols: string) => ({
            eq: (col: string, val: unknown) => {
              listFilters.eq = [col, val];
              return {
                or: (filter: string) => {
                  listFilters.or = filter;
                  return Promise.resolve(
                    opts.listError
                      ? { data: null, error: { message: opts.listError } }
                      : { data: rows, error: null },
                  );
                },
              };
            },
          }),
          update: (payload: Record<string, unknown>) => {
            const update: Update = { payload, filters: {} };
            updates.push(update);
            const chain = {
              eq: (col: string, val: unknown) => {
                update.filters[col] = val;
                return chain;
              },
              select: () =>
                Promise.resolve(
                  update.filters.id === opts.failMoveOf
                    ? { data: null, error: { message: "statement timeout" } }
                    : {
                        data: opts.moves === false ? [] : [{ id: update.filters.id }],
                        error: null,
                      },
                ),
            };
            return chain;
          },
        };
      },
      // deno-lint-ignore no-explicit-any
    } as any;
    return { client, listFilters, updates };
  }

  test("only looks at rows stuck in processing past the threshold", async () => {
    const { client, listFilters } = staleClient([]);

    await recoverStaleProcessing(client);

    expect(listFilters.eq).toEqual(["status", "processing"]);
    expect(String(listFilters.or)).toContain("processed_at.is.null");
    expect(String(listFilters.or)).toContain("processed_at.lt.");
  });

  test("a stuck row with attempts left goes back to pending with a backoff", async () => {
    const { client, updates } = staleClient([{ id: "a", attempts: 0 }]);
    const before = Date.now();

    await recoverStaleProcessing(client);

    expect(updates).toHaveLength(1);
    expect(updates[0]?.filters).toEqual({ id: "a", status: "processing" });
    expect(updates[0]?.payload).toMatchObject({
      status: "pending",
      attempts: 1,
      error_message: "Processing timed out or worker restarted",
    });
    const next = Date.parse(String(updates[0]?.payload.next_attempt_at));
    expect(next).toBeGreaterThanOrEqual(before + RETRY_BACKOFF_MS[0]);
  });

  test("a stuck row that used its retries is marked failed", async () => {
    const { client, updates } = staleClient([{ id: "b", attempts: RETRY_BACKOFF_MS.length }]);

    await recoverStaleProcessing(client);

    expect(updates[0]?.payload).toMatchObject({
      status: "failed",
      attempts: RETRY_BACKOFF_MS.length + 1,
    });
    expect(updates[0]?.payload).not.toHaveProperty("next_attempt_at");
  });

  test("a null attempts count is treated as zero", async () => {
    const { client, updates } = staleClient([{ id: "c", attempts: null }]);

    await recoverStaleProcessing(client);

    expect(updates[0]?.payload).toMatchObject({ status: "pending", attempts: 1 });
  });

  test("a row that fails to move is logged and the sweep goes on", async () => {
    const error = spyOn(log, "error");
    const { client, updates } = staleClient(
      [
        { id: "a", attempts: 0 },
        { id: "b", attempts: 0 },
      ],
      { failMoveOf: "a" },
    );

    await recoverStaleProcessing(client);

    expect(updates.map((u) => u.filters.id)).toEqual(["a", "b"]);
    expect(error).toHaveBeenCalledWith("stale-processing recovery failed for a bookmark", {
      bookmarkId: "a",
      err: "statement timeout",
    });
  });

  test("a listing error writes nothing", async () => {
    const { client, updates } = staleClient([{ id: "a", attempts: 0 }], { listError: "down" });

    await recoverStaleProcessing(client);

    expect(updates).toHaveLength(0);
  });
});

type Update = { payload: Record<string, unknown>; filters: Record<string, unknown> };

/**
 * Fake Supabase client for the bookmarks table. Records every update with its
 * .eq() filters; a guarded update (…).eq("status", x).select("id") "moves" a
 * row unless `moves` says otherwise, and can be made to fail via `errorFor`.
 */
function fakeClient(
  opts: {
    pending?: Bookmark[];
    moves?: (u: Update) => boolean;
    errorFor?: (u: Update) => string | { message: string; code: string } | null;
  } = {},
) {
  const updates: Update[] = [];
  const pollFilters: string[] = [];
  const pollOrders: [string, boolean][] = [];
  const client = {
    from: (_table: string) => ({
      update: (payload: Record<string, unknown>) => {
        const update: Update = { payload, filters: {} };
        updates.push(update);
        const result = () => {
          const failure = opts.errorFor?.(update) ?? null;
          if (failure) {
            const error =
              typeof failure === "string" ? { message: failure, code: "23514" } : failure;
            return { data: null, error };
          }
          const moved = opts.moves ? opts.moves(update) : true;
          return { data: moved ? [{ id: update.filters.id }] : [], error: null };
        };
        const chain = {
          eq: (col: string, val: unknown) => {
            update.filters[col] = val;
            return chain;
          },
          or: (_filter: string) => Promise.resolve({ error: null }),
          select: (_cols: string) => Promise.resolve(result()),
        };
        return chain;
      },
      select: () => ({
        eq: () => ({
          or: (filter: string) => {
            pollFilters.push(filter);
            return {
              order: (col: string, options: { ascending: boolean }) => {
                pollOrders.push([col, options.ascending]);
                return {
                  limit: () => Promise.resolve({ data: opts.pending ?? [], error: null }),
                };
              },
            };
          },
        }),
      }),
    }),
  };
  // deno-lint-ignore no-explicit-any
  return { client: client as any, updates, pollFilters, pollOrders };
}

const parsed = async () => ({
  title: "Test Title",
  author: "Author",
  excerpt: "Excerpt",
  content_md: "# Test",
  word_count: 10,
  reading_time: 1,
});

describe("processBookmark", () => {
  const article: Bookmark = {
    id: "bm-1",
    url: "https://example.com/article",
    type: "article",
    attempts: 0,
  };

  test("claims pending → processing, then finishes processing → ready", async () => {
    const { client, updates } = fakeClient();

    await processBookmark(article, client, { parseArticleFn: parsed });

    expect(updates).toHaveLength(2);
    expect(updates[0]?.payload).toMatchObject({ status: "processing" });
    expect(updates[0]?.filters).toEqual({ id: "bm-1", status: "pending" });
    expect(updates[1]?.payload).toMatchObject({
      status: "ready",
      title: "Test Title",
      content_md: "# Test",
    });
    // Only this claim may finish it: the lease is the claim's processed_at.
    expect(updates[1]?.filters).toEqual({
      id: "bm-1",
      status: "processing",
      processed_at: updates[0]?.payload.processed_at,
    });
  });

  test("a claim that was taken over meanwhile (refresh + another worker) can't finish it", async () => {
    // The row is processing again, but under a newer claim: no lease match.
    const { client, updates } = fakeClient({
      moves: (u) => u.payload.status === "processing" || u.filters.processed_at === "newer-claim",
    });

    await processBookmark(article, client, { parseArticleFn: parsed });

    expect(updates[1]?.filters.processed_at).toBe(updates[0]?.payload.processed_at);
    expect(updates).toHaveLength(2);
  });

  test("clears a translation of the previous body when a refresh finishes", async () => {
    const { client, updates } = fakeClient();

    await processBookmark(article, client, { parseArticleFn: parsed });

    expect(updates[1]?.payload).toMatchObject({
      status: "ready",
      translated_content_md: null,
      translated_lang: null,
    });
  });

  test("marks bookmark as failed (only while still processing) when parsing throws", async () => {
    const { client, updates } = fakeClient();

    await processBookmark(article, client, {
      parseArticleFn: async () => {
        throw new Error("HTTP 404 Not Found");
      },
    });

    expect(updates).toHaveLength(2);
    expect(updates[1]?.payload).toMatchObject({
      status: "failed",
      error_message: "HTTP 404 Not Found",
    });
    expect(updates[1]?.filters).toEqual({
      id: "bm-1",
      status: "processing",
      processed_at: updates[0]?.payload.processed_at,
    });
  });

  test("marks bookmark as failed when ready database update returns an error", async () => {
    const { client, updates } = fakeClient({
      errorFor: (u) => (u.payload.status === "ready" ? "violates check constraint" : null),
    });

    await processBookmark(article, client, { parseArticleFn: parsed });

    // 1st: processing, 2nd: ready (which failed), 3rd: failed with DB error message
    expect(updates).toHaveLength(3);
    expect(updates[2]?.payload).toMatchObject({
      status: "failed",
      error_message: "Database update failed: violates check constraint",
    });
  });

  test.each([
    [
      "a statement timeout",
      { message: "canceling statement due to statement timeout", code: "57014" },
    ],
    ["a dropped connection", { message: "TypeError: fetch failed", code: "" }],
    ["a deadlock", { message: "deadlock detected", code: "40P01" }],
  ])("re-queues instead of failing when saving the result hits %s", async (_label, failure) => {
    const { client, updates } = fakeClient({
      errorFor: (u) => (u.payload.status === "ready" ? failure : null),
    });

    await processBookmark(article, client, { parseArticleFn: parsed });

    expect(updates).toHaveLength(3);
    expect(updates[2]?.payload).toMatchObject({
      status: "pending",
      attempts: 1,
      error_message: `Database update failed: ${failure.message}`,
    });
  });

  test("skips a bookmark another worker (or a refresh) already took", async () => {
    let parseCalls = 0;
    const { client, updates } = fakeClient({ moves: (u) => u.payload.status !== "processing" });

    await processBookmark(article, client, {
      parseArticleFn: async () => {
        parseCalls += 1;
        return parsed();
      },
    });

    expect(parseCalls).toBe(0);
    expect(updates).toHaveLength(1);
  });

  test("skips parsing when the claim itself fails", async () => {
    let parseCalls = 0;
    const { client, updates } = fakeClient({
      errorFor: (u) => (u.payload.status === "processing" ? "connection reset" : null),
    });

    await processBookmark(article, client, {
      parseArticleFn: async () => {
        parseCalls += 1;
        return parsed();
      },
    });

    expect(parseCalls).toBe(0);
    expect(updates).toHaveLength(1);
  });

  test("drops the result when the row was re-queued while processing", async () => {
    // A refresh reset the row to pending mid-parse: the finish matches no row.
    const { client, updates } = fakeClient({ moves: (u) => u.payload.status !== "ready" });

    await processBookmark(article, client, { parseArticleFn: parsed });

    expect(updates.map((u) => u.payload.status)).toEqual(["processing", "ready"]);
  });

  test("fails a pending row of a type the worker can't process instead of parsing it", async () => {
    let parseCalls = 0;
    const { client, updates } = fakeClient();
    const note = { id: "n-1", url: null, type: "note" } as unknown as Bookmark;

    await processBookmark(note, client, {
      parseArticleFn: async () => {
        parseCalls += 1;
        return parsed();
      },
    });

    expect(parseCalls).toBe(0);
    expect(updates).toHaveLength(1);
    expect(updates[0]?.payload).toMatchObject({ status: "failed" });
    expect(updates[0]?.filters).toEqual({ id: "n-1", status: "pending" });
  });
});

describe("pollOnce", () => {
  test("continues processing other bookmarks if one bookmark fails", async () => {
    const processedIds: string[] = [];
    const { client } = fakeClient({
      pending: [
        { id: "bm-1", url: "https://example.com/1", type: "article", attempts: 0 },
        { id: "bm-2", url: "https://example.com/2", type: "article", attempts: 0 },
      ],
    });

    await pollOnce(client, {
      parseArticleFn: async (url) => {
        processedIds.push(url);
        if (url.includes("1")) throw new Error("Item 1 failed");
        return parsed();
      },
    });

    expect(processedIds).toEqual(["https://example.com/1", "https://example.com/2"]);
  });

  test("a bookmark whose processing throws outright doesn't stop the batch", async () => {
    const parsedUrls: string[] = [];
    const { client } = fakeClient({
      pending: [
        { id: "bm-1", url: "https://example.com/1", type: "article", attempts: 0 },
        { id: "bm-2", url: "https://example.com/2", type: "article", attempts: 0 },
      ],
    });
    const table = client.from("bookmarks");
    let updates = 0;
    client.from = () => ({
      ...table,
      update: (payload: Record<string, unknown>) => {
        updates += 1;
        if (updates === 1) throw new Error("socket hang up");
        return table.update(payload);
      },
    });

    const count = await pollOnce(client, {
      parseArticleFn: async (url) => {
        parsedUrls.push(url);
        return parsed();
      },
    });

    expect(count).toBe(2);
    expect(parsedUrls).toEqual(["https://example.com/2"]);
  });

  test("returns the number of pending bookmarks it picked up", async () => {
    const { client } = fakeClient({
      pending: [
        { id: "bm-1", url: "https://example.com/1", type: "article", attempts: 0 },
        { id: "bm-2", url: "https://example.com/2", type: "article", attempts: 0 },
      ],
    });

    const count = await pollOnce(client, { parseArticleFn: parsed });

    expect(count).toBe(2);
  });

  test("runs stale-processing recovery periodically, not on every cycle", async () => {
    let recoveryCalls = 0;
    const mockClient = {
      from: () => ({
        select: (cols: string) => {
          if (cols === "id, attempts") recoveryCalls += 1;
          return {
            eq: () => ({
              or: () => ({
                // Recovery awaits the listing directly; the poll orders and limits it.
                then: (resolve: (v: unknown) => unknown) => resolve({ data: [], error: null }),
                order: () => ({ limit: () => Promise.resolve({ data: [], error: null }) }),
              }),
            }),
          };
        },
      }),
      // deno-lint-ignore no-explicit-any
    } as any;

    for (let i = 0; i < 4; i++) await pollOnce(mockClient);

    // Exactly one of any four consecutive cycles triggers recovery.
    expect(recoveryCalls).toBe(1);
  });

  test("trips supabaseCircuitBreaker when database queries fail repeatedly", async () => {
    const mockFailingClient = {
      from: () => ({
        update: () => ({
          eq: () => ({
            or: () => Promise.resolve({ error: { message: "connection refused" } }),
          }),
        }),
        select: () => ({
          eq: () => ({
            or: () => ({
              order: () => ({
                limit: () =>
                  Promise.resolve({ data: null, error: { message: "connection refused" } }),
              }),
            }),
          }),
        }),
      }),
      // deno-lint-ignore no-explicit-any
    } as any;

    const { supabaseCircuitBreaker } = await import("../src/index");
    supabaseCircuitBreaker.reset();

    // 1st failure
    await pollOnce(mockFailingClient);
    expect(supabaseCircuitBreaker.getState()).toBe("CLOSED");

    // 2nd failure
    await pollOnce(mockFailingClient);
    expect(supabaseCircuitBreaker.getState()).toBe("CLOSED");

    // 3rd failure - trips breaker
    await pollOnce(mockFailingClient);
    expect(supabaseCircuitBreaker.getState()).toBe("OPEN");

    // Next poll cycle should skip execution immediately
    await pollOnce(mockFailingClient);
    expect(supabaseCircuitBreaker.getState()).toBe("OPEN");

    // Clean up
    supabaseCircuitBreaker.reset();
  });
});

describe("processBookmark retries", () => {
  const bookmarkWith = (attempts: number): Bookmark => ({
    id: "bm-r",
    url: "https://example.com/flaky",
    type: "article",
    attempts,
  });
  const failingWith = (err: unknown) => async () => {
    throw err;
  };

  test.each([
    [0, RETRY_BACKOFF_MS[0]],
    [1, RETRY_BACKOFF_MS[1]],
    [2, RETRY_BACKOFF_MS[2]],
  ])(
    "a transient failure on attempt %#+1 re-queues the row with backoff",
    async (attempts, delay) => {
      const { client, updates } = fakeClient();
      const before = Date.now();

      await processBookmark(bookmarkWith(attempts), client, {
        parseArticleFn: failingWith(new HttpStatusError(503, "Service Unavailable")),
      });

      expect(updates).toHaveLength(2);
      const requeue = updates[1]!;
      expect(requeue.filters).toEqual({
        id: "bm-r",
        status: "processing",
        processed_at: updates[0]?.payload.processed_at,
      });
      expect(requeue.payload).toMatchObject({
        status: "pending",
        attempts: attempts + 1,
        error_message: "HTTP 503 Service Unavailable",
      });
      const next = Date.parse(String(requeue.payload.next_attempt_at));
      expect(next).toBeGreaterThanOrEqual(before + delay);
      expect(next).toBeLessThanOrEqual(Date.now() + delay);
    },
  );

  test("a failed re-queue is logged and the row is left for the stale sweep", async () => {
    const error = spyOn(log, "error");
    const { client, updates } = fakeClient({
      errorFor: (u) => (u.payload.status === "pending" ? "connection reset" : null),
    });

    await processBookmark(bookmarkWith(0), client, {
      parseArticleFn: failingWith(new HttpStatusError(503, "Service Unavailable")),
    });

    // No fallback write to "failed": the row stays in processing until the
    // stale sweep returns it to the queue.
    expect(updates.map((u) => u.payload.status)).toEqual(["processing", "pending"]);
    expect(error).toHaveBeenCalledWith("failed to re-queue bookmark", {
      bookmarkId: "bm-r",
      err: "connection reset",
    });
  });

  test("a failed write of the failure is logged, not thrown", async () => {
    const error = spyOn(log, "error");
    const { client, updates } = fakeClient({
      errorFor: (u) => (u.payload.status === "failed" ? "connection reset" : null),
    });

    await processBookmark(bookmarkWith(0), client, {
      parseArticleFn: failingWith(new HttpStatusError(404, "Not Found")),
    });

    expect(updates.map((u) => u.payload.status)).toEqual(["processing", "failed"]);
    expect(error).toHaveBeenCalledWith("failed to mark bookmark as failed", {
      bookmarkId: "bm-r",
      err: "connection reset",
    });
  });

  test("the fourth transient failure fails the row for good", async () => {
    const { client, updates } = fakeClient();

    await processBookmark(bookmarkWith(3), client, {
      parseArticleFn: failingWith(new TimeoutError("Processing timed out after 45s")),
    });

    expect(updates[1]?.payload).toMatchObject({ status: "failed", attempts: 4 });
    expect(updates[1]?.payload).not.toHaveProperty("next_attempt_at");
  });

  test.each([
    ["an open circuit breaker", new CircuitBreakerOpenError("playwright-browser", 20_000)],
    ["a 429", new HttpStatusError(429, "Too Many Requests")],
    ["a timeout", new TimeoutError("Browser render timed out")],
    ["a network error", Object.assign(new Error("Unable to connect"), { code: "ECONNRESET" })],
  ])("%s puts the row back to pending", async (_label, err) => {
    const { client, updates } = fakeClient();

    await processBookmark(bookmarkWith(0), client, { parseArticleFn: failingWith(err) });

    expect(updates[1]?.payload).toMatchObject({ status: "pending", attempts: 1 });
  });

  test.each([
    ["a 404", new HttpStatusError(404, "Not Found")],
    ["an extraction failure", new Error("Readability could not extract article content")],
  ])("%s fails the row immediately", async (_label, err) => {
    const { client, updates } = fakeClient();

    await processBookmark(bookmarkWith(0), client, { parseArticleFn: failingWith(err) });

    expect(updates[1]?.payload).toMatchObject({ status: "failed", attempts: 1 });
  });
});

describe("pollOnce queue filter", () => {
  test("takes the oldest saved bookmarks first (FIFO)", async () => {
    const { client, pollOrders } = fakeClient();

    await pollOnce(client);

    expect(pollOrders).toEqual([["created_at", true]]);
  });

  test("only picks up pending rows whose retry backoff has elapsed", async () => {
    const { client, pollFilters } = fakeClient();
    const before = new Date().toISOString();

    await pollOnce(client);

    expect(pollFilters).toHaveLength(1);
    const [isNull, lte] = pollFilters[0]!.split(",");
    expect(isNull).toBe("next_attempt_at.is.null");
    expect(lte).toStartWith("next_attempt_at.lte.");
    expect(lte!.slice("next_attempt_at.lte.".length) >= before).toBe(true);
  });
});

describe("shutdown", () => {
  const two: Bookmark[] = [
    { id: "bm-1", url: "https://example.com/1", type: "article", attempts: 0 },
    { id: "bm-2", url: "https://example.com/2", type: "article", attempts: 0 },
  ];

  test("waits for the in-flight bookmark, then stops without taking the next one", async () => {
    const { client, updates } = fakeClient({ pending: two });
    const parsedUrls: string[] = [];
    let finish: () => void = () => {};
    let browserClosed = false;

    const cycle = pollOnce(client, {
      parseArticleFn: async (url) => {
        parsedUrls.push(url);
        await new Promise<void>((resolve) => (finish = resolve));
        return parsed();
      },
    });
    await Bun.sleep(5);

    const stopping = shutdown(client, {
      drainMs: 1_000,
      closeBrowserFn: async () => {
        browserClosed = true;
      },
    });
    finish();
    await stopping;
    await cycle;

    expect(parsedUrls).toEqual(["https://example.com/1"]);
    expect(updates.map((u) => u.payload.status)).toEqual(["processing", "ready"]);
    expect(browserClosed).toBe(true);
  });

  test("hands a bookmark that outlives the drain window back to the queue", async () => {
    const { client, updates } = fakeClient({ pending: two });
    let browserClosed = false;

    void pollOnce(client, {
      parseArticleFn: () => new Promise(() => {}), // never finishes
    });
    await Bun.sleep(5);

    await shutdown(client, {
      drainMs: 30,
      closeBrowserFn: async () => {
        browserClosed = true;
      },
    });

    expect(updates.map((u) => [u.filters.status, u.payload.status])).toEqual([
      ["pending", "processing"],
      ["processing", "pending"],
    ]);
    // An explicit next_attempt_at marks it as a hand-back, not a user refresh,
    // and no attempt is spent.
    expect(updates[1]?.payload.next_attempt_at).toBeString();
    expect(updates[1]?.payload).not.toHaveProperty("attempts");
    expect(browserClosed).toBe(true);
  });
});
