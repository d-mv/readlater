import type { Page } from "@playwright/test";

import {
  answerNextConfirm,
  article,
  expect,
  menuAction,
  openMenu,
  readerTitle,
  row,
  rows,
  test,
} from "./fixtures";

const LONG_BODY = Array.from(
  { length: 120 },
  (_, i) =>
    `Paragraph ${i + 1}. ${"Lorem ipsum dolor sit amet, consectetur adipiscing elit. ".repeat(4)}`,
).join("\n\n");

function actionError(page: Page) {
  return page.getByTestId("action-error");
}

test("opening an article from the list renders its body, byline and domain", async ({
  page,
  backend,
}) => {
  backend.addBookmark({
    title: "The long read",
    author: "Ada Lovelace",
    reading_time: 7,
    url: "https://www.example.com/long-read",
    content_md: "## Section\n\nA [link](https://other.example.org/page) and *emphasis*.",
  });
  await page.goto("/");
  await row(page, "The long read").getByRole("button").first().click();

  await expect(page).toHaveURL(/\/b\/[\w-]+$/);
  await expect(readerTitle(page)).toHaveText("The long read");
  await expect(page.getByText("By Ada Lovelace · 7 min read")).toBeVisible();
  await expect(page.getByText("example.com", { exact: true })).toBeVisible();
  await expect(article(page).getByRole("heading", { name: "Section" })).toBeVisible();
  const link = article(page).getByRole("link", { name: "link" });
  await expect(link).toHaveAttribute("target", "_blank");
  await expect(link).toHaveAttribute("rel", "noopener noreferrer");

  await page.getByTestId("back-btn").click();
  await expect(page).toHaveURL(/\/$/);
  await expect(rows(page)).toHaveCount(1);
});

test("an unknown id shows the not-available state", async ({ page }) => {
  await page.goto("/b/00000000-0000-4000-8000-00000000dead");
  await expect(page.getByTestId("not-found")).toContainText("Article not available offline");
  await page.getByTestId("back-to-list-btn").click();
  await expect(page).toHaveURL(/\/$/);
});

test("reading progress is restored on open and saved after scrolling", async ({
  page,
  backend,
}) => {
  const bookmark = backend.addBookmark({
    title: "Halfway there",
    content_md: LONG_BODY,
    progress: 0.5,
  });
  await page.goto(`/b/${bookmark.id}`);
  await expect(readerTitle(page)).toBeVisible();

  const scrollArea = page.getByTestId("scroll-area");
  await expect
    .poll(() => scrollArea.evaluate((el) => el.scrollTop / (el.scrollHeight - el.clientHeight)))
    .toBeCloseTo(0.5, 1);
  await expect
    .poll(() => page.getByTestId("fill").evaluate((el) => parseFloat(el.style.width)))
    .toBeCloseTo(50, -1);

  await scrollArea.evaluate((el) => el.scrollTo({ top: el.scrollHeight }));
  // Coalesced: one write ~2 s after the scroll settles.
  await expect
    .poll(() => backend.bookmark(bookmark.id)?.progress, { timeout: 6_000 })
    .toBeGreaterThan(0.95);
});

test("mark as read and unread from the menu", async ({ page, backend }) => {
  const bookmark = backend.addBookmark({ title: "To read" });
  await page.goto(`/b/${bookmark.id}`);

  await menuAction(page, "mark-read");
  await expect.poll(() => backend.bookmark(bookmark.id)?.read_at).not.toBeNull();
  const panel = await openMenu(page);
  await expect(panel.getByTestId("mark-read")).toHaveCount(0);
  await panel.getByTestId("mark-unread").click();
  await expect.poll(() => backend.bookmark(bookmark.id)?.read_at).toBeNull();

  await page.getByTestId("back-btn").click();
  await expect(row(page, "To read").getByTestId("title")).not.toHaveAttribute("data-read");
});

test("a failed write shows the error banner and leaves the state alone", async ({
  page,
  backend,
}) => {
  const bookmark = backend.addBookmark({ title: "Stubborn" });
  await page.goto(`/b/${bookmark.id}`);
  backend.fail((c) => c.method === "PATCH" && c.name === "bookmarks");
  await menuAction(page, "mark-read");
  await expect(actionError(page)).toHaveText(
    "Couldn't save the change. Check your connection and try again.",
  );
  const panel = await openMenu(page);
  await expect(panel.getByTestId("mark-read")).toBeVisible();
});

test("archive moves the article to the Archived tab", async ({ page, backend }) => {
  const bookmark = backend.addBookmark({ title: "Done with this" });
  backend.addBookmark({ title: "Still reading" });
  await page.goto("/");
  await row(page, "Done with this").getByRole("button").first().click();
  await menuAction(page, "archive-item");

  await expect(page).toHaveURL(/\/$/);
  await expect(rows(page).getByTestId("title")).toHaveText(["Still reading"]);
  expect(backend.bookmark(bookmark.id)?.archived).toBe(true);
  await page.getByTestId("tab").filter({ hasText: "Archived" }).click();
  await expect(rows(page).getByTestId("title")).toHaveText(["Done with this"]);
});

test("delete asks first, then removes the article", async ({ page, backend }) => {
  const bookmark = backend.addBookmark({ title: "Delete me" });
  backend.addBookmark({ title: "Keep me" });
  await page.goto("/");
  await row(page, "Delete me").getByRole("button").first().click();

  answerNextConfirm(page, false);
  await menuAction(page, "delete-item");
  await expect(readerTitle(page)).toHaveText("Delete me");
  expect(backend.bookmark(bookmark.id)).toBeDefined();

  answerNextConfirm(page, true);
  await menuAction(page, "delete-item");
  await expect(page).toHaveURL(/\/$/);
  await expect(rows(page).getByTestId("title")).toHaveText(["Keep me"]);
  await expect.poll(() => backend.bookmark(bookmark.id)).toBeUndefined();
});

test("a delete the server refuses puts the row back in the list", async ({ page, backend }) => {
  const bookmark = backend.addBookmark({ title: "Undeletable" });
  await page.goto("/");
  await row(page, "Undeletable").getByRole("button").first().click();
  backend.fail((c) => c.method === "DELETE" && c.name === "bookmarks");
  answerNextConfirm(page, true);
  await menuAction(page, "delete-item");

  await expect(page).toHaveURL(/\/$/);
  await expect(rows(page).getByTestId("title")).toHaveText(["Undeletable"]);
  expect(backend.bookmark(bookmark.id)).toBeDefined();
});

test("tags are added by typing and removed with their x", async ({ page, backend }) => {
  const bookmark = backend.addBookmark({ title: "Taggable", tags: ["existing"] });
  await page.goto(`/b/${bookmark.id}`);

  const chips = page.getByTestId("tag-chip");
  await expect(chips).toHaveText(["existing"]);
  const draft = page.getByTestId("tag-draft-input");
  await draft.fill("  later  ");
  await draft.press("Enter");
  await expect(chips).toHaveText(["existing", "later"]);
  await expect(draft).toHaveValue("");
  expect(backend.tagNamesOf(bookmark.id)).toEqual(["existing", "later"]);

  await chips.filter({ hasText: "existing" }).getByTestId("remove-btn").click();
  await expect(chips).toHaveText(["later"]);
  expect(backend.tagNamesOf(bookmark.id)).toEqual(["later"]);

  // The list's tag bar reflects it.
  await page.getByTestId("back-btn").click();
  await expect(page.getByTestId("tag-filter-bar").getByTestId("tag-chip")).toHaveText(["later"]);
});

test("editing saves the title and body; a failed save keeps the editor and draft", async ({
  page,
  backend,
}) => {
  const bookmark = backend.addBookmark({ title: "Draft title", content_md: "Original body." });
  await page.goto(`/b/${bookmark.id}`);
  await menuAction(page, "edit-item");

  const titleInput = page.getByTestId("title-input");
  await expect(titleInput).toHaveValue("Draft title");
  const editor = page.locator(".cm-content");
  await expect(editor).toBeVisible();
  await titleInput.fill("Edited title");
  await editor.fill("Rewritten body with **bold**.");

  backend.fail((c) => c.method === "PATCH" && c.name === "bookmarks");
  await page.getByTestId("save-edit-btn").click();
  await expect(actionError(page)).toBeVisible();
  await expect(titleInput).toHaveValue("Edited title");
  await expect(editor).toContainText("Rewritten body");

  await page.getByTestId("save-edit-btn").click();
  await expect(readerTitle(page)).toHaveText("Edited title");
  await expect(actionError(page)).toHaveCount(0);
  await expect(article(page).locator("strong")).toHaveText("bold");
  expect(backend.bookmark(bookmark.id)).toMatchObject({
    title: "Edited title",
    content_md: "Rewritten body with **bold**.",
    content_edited: true,
    word_count: 4,
  });
});

test("cancelling an edit discards the draft", async ({ page, backend }) => {
  const bookmark = backend.addBookmark({ title: "Unchanged", content_md: "Same body." });
  await page.goto(`/b/${bookmark.id}`);
  await menuAction(page, "edit-item");
  await page.getByTestId("title-input").fill("Something else");
  await page.getByTestId("cancel-edit-btn").click();
  await expect(readerTitle(page)).toHaveText("Unchanged");
  expect(backend.callsTo("rest", "bookmarks", "PATCH")).toHaveLength(0);
});

test("translate shows the translation with an original toggle, and it persists", async ({
  page,
  backend,
}) => {
  const bookmark = backend.addBookmark({
    title: "Bonjour",
    type: "note",
    url: null,
    content_md: "Bonjour le monde",
  });
  await page.goto(`/b/${bookmark.id}`);
  await menuAction(page, "translate-item");

  const bar = page.getByTestId("translate-bar");
  await expect(bar).toContainText("Translated");
  await expect(article(page)).toHaveText("[EN] Bonjour le monde");
  expect(backend.callsTo("functions", "translate")[0]?.body).toEqual({
    bookmark_id: bookmark.id,
    target_lang: "EN",
  });

  await page.getByTestId("translate-toggle").click();
  await expect(bar).toContainText("Original");
  await expect(article(page)).toHaveText("Bonjour le monde");

  // The edge function cached it on the row: shown by default next time, and
  // Translate again doesn't spend another call.
  await page.reload();
  await expect(article(page)).toHaveText("[EN] Bonjour le monde");
  await menuAction(page, "translate-item");
  expect(backend.callsTo("functions", "translate")).toHaveLength(1);
});

test("a failed translation says so in the translate bar", async ({ page, backend }) => {
  const bookmark = backend.addBookmark({ title: "Hola", content_md: "Hola mundo" });
  backend.fail((c) => c.name === "translate", { status: 503, body: { error: "quota" } });
  await page.goto(`/b/${bookmark.id}`);
  await menuAction(page, "translate-item");
  await expect(page.getByTestId("translate-bar")).toContainText(/non-2xx|error/i);
  await expect(article(page)).toHaveText("Hola mundo");
});

test("Translate page links to Google Translate's proxy for the original URL", async ({
  page,
  backend,
}) => {
  const bookmark = backend.addBookmark({ url: "https://example.com/a?b=c" });
  await page.goto(`/b/${bookmark.id}`);
  const panel = await openMenu(page);
  await expect(panel.getByTestId("translate-page-item")).toHaveAttribute(
    "href",
    `https://translate.google.com/translate?sl=auto&tl=en&u=${encodeURIComponent("https://example.com/a?b=c")}`,
  );
  await expect(panel.getByTestId("open-original")).toHaveAttribute(
    "href",
    "https://example.com/a?b=c",
  );
  await expect(panel.getByTestId("translate-page-item")).toHaveAttribute("target", "_blank");
});

test("a note has no URL-based menu items", async ({ page, backend }) => {
  const bookmark = backend.addBookmark({ type: "note", url: null, title: "Just a note" });
  await page.goto(`/b/${bookmark.id}`);
  const panel = await openMenu(page);
  await expect(panel.getByTestId("translate-item")).toBeVisible();
  await expect(panel.getByTestId("translate-page-item")).toHaveCount(0);
  await expect(panel.getByTestId("open-original")).toHaveCount(0);
});

test("the share dialog makes a bookmark public after confirming, and back", async ({
  page,
  backend,
  baseURL,
}) => {
  const bookmark = backend.addBookmark({ title: "Worth sharing" });
  await page.goto(`/b/${bookmark.id}`);
  await menuAction(page, "share-item");

  const dialog = page.getByRole("dialog", { name: "Share bookmark" });
  await expect(dialog).toBeVisible();
  const toggle = dialog.getByTestId("toggle-input");
  await expect(toggle).not.toBeChecked();

  answerNextConfirm(page, true);
  await toggle.click();
  await expect(dialog.getByTestId("link-field")).toHaveValue(`${baseURL}/s/${bookmark.id}`);
  expect(backend.bookmark(bookmark.id)?.is_public).toBe(true);

  // Unsharing needs no confirmation.
  await toggle.click();
  await expect(dialog.getByTestId("link-field")).toHaveCount(0);
  await expect.poll(() => backend.bookmark(bookmark.id)?.is_public).toBe(false);

  await dialog.getByTestId("close-btn").click();
  await expect(dialog).toHaveCount(0);
});

test("declining the first-share confirmation leaves the toggle off and the next click shares", async ({
  page,
  backend,
}) => {
  // A declined confirm must un-flip the native checkbox: `:checked` is still
  // false, so Vue alone wouldn't re-render it.
  const bookmark = backend.addBookmark({ title: "Maybe later" });
  await page.goto(`/b/${bookmark.id}`);
  await menuAction(page, "share-item");
  const toggle = page.getByTestId("toggle-input");

  answerNextConfirm(page, false);
  await toggle.click();
  expect(backend.bookmark(bookmark.id)?.is_public).toBe(false);
  await expect(toggle).not.toBeChecked({ timeout: 1_000 });

  answerNextConfirm(page, true);
  await toggle.click();
  await expect.poll(() => backend.bookmark(bookmark.id)?.is_public, { timeout: 1_000 }).toBe(true);
});

test("copy link puts the public URL on the clipboard", async ({
  page,
  backend,
  context,
  baseURL,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "clipboard permissions are Chromium-only");
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const bookmark = backend.addBookmark({ title: "Public already", is_public: true });
  await page.goto(`/b/${bookmark.id}`);
  await menuAction(page, "share-item");
  await page.getByTestId("copy-btn").click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    `${baseURL}/s/${bookmark.id}`,
  );
});

test("a YouTube bookmark mounts the privacy-enhanced player only on tap", async ({
  page,
  backend,
}) => {
  const bookmark = backend.addBookmark({
    type: "youtube",
    title: "A talk",
    url: "https://www.youtube.com/watch?v=abc123",
    youtube_video_id: "abc123",
    thumbnail_url: "https://img.e2e.test/thumb.jpg",
    content_md: "# A talk\n\n![thumbnail](https://img.e2e.test/thumb.jpg)\n\nThe description.",
  });
  await page.goto(`/b/${bookmark.id}`);
  await expect(article(page)).toContainText("The description.");
  // The baked-in heading and thumbnail aren't repeated in the body.
  await expect(article(page).getByRole("heading", { name: "A talk" })).toHaveCount(0);
  await expect(page.locator("iframe")).toHaveCount(0);

  await page.getByTestId("youtube-play").click();
  await expect(page.locator('iframe[title="YouTube video player"]')).toHaveAttribute(
    "src",
    "https://www.youtube-nocookie.com/embed/abc123",
  );
});

test("a parsed PDF opens as Markdown and toggles to the original via a signed URL", async ({
  page,
  backend,
}) => {
  const path = backend.addPdfObject();
  const bookmark = backend.addBookmark({
    type: "pdf",
    url: null,
    title: "paper.pdf",
    content_md: "Extracted text of the paper.",
    pdf_path: path,
    pdf_parsed: true,
  });
  await page.goto(`/b/${bookmark.id}`);

  const bar = page.getByTestId("pdf-view-bar");
  await expect(bar).toContainText("Markdown");
  await expect(article(page)).toContainText("Extracted text of the paper.");

  await page.getByTestId("pdf-view-toggle").click();
  await expect(bar).toContainText("Original PDF");
  await expect(page.locator('iframe[title="PDF document"]')).toHaveAttribute(
    "src",
    new RegExp(`/storage/v1/object/sign/bookmark-pdfs/${path}\\?token=`),
  );
  await expect.poll(() => backend.bookmark(bookmark.id)?.view_mode).toBe("original");

  await page.getByTestId("pdf-view-toggle").click();
  await expect(article(page)).toContainText("Extracted text of the paper.");
});

test("an unparsed PDF shows only the original", async ({ page, backend }) => {
  const path = backend.addPdfObject();
  const bookmark = backend.addBookmark({
    type: "pdf",
    url: null,
    title: "scan.pdf",
    content_md: null,
    pdf_path: path,
    pdf_parsed: false,
  });
  await page.goto(`/b/${bookmark.id}`);
  await expect(page.locator('iframe[title="PDF document"]')).toBeVisible();
  await expect(page.getByTestId("pdf-view-bar")).toHaveCount(0);
  const panel = await openMenu(page);
  await expect(panel.getByTestId("trash-pdf-item")).toHaveCount(0);
  await expect(panel.getByTestId("translate-item")).toHaveCount(0);
});

test("Open original opens the PDF; Trash original removes it and leaves the Markdown", async ({
  page,

  backend,
}) => {
  const path = backend.addPdfObject();
  const bookmark = backend.addBookmark({
    type: "pdf",
    url: null,
    title: "report.pdf",
    content_md: "Report text.",
    pdf_path: path,
    pdf_parsed: true,
  });
  await page.goto(`/b/${bookmark.id}`);

  // Headless Chromium's PDF tab never reports a URL; record the window.open
  // call instead.
  await page.evaluate(() => {
    const opened: string[] = [];
    (window as unknown as { opened: string[] }).opened = opened;
    window.open = (url?: string | URL) => {
      opened.push(String(url));
      return null;
    };
  });
  await menuAction(page, "open-original");
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { opened: string[] }).opened))
    .toEqual([expect.stringContaining(`/storage/v1/object/sign/bookmark-pdfs/${path}?token=`)]);

  answerNextConfirm(page, true);
  await menuAction(page, "trash-pdf-item");
  await expect(page.getByTestId("pdf-view-bar")).toHaveCount(0);
  await expect.poll(() => backend.storage.has(`bookmark-pdfs/${path}`)).toBe(false);
  expect(backend.bookmark(bookmark.id)).toMatchObject({ pdf_path: null, view_mode: "markdown" });
  const panel = await openMenu(page);
  await expect(panel.getByTestId("open-original")).toHaveCount(0);
  await expect(article(page)).toContainText("Report text.");
});

test("a pending article shows Processing until Realtime reports it ready", async ({
  page,
  backend,
}) => {
  const bookmark = backend.addBookmark({ title: null, status: "pending", content_md: null });
  await page.goto(`/b/${bookmark.id}`);
  await expect(page.getByTestId("status-placeholder")).toContainText("Processing…");
  await expect.poll(() => backend.realtimeJoined).toBe(true);

  Object.assign(bookmark, {
    status: "ready",
    title: "Fetched by the worker",
    content_md: "The worker's extraction.",
    updated_at: backend.now(),
  });
  backend.pushChange("UPDATE", bookmark);
  await expect(readerTitle(page)).toHaveText("Fetched by the worker");
  await expect(article(page)).toHaveText("The worker's extraction.");
});

test("a failed article offers Try again, which re-queues it", async ({ page, backend }) => {
  const bookmark = backend.addBookmark({
    title: null,
    status: "failed",
    error_message: "HTTP 403 from origin",
    content_md: null,
  });
  await page.goto(`/b/${bookmark.id}`);
  await expect(page.getByTestId("status-placeholder")).toContainText(
    "Couldn't process this article.",
  );
  await expect(page.getByTestId("status-placeholder")).toContainText("HTTP 403 from origin");
  await page.getByTestId("retry-btn").click();
  await expect(page.getByTestId("status-placeholder")).toContainText("Processing…");
  expect(backend.bookmark(bookmark.id)?.status).toBe("pending");
});
