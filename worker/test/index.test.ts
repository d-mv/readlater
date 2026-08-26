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

describe("processBookmark", () => {
  test("marks bookmark as ready when parsing succeeds", async () => {
    const updates: Record<string, unknown>[] = [];

    const mockClient = {
      from: (table: string) => {
        expect(table).toBe("bookmarks");
        return {
          update: (payload: Record<string, unknown>) => {
            updates.push(payload);
            return {
              eq: (_col: string, _val: unknown) => Promise.resolve({ error: null }),
            };
          },
        };
      },
      // deno-lint-ignore no-explicit-any
    } as any;

    const bookmark: Bookmark = {
      id: "bm-1",
      url: "https://example.com/article",
      type: "article",
    };

    await processBookmark(bookmark, mockClient, {
      parseArticleFn: async () => ({
        title: "Test Title",
        author: "Author",
        excerpt: "Excerpt",
        content_md: "# Test",
        word_count: 10,
        reading_time: 1,
      }),
    });

    expect(updates).toHaveLength(2);
    expect(updates[0]).toMatchObject({ status: "processing" });
    expect(updates[1]).toMatchObject({
      status: "ready",
      title: "Test Title",
      content_md: "# Test",
    });
  });

  test("marks bookmark as failed when parsing throws", async () => {
    const updates: Record<string, unknown>[] = [];

    const mockClient = {
      from: (_table: string) => ({
        update: (payload: Record<string, unknown>) => {
          updates.push(payload);
          return {
            eq: (_col: string, _val: unknown) => Promise.resolve({ error: null }),
          };
        },
      }),
      // deno-lint-ignore no-explicit-any
    } as any;

    const bookmark: Bookmark = {
      id: "bm-2",
      url: "https://example.com/fail",
      type: "article",
    };

    await processBookmark(bookmark, mockClient, {
      parseArticleFn: async () => {
        throw new Error("HTTP 404 Not Found");
      },
    });

    expect(updates).toHaveLength(2);
    expect(updates[0]).toMatchObject({ status: "processing" });
    expect(updates[1]).toMatchObject({
      status: "failed",
      error_message: "HTTP 404 Not Found",
    });
  });

  test("marks bookmark as failed when ready database update returns an error", async () => {
    const updates: Record<string, unknown>[] = [];

    const mockClient = {
      from: (_table: string) => ({
        update: (payload: Record<string, unknown>) => {
          updates.push(payload);
          if (payload.status === "ready") {
            return {
              eq: () => Promise.resolve({ error: { message: "violates check constraint" } }),
            };
          }
          return {
            eq: () => Promise.resolve({ error: null }),
          };
        },
      }),
      // deno-lint-ignore no-explicit-any
    } as any;

    const bookmark: Bookmark = {
      id: "bm-3",
      url: "https://example.com/constraint-fail",
      type: "article",
    };

    await processBookmark(bookmark, mockClient, {
      parseArticleFn: async () => ({
        title: "Test Title",
        author: "Author",
        excerpt: "Excerpt",
        content_md: "# Test",
        word_count: 10,
        reading_time: 1,
      }),
    });

    // 1st: processing, 2nd: ready (which failed), 3rd: failed with DB error message
    expect(updates).toHaveLength(3);
    expect(updates[0]).toMatchObject({ status: "processing" });
    expect(updates[1]).toMatchObject({ status: "ready" });
    expect(updates[2]).toMatchObject({
      status: "failed",
      error_message: "Database update failed: violates check constraint",
    });
  });
});

describe("pollOnce", () => {
  test("continues processing other bookmarks if one bookmark fails", async () => {
    const processedIds: string[] = [];

    const mockClient = {
      from: (table: string) => {
        if (table === "bookmarks") {
          return {
            update: (_payload: Record<string, unknown>) => ({
              eq: (_col: string, _val: unknown) => ({
                or: (_filterStr: string) => Promise.resolve({ error: null }),
              }),
            }),
            select: () => ({
              eq: () => ({
                limit: () =>
                  Promise.resolve({
                    data: [
                      { id: "bm-1", url: "https://example.com/1", type: "article" },
                      { id: "bm-2", url: "https://example.com/2", type: "article" },
                    ],
                    error: null,
                  }),
              }),
            }),
          };
        }
        return {};
      },
      // deno-lint-ignore no-explicit-any
    } as any;

    await pollOnce(mockClient, {
      parseArticleFn: async (url) => {
        processedIds.push(url);
        if (url.includes("1")) throw new Error("Item 1 failed");
        return {
          title: "Title 2",
          author: "Author 2",
          excerpt: "Excerpt 2",
          content_md: "Content 2",
          word_count: 5,
          reading_time: 1,
        };
      },
    });

    expect(processedIds).toEqual(["https://example.com/1", "https://example.com/2"]);
  });

  test("returns the number of pending bookmarks it picked up", async () => {
    const mockClient = {
      from: () => ({
        update: () => ({ eq: () => ({ or: () => Promise.resolve({ error: null }) }) }),
        select: () => ({
          eq: () => ({
            limit: () =>
              Promise.resolve({
                data: [
                  { id: "bm-1", url: "https://example.com/1", type: "article" },
                  { id: "bm-2", url: "https://example.com/2", type: "article" },
                ],
                error: null,
              }),
          }),
        }),
      }),
      // deno-lint-ignore no-explicit-any
    } as any;

    const count = await pollOnce(mockClient, {
      parseArticleFn: async () => ({
        title: "t",
        author: "a",
        excerpt: "e",
        content_md: "c",
        word_count: 1,
        reading_time: 1,
      }),
    });

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
