import { chromium, type Browser } from "playwright";
import { CircuitBreaker } from "./circuitBreaker";
import type { FetchHtml } from "./parseArticle";

let browserPromise: Promise<Browser> | null = null;

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
  browserPromise = chromium.launch({ args: ["--no-sandbox"] });
  return browserPromise;
}

export async function closeBrowser(): Promise<void> {
  if (browserPromise) {
    try {
      const browser = await browserPromise;
      await browser.close();
    } catch {
      // ignore errors on close
    } finally {
      browserPromise = null;
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
    const browser = await getBrowser();
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      page.setDefaultTimeout(30_000);
      try {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
      } catch (err) {
        if (!(err instanceof Error) || !err.name.includes("TimeoutError")) {
          throw err;
        }
      }
      return await page.content();
    } finally {
      await context.close().catch(() => {});
    }
  });
};
