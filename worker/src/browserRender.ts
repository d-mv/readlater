import { chromium, type Browser } from "playwright";
import type { FetchHtml } from "./parseArticle";

let browserPromise: Promise<Browser> | null = null;

export async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = chromium.launch({ args: ["--no-sandbox"] });
  }
  return browserPromise;
}

export async function closeBrowser(): Promise<void> {
  if (browserPromise) {
    const browser = await browserPromise;
    await browser.close();
    browserPromise = null;
  }
}

export const renderWithBrowser: FetchHtml = async (url) => {
  const browser = await getBrowser();
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    } catch (err) {
      if (!(err instanceof Error) || !err.name.includes("TimeoutError")) {
        throw err;
      }
    }
    return await page.content();
  } finally {
    await context.close();
  }
};
