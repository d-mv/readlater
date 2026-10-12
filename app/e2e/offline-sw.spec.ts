import type { BrowserContext, Page } from "@playwright/test";

import { article, expect, offlineStoreKeys, openRow, PNG_BYTES, row, rows, test } from "./fixtures";

/*
 * Runs against a production build served by `vite preview` (the
 * "offline-sw" project in playwright.config.ts), the only setup with a
 * service worker: the dev server has none, so offline.spec.ts can't reload
 * a page while offline. Here a reload with no network at all must get the
 * app shell from the Workbox precache, the list from IndexedDB and a
 * downloaded article, images included, from its saved copy.
 */

/** Resolves once the service worker has precached the build and controls the page. */
async function waitForServiceWorker(page: Page) {
  await page.evaluate(() => navigator.serviceWorker.ready);
  // clientsClaim: the active worker takes over this already-open page.
  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null))
    .toBe(true);
}

/**
 * Cuts every network path: the fake backend and external hosts, and the
 * preview server too — so anything the page gets afterwards came from the
 * service worker's cache, not from a request that slipped through.
 *
 * Chromium drops Playwright's offline emulation for a navigation the service
 * worker answers (navigator.onLine reads true again after the reload), so a
 * flag in sessionStorage keeps navigator.onLine false across it, as on a
 * device that really is offline.
 */
async function cutNetwork(context: BrowserContext, page: Page, baseURL: string) {
  await context.route(`${baseURL}/**`, (route) => route.abort("internetdisconnected"));
  await context.setOffline(true);
  await page.evaluate(() => sessionStorage.setItem("e2e-offline", "1"));
}

test("offline, a reload starts the app from the precache, the list from IndexedDB and a downloaded article with its images", async ({
  page,
  context,
  backend,
  baseURL,
}) => {
  await context.addInitScript(() => {
    if (sessionStorage.getItem("e2e-offline")) {
      Object.defineProperty(Navigator.prototype, "onLine", { get: () => false });
    }
  });
  backend.external.set("https://img.e2e.test/photo.png", {
    body: PNG_BYTES,
    contentType: "image/png",
  });
  backend.addBookmark({ title: "Not downloaded", content_md: "Online only." });
  backend.addBookmark({
    title: "For the plane",
    content_md: "Before the photo.\n\n![photo](https://img.e2e.test/photo.png)\n\nAfter it.",
  });

  await page.goto("/");
  await expect(rows(page)).toHaveCount(2);
  await waitForServiceWorker(page);
  const toggle = row(page, "For the plane").getByTestId("offline-toggle");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true", { timeout: 5_000 });
  await expect.poll(() => offlineStoreKeys(page, "bookmarksList")).toHaveLength(2);

  backend.offline = true;
  await cutNetwork(context, page, baseURL!);
  await page.reload();

  // The shell and route chunks come from the precache, the list from the
  // IndexedDB snapshot.
  await expect(rows(page)).toHaveCount(2);
  await expect(row(page, "Not downloaded")).toBeVisible();

  await openRow(page, "For the plane");
  await expect(article(page)).toContainText("Before the photo.");
  await expect(article(page)).toContainText("After it.");
  const photo = article(page).locator('img[alt="photo"]');
  await expect(photo).toHaveAttribute("src", /^blob:/);
  // The saved blob really decodes — not just a swapped URL.
  await expect.poll(() => photo.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(1);
});
