// Drives the real headless Chromium (Playwright's) against a local server.
// Pages are requested by hostname (site.test); the test egress policy has the
// proxy resolve those names to the local server, so the real proxy, request
// guard and WebSocket block are all in the path.
import { afterAll, beforeAll, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { chromium, type Browser } from "playwright";
import {
  browserCircuitBreaker,
  closeBrowser,
  renderWithBrowser,
  setEgressPolicyForTests,
} from "../src/browserRender";
import { CircuitBreakerOpenError } from "../src/circuitBreaker";
import {
  BrowserUnavailableError,
  ResponseTooLargeError,
  UnsupportedContentTypeError,
} from "../src/errors";
import { MAX_HTML_BYTES } from "../src/http";
import { TimeoutError } from "../src/timeout";

const SLOW = 20_000;
const ARTICLE_TEXT = "Readable text that the article page serves to every visitor.";

let server: ReturnType<typeof Bun.serve>;
let base: string;
const hits = new Map<string, number>();
let wsUpgrades = 0;
let proxyLookups: string[] = [];
let onHang: () => void = () => {};
const launched: Browser[] = [];
const browserPids = new Map<Browser, number>();
const realLaunch = chromium.launch.bind(chromium);
let launchSpy: ReturnType<typeof spyOn<typeof chromium, "launch">>;

function childPids(): Set<number> {
  const out = Bun.spawnSync(["pgrep", "-P", String(process.pid)]).stdout.toString();
  return new Set(out.split("\n").filter(Boolean).map(Number));
}

/** The real launch, recording each browser and its process id. */
async function recordingLaunch(options?: Parameters<typeof chromium.launch>[0]) {
  const before = childPids();
  const browser = await realLaunch(options);
  const pid = [...childPids()].find((candidate) => !before.has(candidate));
  if (pid) browserPids.set(browser, pid);
  launched.push(browser);
  return browser;
}

/** Makes the next launch call `onStart` first, then behave as `then` says. */
function nextLaunch(then: "succeed" | Error): Promise<void> {
  return new Promise((onStart) => {
    launchSpy.mockImplementationOnce(async (options) => {
      onStart();
      if (then === "succeed") return recordingLaunch(options);
      await Bun.sleep(20);
      throw then;
    });
  });
}

const html = (body: string, head = "") =>
  new Response(`<!doctype html><html><head>${head}</head><body>${body}</body></html>`, {
    headers: { "content-type": "text/html; charset=utf-8" },
  });

/** A response that sends `first`, then never finishes (or finishes after `endAfterMs`). */
function streaming(first: string, endAfterMs?: number) {
  return new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(first));
        if (endAfterMs !== undefined) {
          setTimeout(() => {
            controller.enqueue(new TextEncoder().encode("</body></html>"));
            controller.close();
          }, endAfterMs);
        }
      },
    }),
    { headers: { "content-type": "text/html" } },
  );
}

const lastBrowser = () => launched[launched.length - 1]!;

beforeAll(() => {
  server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(req) {
      const { pathname } = new URL(req.url);
      hits.set(pathname, (hits.get(pathname) ?? 0) + 1);
      switch (pathname) {
        case "/article":
          return html(
            `<article><p>${ARTICLE_TEXT}</p></article>` +
              `<script>document.body.insertAdjacentHTML("beforeend", "<p id=spa>rendered by script</p>")</script>`,
          );
        case "/rebind":
          // A synchronous script delays DOMContentLoaded, so its request has
          // been made (and refused) by the time the render returns.
          return html(
            `<p>${ARTICLE_TEXT}</p>`,
            `<script src="http://evil.test:${server.port}/payload.js"></script>`,
          );
        case "/payload.js":
          return new Response("document.title = 'reached the private host'");
        case "/ws-page":
          return streaming(
            `<!doctype html><html><head></head><body><p>${ARTICLE_TEXT}</p><script>
              const ws = new WebSocket("ws://site.test:${server.port}/ws");
              ws.onopen = () => { document.documentElement.dataset.ws = "open"; };
              ws.onclose = () => { document.documentElement.dataset.ws ??= "closed"; };
            </script>`,
            500,
          );
        case "/ws":
          wsUpgrades += 1;
          return new Response("only counted", { status: 400 });
        case "/text":
          return new Response("plain text", { headers: { "content-type": "text/plain" } });
        case "/huge":
          // In a comment: cheap to parse, nothing to lay out.
          return html(`<p>big</p><!--${"x".repeat(MAX_HTML_BYTES)}-->`);
        case "/never-ends":
          return streaming(`<!doctype html><html><head></head><body><p>${ARTICLE_TEXT}</p>`);
        case "/never-ends-empty":
          return streaming("<html>");
        case "/hang":
          onHang();
          return new Promise<Response>(() => {});
        default:
          return new Response("not found", { status: 404 });
      }
    },
  });
  base = `http://site.test:${server.port}`;

  setEgressPolicyForTests({
    proxy: {
      // Only the local server counts as public for the proxy; evil.test
      // resolves to a private address (the rebinding case).
      lookup: async (host) => {
        proxyLookups.push(host);
        return host === "evil.test" ? ["10.0.0.1"] : ["127.0.0.1"];
      },
      isPrivate: (ip) => ip !== "127.0.0.1",
    },
    // The in-page guard sees every hostname as public, so the proxy is what
    // stops evil.test; IP literals are still judged by the real check.
    lookup: async () => ["93.184.216.34"],
  });

  launchSpy = spyOn(chromium, "launch").mockImplementation(recordingLaunch);
});

afterAll(async () => {
  await closeBrowser();
  await Promise.all(launched.map((browser) => browser.close().catch(() => {})));
  mock.restore();
  setEgressPolicyForTests({});
  browserCircuitBreaker.reset();
  await server.stop(true);
});

beforeEach(() => {
  browserCircuitBreaker.reset();
  proxyLookups = [];
  onHang = () => {};
});

describe("renderWithBrowser (real Chromium)", () => {
  test(
    "renders a page through the egress proxy, with its scripts run",
    async () => {
      const content = await renderWithBrowser(`${base}/article`);

      expect(content).toContain(ARTICLE_TEXT);
      expect(content).toContain('<p id="spa">rendered by script</p>');
      // The proxy resolved the page host — Chromium never did.
      expect(proxyLookups).toContain("site.test");
    },
    SLOW,
  );

  test(
    "reuses the running browser for the next render",
    async () => {
      await renderWithBrowser(`${base}/article`);
      const launches = launched.length;

      await renderWithBrowser(`${base}/article`);

      expect(launched.length).toBe(launches);
    },
    SLOW,
  );

  test(
    "the proxy refuses a host that resolves to a private address, even past the page guard",
    async () => {
      const content = await renderWithBrowser(`${base}/rebind`);

      expect(proxyLookups).toContain("evil.test");
      expect(hits.get("/payload.js") ?? 0).toBe(0);
      expect(content).toContain(ARTICLE_TEXT);
      expect(content).not.toContain("reached the private host");
    },
    SLOW,
  );

  test(
    "the request guard aborts a navigation to a private IP literal",
    async () => {
      const before = hits.get("/article") ?? 0;

      const err = await renderWithBrowser(`http://127.0.0.1:${server.port}/article`).catch(
        (e: unknown) => e,
      );

      expect(String(err)).toContain("ERR_BLOCKED_BY_CLIENT");
      expect(hits.get("/article") ?? 0).toBe(before);
      // A page that fails to load says nothing about the browser's health.
      expect(browserCircuitBreaker.getState()).toBe("CLOSED");
    },
    SLOW,
  );

  test(
    "page WebSockets are closed before they reach the network",
    async () => {
      const content = await renderWithBrowser(`${base}/ws-page`);

      expect(wsUpgrades).toBe(0);
      expect(content).toContain('data-ws="closed"');
    },
    SLOW,
  );

  test(
    "refuses a resource that isn't HTML",
    async () => {
      await expect(renderWithBrowser(`${base}/text`)).rejects.toBeInstanceOf(
        UnsupportedContentTypeError,
      );
    },
    SLOW,
  );

  test(
    "refuses a page larger than the HTML cap",
    async () => {
      await expect(renderWithBrowser(`${base}/huge`)).rejects.toBeInstanceOf(ResponseTooLargeError);
    },
    SLOW,
  );

  test(
    "keeps the DOM of a page that never finishes loading",
    async () => {
      // 9 s total leaves ~1 s for navigation after the step reserves.
      const content = await renderWithBrowser(`${base}/never-ends`, 9_000);

      expect(content).toContain(ARTICLE_TEXT);
    },
    SLOW,
  );

  test(
    "times out a page that never finishes loading and has no content",
    async () => {
      const err = await renderWithBrowser(`${base}/never-ends-empty`, 9_000).catch(
        (e: unknown) => e,
      );

      expect(err).toBeInstanceOf(TimeoutError);
      expect((err as Error).message).toContain("content was empty");
    },
    SLOW,
  );

  test(
    "fails fast when the deadline leaves no time to load the page",
    async () => {
      const before = hits.get("/article") ?? 0;

      const err = await renderWithBrowser(`${base}/article`, 8_000).catch((e: unknown) => e);

      expect(err).toBeInstanceOf(TimeoutError);
      expect((err as Error).message).toContain("Render deadline exceeded before loading");
      expect(hits.get("/article") ?? 0).toBe(before);
    },
    SLOW,
  );

  test(
    "fails fast when the deadline leaves no time to create a context",
    async () => {
      await renderWithBrowser(`${base}/article`); // make sure the browser is up

      const err = await renderWithBrowser(`${base}/article`, 2_000).catch((e: unknown) => e);

      expect(err).toBeInstanceOf(TimeoutError);
      expect((err as Error).message).toContain("Creating browser context: render deadline");
    },
    SLOW,
  );

  test(
    "a context creation that fails after the deadline gave up on it is swallowed",
    async () => {
      await renderWithBrowser(`${base}/article`);
      let rejectLate!: (err: Error) => void;
      spyOn(lastBrowser(), "newContext").mockImplementationOnce(
        () => new Promise((_, reject) => (rejectLate = reject)),
      );

      const err = await renderWithBrowser(`${base}/article`, 2_000).catch((e: unknown) => e);
      rejectLate(new Error("context creation failed late"));
      await Bun.sleep(10);

      // The render fails with the deadline, and the late failure surfaces
      // nowhere (an unhandled rejection would fail this test).
      expect(err).toBeInstanceOf(TimeoutError);
      expect(await renderWithBrowser(`${base}/article`)).toContain(ARTICLE_TEXT);
    },
    SLOW,
  );

  test(
    "a context that fails to close doesn't fail an otherwise good render",
    async () => {
      await renderWithBrowser(`${base}/article`);
      const browser = lastBrowser();
      const realNewContext = browser.newContext.bind(browser);
      let closeAttempted = false;
      spyOn(browser, "newContext").mockImplementationOnce(async (options) => {
        const context = await realNewContext(options);
        const realClose = context.close.bind(context);
        context.close = async () => {
          closeAttempted = true;
          await realClose();
          throw new Error("close failed");
        };
        return context;
      });

      expect(await renderWithBrowser(`${base}/article`)).toContain(ARTICLE_TEXT);
      expect(closeAttempted).toBe(true);
    },
    SLOW,
  );

  test(
    "reports a browser that dies mid-render, then relaunches it for the next one",
    async () => {
      await renderWithBrowser(`${base}/article`);
      const dying = lastBrowser();
      const launches = launched.length;
      // A crash, not a graceful close: kill the browser process outright.
      onHang = () => process.kill(browserPids.get(dying)!, "SIGKILL");

      const err = await renderWithBrowser(`${base}/hang`).catch((e: unknown) => e);

      expect(err).toBeInstanceOf(BrowserUnavailableError);
      expect((err as Error).message).toContain("Browser disconnected during render");

      expect(await renderWithBrowser(`${base}/article`)).toContain(ARTICLE_TEXT);
      expect(launched.length).toBe(launches + 1);
      expect(lastBrowser()).not.toBe(dying);
    },
    SLOW,
  );

  test(
    "a browser found disconnected before its 'disconnected' event is dropped and replaced",
    async () => {
      await renderWithBrowser(`${base}/article`);
      const stale = lastBrowser();
      spyOn(stale, "isConnected").mockReturnValueOnce(false);

      const err = await renderWithBrowser(`${base}/article`).catch((e: unknown) => e);

      expect(err).toBeInstanceOf(BrowserUnavailableError);
      expect((err as Error).message).toBe("Browser is disconnected");
      expect(await renderWithBrowser(`${base}/article`)).toContain(ARTICLE_TEXT);
      expect(lastBrowser()).not.toBe(stale);
      // The replaced browser going away later isn't mistaken for the live one.
      await stale.close();
      expect(await renderWithBrowser(`${base}/article`)).toContain(ARTICLE_TEXT);
    },
    SLOW,
  );

  test(
    "a failed launch is reported as browser-unavailable and retried on the next render",
    async () => {
      await closeBrowser();
      launchSpy.mockImplementationOnce(() => Promise.reject(new Error("executable missing")));

      const err = await renderWithBrowser(`${base}/article`).catch((e: unknown) => e);

      expect(err).toBeInstanceOf(BrowserUnavailableError);
      expect((err as Error).message).toBe("Browser launch failed: executable missing");
      expect(await renderWithBrowser(`${base}/article`)).toContain(ARTICLE_TEXT);
    },
    SLOW,
  );

  test(
    "repeated launch failures open the breaker, which then fails fast without launching",
    async () => {
      await closeBrowser();
      launchSpy.mockImplementation(() => Promise.reject(new Error("executable missing")));
      try {
        for (let i = 0; i < 3; i++) {
          await expect(renderWithBrowser(`${base}/article`)).rejects.toBeInstanceOf(
            BrowserUnavailableError,
          );
        }
        expect(browserCircuitBreaker.getState()).toBe("OPEN");
        const calls = launchSpy.mock.calls.length;

        await expect(renderWithBrowser(`${base}/article`)).rejects.toBeInstanceOf(
          CircuitBreakerOpenError,
        );
        expect(launchSpy.mock.calls.length).toBe(calls);
      } finally {
        launchSpy.mockImplementation(recordingLaunch);
      }
    },
    SLOW,
  );
});

describe("closeBrowser (real Chromium)", () => {
  test(
    "closes a browser whose launch was still in progress",
    async () => {
      await closeBrowser();
      const launches = launched.length;
      const started = nextLaunch("succeed");
      const render = renderWithBrowser(`${base}/article`).catch((e: unknown) => e);
      await started;

      await closeBrowser();

      expect(launched.length).toBe(launches + 1);
      expect(lastBrowser().isConnected()).toBe(false);
      await render;
    },
    SLOW,
  );

  test(
    "doesn't throw when the pending launch fails",
    async () => {
      await closeBrowser();
      const started = nextLaunch(new Error("executable missing"));
      const render = renderWithBrowser(`${base}/article`).catch((e: unknown) => e);
      await started;

      await expect(closeBrowser()).resolves.toBeUndefined();
      expect(await render).toBeInstanceOf(BrowserUnavailableError);
    },
    SLOW,
  );

  test(
    "still shuts the egress proxy down when the browser fails to close",
    async () => {
      await renderWithBrowser(`${base}/article`);
      const browser = lastBrowser();
      spyOn(browser, "close").mockImplementationOnce(() => Promise.reject(new Error("stuck")));
      proxyLookups = [];

      await expect(closeBrowser()).resolves.toBeUndefined();

      // The old browser can no longer reach anything: its proxy is gone.
      const page = await browser.newPage();
      await expect(page.goto(`${base}/article`, { timeout: 5_000 })).rejects.toThrow();
      expect(proxyLookups).toEqual([]);
      await browser.close();
    },
    SLOW,
  );
});
