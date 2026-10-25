import { chromium, type Browser, type LaunchOptions } from "playwright";
import { CircuitBreaker } from "./circuitBreaker";
import { startEgressProxy, type EgressProxy } from "./egressProxy";
import {
  BrowserUnavailableError,
  isBreakerFailure,
  ResponseTooLargeError,
  UnsupportedContentTypeError,
} from "./errors";
import { MAX_HTML_BYTES } from "./http";
import { log } from "./logger";
import type { FetchedPage, FetchHtml } from "./parseArticle";
import { TimeoutError, withTimeout } from "./timeout";
import { routeIfPublic, type LookupAll } from "./urlGuard";

// Budget for one render. Every step gets at most what is left of the total
// (minus the context-close reserve), so the steps can never add up to more
// than TOTAL_RENDER_TIMEOUT_MS — no render outlives its deadline and races the
// next job for the shared browser.
export const TOTAL_RENDER_TIMEOUT_MS = 25_000;
export const BROWSER_LAUNCH_TIMEOUT_MS = 15_000;
export const CONTEXT_CREATE_TIMEOUT_MS = 5_000;
export const PAGE_CONTENT_TIMEOUT_MS = 5_000;
export const CONTEXT_CLOSE_TIMEOUT_MS = 3_000;
export const BROWSER_CLOSE_TIMEOUT_MS = 3_000;

const HTML_TYPES = new Set(["text/html", "application/xhtml+xml"]);

/**
 * Chromium launch options. JavaScript stays on — the fallback exists for
 * client-rendered SPAs, which Readability can't extract without it — so the
 * network is locked down instead:
 * - all traffic goes through the egress proxy, which resolves each host once,
 *   refuses private addresses and connects to the vetted IP (no rebinding);
 * - WebRTC may not send UDP outside the proxy (STUN to internal hosts);
 * - the browser gets a minimal environment, never the worker's secrets.
 */
export function browserLaunchOptions(
  proxyUrl: string,
  env: NodeJS.ProcessEnv = process.env,
): LaunchOptions {
  return {
    timeout: BROWSER_LAUNCH_TIMEOUT_MS,
    proxy: { server: proxyUrl },
    env: {
      PATH: env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
      HOME: env.HOME ?? "/tmp",
    },
    // Renderers run in Chromium's user-namespace + seccomp-bpf sandbox, so a
    // compromised one can't open files or read other processes. In Docker
    // this needs the container's seccomp profile to allow clone/unshare/setns
    // (worker/seccomp-chromium.json; see worker/Dockerfile) — under the
    // default profile the launch fails instead of silently running unsandboxed.
    chromiumSandbox: true,
    args: [
      // No setuid helper is shipped; use the namespace sandbox only.
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--disable-software-rasterizer",
      "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
      "--disable-quic",
    ],
  };
}

interface BrowserHandle {
  browser: Browser;
  proxy: EgressProxy;
}

let handlePromise: Promise<BrowserHandle> | null = null;
let liveHandle: BrowserHandle | null = null;

// How the browser's egress is vetted: the proxy's resolver and private-address
// check, and the request guard's resolver. Production uses the defaults.
let egress: { proxy?: Parameters<typeof startEgressProxy>[0]; lookup?: LookupAll } = {};

/** Test hook: lets a test point the browser at servers on loopback. */
export function setEgressPolicyForTests(policy: typeof egress) {
  egress = policy;
}

async function launch(): Promise<BrowserHandle> {
  const proxy = await startEgressProxy(egress.proxy);
  let browser: Browser;
  try {
    browser = await chromium.launch(browserLaunchOptions(proxy.url));
  } catch (err) {
    await proxy.close();
    const reason = err instanceof Error ? err.message : String(err);
    throw new BrowserUnavailableError(`Browser launch failed: ${reason}`);
  }
  const handle = { browser, proxy };
  liveHandle = handle;
  // A crashed browser is dropped so the next render launches a fresh one;
  // nothing else restarts it. (closeBrowser() clears liveHandle first, so an
  // intentional close isn't reported as a crash.)
  browser.on("disconnected", () => {
    void proxy.close();
    if (liveHandle !== handle) return;
    log.warn("headless browser disconnected unexpectedly; it will be relaunched");
    liveHandle = null;
    handlePromise = null;
  });
  return handle;
}

async function getBrowser(timeoutMs: number): Promise<Browser> {
  if (!handlePromise) {
    const pending = launch();
    handlePromise = pending;
    pending.catch(() => {
      if (handlePromise === pending) handlePromise = null;
    });
  }
  const { browser } = await withTimeout(
    handlePromise,
    Math.min(timeoutMs, BROWSER_LAUNCH_TIMEOUT_MS),
    "Browser launch timed out",
  );
  if (!browser.isConnected()) {
    handlePromise = null;
    throw new BrowserUnavailableError("Browser is disconnected");
  }
  return browser;
}

export async function closeBrowser(): Promise<void> {
  const current = handlePromise;
  handlePromise = null;
  liveHandle = null;
  if (!current) return;
  try {
    const handle = await withTimeout(
      current,
      BROWSER_CLOSE_TIMEOUT_MS,
      "Browser launch resolution timed out during close",
    );
    if (liveHandle === handle) liveHandle = null;
    const { browser, proxy } = handle;
    await withTimeout(browser.close(), BROWSER_CLOSE_TIMEOUT_MS, "Browser close timed out").catch(
      () => {},
    );
    await proxy.close();
  } catch {
    // ignore errors on close
  }
}

export const browserCircuitBreaker = new CircuitBreaker({
  name: "playwright-browser",
  failureThreshold: 3,
  resetTimeoutMs: 30_000,
  // A dead browser or a timeout counts; a page that fails to load doesn't.
  isFailure: isBreakerFailure,
  onStateChange: (from, to) => {
    log.warn("circuit breaker state changed", { breaker: "playwright-browser", from, to });
    if (to === "OPEN") {
      // closeBrowser() never rejects.
      void closeBrowser();
    }
  },
});

// For promises nobody awaits any more (a step that lost its race, a context
// or page closed in the background): their failure has nowhere to go.
function ignoreRejection(): void {}

async function renderPage(
  url: string,
  deadline: number,
  maxHtmlBytes: number,
): Promise<FetchedPage> {
  // Work must finish early enough to leave the context-close reserve.
  const workDeadline = deadline - CONTEXT_CLOSE_TIMEOUT_MS;
  const remaining = () => workDeadline - Date.now();
  const step = <T>(promise: Promise<T>, cap: number, label: string): Promise<T> => {
    const budget = Math.min(cap, remaining());
    if (budget <= 0) {
      promise.catch(ignoreRejection);
      return Promise.reject(new TimeoutError(`${label}: render deadline exceeded`));
    }
    return withTimeout(promise, budget, `${label} timed out`);
  };

  const browser = await getBrowser(remaining());
  const pendingContext = browser.newContext({ serviceWorkers: "block", acceptDownloads: false });
  const context = await step(
    pendingContext,
    CONTEXT_CREATE_TIMEOUT_MS,
    "Creating browser context",
  ).catch((err: unknown) => {
    // Don't leak a context that shows up after we stopped waiting for it.
    pendingContext.then((late) => late.close()).catch(ignoreRejection);
    throw err;
  });

  // Set by the response listener below, which closes the page: every step
  // after that fails with "page closed", and goto may already have resolved.
  let declaredTooLarge = false;
  try {
    // Defence in depth on top of the egress proxy: refuse WebSockets outright
    // and abort requests to private hosts before they leave the page.
    await step(
      context.routeWebSocket(/.*/, (ws) => ws.close()),
      CONTEXT_CREATE_TIMEOUT_MS,
      "Blocking WebSockets",
    );
    await step(
      context.route("**/*", (route) => routeIfPublic(route, egress.lookup)),
      CONTEXT_CREATE_TIMEOUT_MS,
      "Installing request guard",
    );
    const page = await step(context.newPage(), CONTEXT_CREATE_TIMEOUT_MS, "Creating new page");
    page.setDefaultTimeout(Math.max(1, remaining()));

    // Leave room after navigation to read the DOM.
    const gotoBudget = remaining() - PAGE_CONTENT_TIMEOUT_MS;
    if (gotoBudget <= 0) throw new TimeoutError(`Render deadline exceeded before loading ${url}`);

    // A document that declares itself over the cap is refused as soon as its
    // headers arrive, instead of being downloaded and parsed first (5 MB of
    // HTML can take longer to parse than the whole render budget).
    page.on("response", (res) => {
      if (res.frame() !== page.mainFrame() || !res.request().isNavigationRequest()) return;
      if (Number(res.headers()["content-length"]) > maxHtmlBytes) {
        declaredTooLarge = true;
        void page.close().catch(ignoreRejection);
      }
    });

    let gotoTimedOut = false;
    try {
      const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: gotoBudget });
      const type = (response?.headers()["content-type"] ?? "").split(";")[0]!.trim().toLowerCase();
      if (type && !HTML_TYPES.has(type)) throw new UnsupportedContentTypeError(type);
    } catch (err) {
      if (!(err instanceof Error) || err.name !== "TimeoutError") throw err;
      // Pages that never stop loading still have a usable DOM: keep going.
      gotoTimedOut = true;
    }

    // Measure inside Chromium first: page.content() copies the whole
    // serialized DOM into this process, so a page whose script built a huge
    // DOM is refused before that copy.
    // (An expression string: it runs in the page, not in this process.)
    const size = await step(
      page.evaluate<number>("document.documentElement?.outerHTML.length ?? 0"),
      PAGE_CONTENT_TIMEOUT_MS,
      "Measuring page content",
    );
    if (size > maxHtmlBytes) throw new ResponseTooLargeError(maxHtmlBytes);
    const content = await step(page.content(), PAGE_CONTENT_TIMEOUT_MS, "Extracting page content");
    // No (or a lying) Content-Length: the size is only known once loaded.
    if (content.length > maxHtmlBytes) throw new ResponseTooLargeError(maxHtmlBytes);
    if (gotoTimedOut && content.trim().length < 50) {
      throw new TimeoutError(`Page navigation timed out and content was empty for ${url}`);
    }
    // Chromium already decoded the page; its URL is the one after redirects.
    return { body: content, contentType: "text/html", url: page.url() };
  } catch (err) {
    if (declaredTooLarge) throw new ResponseTooLargeError(maxHtmlBytes);
    // A page-level failure leaves the shared browser alone (the context is
    // closed below); only a browser that went away is reported as such.
    if (!browser.isConnected()) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new BrowserUnavailableError(`Browser disconnected during render: ${reason}`);
    }
    throw err;
  } finally {
    await withTimeout(context.close(), CONTEXT_CLOSE_TIMEOUT_MS, "Context close timed out").catch(
      () => {},
    );
  }
}

export const renderWithBrowser = (
  url: string,
  totalTimeoutMs = TOTAL_RENDER_TIMEOUT_MS,
  maxHtmlBytes = MAX_HTML_BYTES,
): ReturnType<FetchHtml> =>
  browserCircuitBreaker.execute(() => renderPage(url, Date.now() + totalTimeoutMs, maxHtmlBytes));
