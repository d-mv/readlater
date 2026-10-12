import type { BrowserContext, Page } from "@playwright/test";

import type { FakeBackend } from "./fakeBackend";

import {
  article,
  expect,
  offlineStoreKeys,
  openRow,
  PNG_BYTES,
  readerTitle,
  row,
  rows,
  test,
} from "./fixtures";

/*
 * The dev server has no service worker (vite-plugin-pwa only registers one in
 * a build), so a page can't be (re)loaded while offline here. These specs load
 * everything online first — which also pulls the lazy route chunks — then go
 * offline and keep navigating inside the app: the data paths under test
 * (IndexedDB list snapshot, downloaded articles) are the same either way.
 *
 * IndexedDB writes go through offlineDb.toPlain: rows from the Pinia store
 * carry Vue reactive proxies, which structured clone refuses.
 */
// An article with one image that downloads and one that doesn't (a 404, as a
// CORS-blocked hot link would), saved with the row toggle; the reader's code
// is loaded on the way (there's no service worker to fetch it offline).
async function downloadIllustrated(page: Page, backend: FakeBackend) {
  backend.external.set("https://img.e2e.test/ok.png", {
    body: PNG_BYTES,
    contentType: "image/png",
  });
  backend.addBookmark({ title: "Warm-up" });
  backend.addBookmark({
    title: "Illustrated",
    content_md:
      "![ok](https://img.e2e.test/ok.png)\n\nText.\n\n![gone](https://img.e2e.test/blocked.png)",
  });
  await page.goto("/");
  await openRow(page, "Warm-up");
  await page.getByTestId("back-btn").click();
  await row(page, "Illustrated").getByTestId("offline-toggle").click();
}

async function goOffline(context: BrowserContext, page: Page) {
  await context.setOffline(true);
  await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(false);
}

test("an article opened online stays readable offline", async ({ page, context, backend }) => {
  backend.addBookmark({ title: "Read on the train", content_md: "Words for the tunnel." });
  backend.addBookmark({ title: "Never opened", content_md: "Not downloaded." });
  await page.goto("/");
  await openRow(page, "Read on the train");
  await expect(article(page)).toHaveText("Words for the tunnel.");
  await expect.poll(() => offlineStoreKeys(page, "articles"), { timeout: 2_000 }).toHaveLength(1);
  await page.getByTestId("back-btn").click();

  await goOffline(context, page);
  await openRow(page, "Read on the train");
  await expect(readerTitle(page)).toHaveText("Read on the train");
  await expect(article(page)).toHaveText("Words for the tunnel.");
});

test("offline, the list is rebuilt from IndexedDB and searched locally", async ({
  page,
  context,
  backend,
}) => {
  backend.addBookmark({ title: "Sourdough basics" });
  backend.addBookmark({ title: "Rust ownership" });
  await page.goto("/");
  await expect(rows(page)).toHaveCount(2);
  await expect
    .poll(() => offlineStoreKeys(page, "bookmarksList"), { timeout: 2_000 })
    .toHaveLength(2);

  await goOffline(context, page);
  const restCallsBefore = backend.callsTo("rest").length;
  const search = page.getByTestId("search-input");
  await search.fill("sourdough");
  await search.press("Enter");
  // Postgres full-text search isn't available; a substring match over the
  // cached titles stands in.
  await expect(rows(page).getByTestId("title")).toHaveText(["Sourdough basics"]);
  await search.fill("");
  await expect(rows(page)).toHaveCount(2);
  expect(backend.callsTo("rest").length).toBe(restCallsBefore);
});

test("the row toggle downloads an article that is then read from IndexedDB offline", async ({
  page,
  context,
  backend,
}) => {
  backend.addBookmark({ title: "Warm-up" });
  const bookmark = backend.addBookmark({ title: "For later", content_md: "Saved body." });
  await page.goto("/");
  await openRow(page, "Warm-up");
  await page.getByTestId("back-btn").click();

  const toggle = row(page, "For later").getByTestId("offline-toggle");
  await expect(toggle).toHaveAttribute("title", "Save offline");
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true", { timeout: 2_000 });
  await expect(toggle).toHaveAttribute("title", "Remove offline copy");
  // Opening "Warm-up" downloaded it too (the reader caches what it opens).
  expect(await offlineStoreKeys(page, "articles")).toContain(bookmark.id);

  await goOffline(context, page);
  // Leaving and re-entering the list makes it fetch, which offline falls back
  // to IndexedDB — the downloaded article, body included, comes from there.
  await openRow(page, "Warm-up");
  await page.getByTestId("back-btn").click();
  await openRow(page, "For later");
  await expect(article(page)).toHaveText("Saved body.");

  // Removing the copy works offline too.
  await page.getByTestId("back-btn").click();
  await row(page, "For later").getByTestId("offline-toggle").click();
  await expect.poll(() => offlineStoreKeys(page, "articles")).not.toContain(bookmark.id);
});

test("a copy missing an image says so on the row and in the offline reader", async ({
  page,
  context,
  backend,
}) => {
  await downloadIllustrated(page, backend);
  const toggle = row(page, "Illustrated").getByTestId("offline-toggle");
  await expect(toggle.getByTestId("images-not-cached")).toBeVisible({ timeout: 2_000 });
  await expect(toggle).toHaveAttribute(
    "title",
    "Saved offline without 1 image — remove offline copy",
  );

  await goOffline(context, page);
  await openRow(page, "Illustrated");
  await expect(page.getByTestId("images-not-cached")).toHaveText(
    "1 image wasn't saved for offline reading.",
  );
});

test("offline, a downloaded image renders from its saved copy", async ({
  page,
  context,
  backend,
}) => {
  // KNOWN BUGS (app), on top of the one above:
  // - ArticleContent's DOMPurify drops `blob:` image sources (not in its
  //   default URI allow-list), so a swapped-in offline image renders with no
  //   src at all.
  // - Downloading (row toggle, or opening the article) leaves the full online
  //   row in the store, so the reader never re-reads the offline copy and
  //   keeps the hot-link URLs until the list re-fetches from IndexedDB. This
  //   test opens the article both ways.
  await downloadIllustrated(page, backend);
  await expect(row(page, "Illustrated").getByTestId("offline-toggle")).toHaveAttribute(
    "aria-pressed",
    "true",
    { timeout: 2_000 },
  );
  await goOffline(context, page);
  const savedImage = article(page).locator('img[alt="ok"]');

  // Straight from the list that was open when the connection dropped.
  await openRow(page, "Illustrated");
  await expect(savedImage).toHaveAttribute("src", /^blob:/, { timeout: 2_000 });

  // From the list the offline fetch rebuilt out of IndexedDB.
  await page.getByTestId("back-btn").click();
  await openRow(page, "Illustrated");
  await expect(savedImage).toHaveAttribute("src", /^blob:/, { timeout: 2_000 });
});

test("read and archived rows only offer the toggle when they already have a copy", async ({
  page,
  backend,
}) => {
  backend.addBookmark({ title: "Fresh" });
  backend.addBookmark({ title: "Finished", read_at: "2026-05-01T00:00:00Z" });
  backend.addBookmark({ title: "Shelved", archived: true });
  await page.goto("/");
  await expect(row(page, "Fresh").getByTestId("offline-toggle")).toBeVisible();
  await expect(row(page, "Finished").getByTestId("offline-toggle")).toHaveCount(0);
  await page.getByTestId("tab").filter({ hasText: "Archived" }).click();
  await expect(row(page, "Shelved").getByTestId("offline-toggle")).toHaveCount(0);
});

test("going offline keeps the open reader usable and coming back online refetches", async ({
  page,
  context,
  backend,
}) => {
  backend.addBookmark({ title: "Online first" });
  await page.goto("/");
  await openRow(page, "Online first");
  await page.getByTestId("back-btn").click();
  await expect(rows(page)).toHaveCount(1);

  await goOffline(context, page);
  await openRow(page, "Online first");
  await expect(readerTitle(page)).toHaveText("Online first");
  await page.getByTestId("back-btn").click();

  backend.addBookmark({ title: "Added while away", created_at: "2026-05-30T00:00:00.000Z" });
  await context.setOffline(false);
  // The `online` event re-runs the list fetch.
  await expect(row(page, "Added while away")).toBeVisible();
});
