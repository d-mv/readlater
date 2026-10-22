import { describe, expect, test } from "bun:test";
import { ExtractionTimeoutError, isTransientError } from "../src/errors";
import { extractArticle, extractInWorker } from "../src/extract";

const ARTICLE_HTML = `<!doctype html><html><head><title>Worker extraction</title></head><body>
<article><h1>Worker extraction</h1>
<p>${"Readability runs on its own thread so a pathological page can be stopped. ".repeat(8)}</p>
<p>${"The poll loop, heartbeat and SIGTERM drain stay responsive meanwhile. ".repeat(8)}</p>
</article></body></html>`;

// Thousands of tiny nested blocks: no candidate scores well, and Readability
// spends seconds to minutes re-scanning them (measured: 0.6 MB → 18 s).
const PATHOLOGICAL_HTML = `<html><body>${"<div><span>a, b</span></div>".repeat(10_000)}</body></html>`;

describe("extractArticle", () => {
  test("returns the article's title, content and text for a substantial page", () => {
    const article = extractArticle(ARTICLE_HTML, "https://example.com/post");
    expect(article?.title).toBe("Worker extraction");
    expect(article?.textContent).toContain("own thread");
    expect(article?.content).toContain("<p>");
  });

  test("returns null when the page has too little text", () => {
    expect(
      extractArticle("<html><body><p>short</p></body></html>", "https://example.com/"),
    ).toBeNull();
  });
});

describe("extractInWorker", () => {
  test("returns what extractArticle returns, from a separate thread", async () => {
    expect(await extractInWorker(ARTICLE_HTML, "https://example.com/post")).toEqual(
      extractArticle(ARTICLE_HTML, "https://example.com/post"),
    );
  });

  test("returns null for a page with too little text", async () => {
    expect(
      await extractInWorker("<html><body><p>short</p></body></html>", "https://example.com/"),
    ).toBeNull();
  });

  test("stops an extraction that runs past the limit, without blocking this thread", async () => {
    const started = performance.now();
    let ticks = 0;
    const ticker = setInterval(() => ticks++, 20);
    try {
      await expect(
        extractInWorker(PATHOLOGICAL_HTML, "https://example.com/", { timeoutMs: 500 }),
      ).rejects.toBeInstanceOf(ExtractionTimeoutError);
    } finally {
      clearInterval(ticker);
    }
    expect(performance.now() - started).toBeLessThan(5_000);
    // The event loop kept running while the worker thread was busy.
    expect(ticks).toBeGreaterThan(5);
  });

  test("a timed-out extraction is a permanent failure, not a retry", () => {
    expect(isTransientError(new ExtractionTimeoutError(20_000))).toBe(false);
  });

  test("a thread that crashes outside the message handler rejects too", async () => {
    const entry = new URL("./fixtures/crashingWorker.ts", import.meta.url).href;
    await expect(extractInWorker(ARTICLE_HTML, "https://example.com/", { entry })).rejects.toThrow(
      /boom/,
    );
  });

  test("an error thrown inside the worker rejects with its message", async () => {
    await expect(extractInWorker(ARTICLE_HTML, "not a url")).rejects.toThrow(/Invalid URL/i);
  });
});
