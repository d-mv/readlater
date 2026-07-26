import { chromium } from "playwright";
import type { FetchHtml } from "./parseArticle";

export const renderWithBrowser: FetchHtml = async (url) => {
  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  try {
    const page = await browser.newPage();
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    } catch (err) {
      if (!(err instanceof Error) || !err.name.includes("TimeoutError")) {
        throw err;
      }
    }
    return await page.content();
  } finally {
    await browser.close();
  }
};
