import { chromium, type Browser } from "playwright";
import { CircuitBreaker } from "./circuitBreaker";
import type { FetchHtml } from "./parseArticle";

let browserPromise: Promise<Browser> | null = null;

export const BROWSER_LAUNCH_TIMEOUT_MS = 15_000;
export const BROWSER_CLOSE_TIMEOUT_MS = 3_000;
export const PAGE_GOTO_TIMEOUT_MS = 15_000;
export const PAGE_CONTENT_TIMEOUT_MS = 5_000;
export const CONTEXT_CLOSE_TIMEOUT_MS = 3_000;
export const TOTAL_RENDER_TIMEOUT_MS = 25_000;

export async function promiseWithTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  errorMessage: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(errorMessage)), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export async function getBrowser(): Promise<Browser> {
  if (browserPromise) {
    try {
      const browser = await browserPromise;
      if (browser.isConnected()) {
        return browser;
      }
    } catch {
      // previous launch attempt failed or disconnected
    }
    browserPromise = null;
  }

  const launchPromise = chromium.launch({
    timeout: BROWSER_LAUNCH_TIMEOUT_MS,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--disable-software-rasterizer",
      "--no-zygote",
    ],
  });

  browserPromise = promiseWithTimeout(
    launchPromise,
    BROWSER_LAUNCH_TIMEOUT_MS,
    `Browser launch timed out after ${BROWSER_LAUNCH_TIMEOUT_MS}ms`,
  ).catch((err) => {
    browserPromise = null;
    throw err;
  });

  return browserPromise;
}

export async function closeBrowser(): Promise<void> {
  const currentPromise = browserPromise;
  browserPromise = null;

  if (currentPromise) {
    try {
      const browser = await promiseWithTimeout(
        currentPromise,
        BROWSER_CLOSE_TIMEOUT_MS,
        "Browser launch resolution timed out during close",
      );
      await promiseWithTimeout(
        browser.close(),
        BROWSER_CLOSE_TIMEOUT_MS,
        "Browser close timed out",
      );
    } catch {
      // ignore errors on close
    }
  }
}

export const browserCircuitBreaker = new CircuitBreaker({
  name: "playwright-browser",
  failureThreshold: 3,
  resetTimeoutMs: 30_000,
  onStateChange: (from, to) => {
    console.warn(`[CircuitBreaker] playwright-browser state changed: ${from} -> ${to}`);
    if (to === "OPEN") {
      closeBrowser().catch(() => {});
    }
  },
});

export const renderWithBrowser: FetchHtml = async (url) => {
  return browserCircuitBreaker.execute(async () => {
    return promiseWithTimeout(
      (async () => {
        let browser: Browser;
        try {
          browser = await getBrowser();
        } catch (err) {
          await closeBrowser().catch(() => {});
          throw err;
        }

        let context;
        try {
          context = await promiseWithTimeout(
            browser.newContext(),
            5_000,
            "Creating browser context timed out",
          );
        } catch (err) {
          await closeBrowser().catch(() => {});
          throw err;
        }

        try {
          const page = await promiseWithTimeout(
            context.newPage(),
            5_000,
            "Creating new page timed out",
          );
          page.setDefaultTimeout(PAGE_GOTO_TIMEOUT_MS);

          let gotoFailed = false;
          try {
            await page.goto(url, {
              waitUntil: "domcontentloaded",
              timeout: PAGE_GOTO_TIMEOUT_MS,
            });
          } catch (err) {
            gotoFailed = true;
            if (!(err instanceof Error) || !err.name.includes("TimeoutError")) {
              throw err;
            }
          }

          const content = await promiseWithTimeout(
            page.content(),
            PAGE_CONTENT_TIMEOUT_MS,
            "Extracting page content timed out",
          );

          if (gotoFailed && (!content || content.trim().length < 50)) {
            throw new Error(`Page navigation timed out and content was empty for ${url}`);
          }

          return content;
        } catch (err) {
          // If page evaluation or navigation failed abnormally, reset browser instance
          closeBrowser().catch(() => {});
          throw err;
        } finally {
          await promiseWithTimeout(
            context.close(),
            CONTEXT_CLOSE_TIMEOUT_MS,
            "Context close timed out",
          ).catch(() => {});
        }
      })(),
      TOTAL_RENDER_TIMEOUT_MS,
      `Browser render timed out after ${TOTAL_RENDER_TIMEOUT_MS / 1000}s for ${url}`,
    );
  });
};
