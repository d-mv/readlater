import { describe, expect, test } from "bun:test";
import {
  recoverStaleProcessing,
  processBookmark,
  pollOnce,
  withTimeout,
  formatErrorMessage,
  type Bookmark,
} from "../src/index";

describe("withTimeout", () => {
  test("resolves if promise completes before timeout", async () => {
    const res = await withTimeout(Promise.resolve("ok"), 1000, "timed out");
    expect(res).toBe("ok");
  });

  test("rejects with error if promise exceeds timeout", async () => {
    const slowPromise = new Promise((resolve) => setTimeout(resolve, 200));
    await expect(withTimeout(slowPromise, 50, "timed out")).rejects.toThrow("timed out");
  });
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
  test("marks stale bookmarks as failed instead of resetting to pending", async () => {
    let updatedPayload: Record<string, unknown> | null = null;
    let eqFilter: [string, unknown] | null = null;
    let orFilter: string | null = null;

    const mockClient = {
      from: (table: string) => {
        expect(table).toBe("bookmarks");
        return {
          update: (payload: Record<string, unknown>) => {
            updatedPayload = payload;
            return {
              eq: (col: string, val: unknown) => {
                eqFilter = [col, val];
                return {
                  or: (filterStr: string) => {
                    orFilter = filterStr;
                    return Promise.resolve({ error: null });
                  },
                };
              },
            };
          },
        };
      },
      // deno-lint-ignore no-explicit-any
    } as any;

    await recoverStaleProcessing(mockClient);

    expect(updatedPayload).toMatchObject({
      status: "failed",
      error_message: "Processing timed out or worker restarted",
    });
    expect(eqFilter as unknown as [string, unknown]).toEqual(["status", "processing"]);
    expect(String(orFilter)).toContain("processed_at.is.null");
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
    errorFor?: (u: Update) => string | null;
  } = {},
) {
  const updates: Update[] = [];
  const client = {
    from: (_table: string) => ({
      update: (payload: Record<string, unknown>) => {
        const update: Update = { payload, filters: {} };
        updates.push(update);
        const result = () => {
          const message = opts.errorFor?.(update) ?? null;
          if (message) return { data: null, error: { message } };
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
          limit: () => Promise.resolve({ data: opts.pending ?? [], error: null }),
        }),
      }),
    }),
  };
  // deno-lint-ignore no-explicit-any
  return { client: client as any, updates };
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
  const article: Bookmark = { id: "bm-1", url: "https://example.com/article", type: "article" };

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
    expect(updates[1]?.filters).toEqual({ id: "bm-1", status: "processing" });
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
    expect(updates[1]?.filters).toEqual({ id: "bm-1", status: "processing" });
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
        { id: "bm-1", url: "https://example.com/1", type: "article" },
        { id: "bm-2", url: "https://example.com/2", type: "article" },
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

  test("returns the number of pending bookmarks it picked up", async () => {
    const { client } = fakeClient({
      pending: [
        { id: "bm-1", url: "https://example.com/1", type: "article" },
        { id: "bm-2", url: "https://example.com/2", type: "article" },
      ],
    });

    const count = await pollOnce(client, { parseArticleFn: parsed });

    expect(count).toBe(2);
  });

  test("runs stale-processing recovery periodically, not on every cycle", async () => {
    let recoveryCalls = 0;
    const mockClient = {
      from: () => ({
        update: (payload: Record<string, unknown>) => ({
          eq: () => ({
            or: () => {
              if (payload.error_message === "Processing timed out or worker restarted") {
                recoveryCalls += 1;
              }
              return Promise.resolve({ error: null });
            },
          }),
        }),
        select: () => ({
          eq: () => ({ limit: () => Promise.resolve({ data: [], error: null }) }),
        }),
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
            limit: () => Promise.resolve({ data: null, error: { message: "connection refused" } }),
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
