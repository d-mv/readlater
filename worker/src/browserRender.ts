import { chromium } from "playwright";
import type { FetchHtml } from "./parseArticle";

export const renderWithBrowser: FetchHtml = async (url) => {
  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  try {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: "networkidle", timeout: 30_000 });
    return await page.content();
  } finally {
    await browser.close();
  }
};
