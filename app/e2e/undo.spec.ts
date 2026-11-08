import type { Page } from "@playwright/test";

import type { FakeBackend } from "./fakeBackend";
import { expect, menuAction, openRow, rows, test } from "./fixtures";

// The undo window (stores/undo.ts UNDO_WINDOW_MS).
const UNDO_WINDOW_MS = 5000;

const toast = (page: Page) => page.getByTestId("undo-toast");
const undoButton = (page: Page) => toast(page).getByRole("button", { name: "Undo" });
const titles = (page: Page) => rows(page).getByTestId("title");

/** Three rows, newest first; the middle one is acted on. */
function seed(backend: FakeBackend) {
  backend.addBookmark({ title: "First" });
  const middle = backend.addBookmark({ title: "Middle" });
  backend.addBookmark({ title: "Last" });
  return middle;
}

async function deleteFromReader(page: Page) {
  await openRow(page, "Middle");
  await menuAction(page, "delete-item");
  await expect(page).toHaveURL(/\/$/);
}

test("undo after archiving puts the row back where it was in the list", async ({
  page,
  backend,
}) => {
  const middle = seed(backend);
  await page.goto("/");
  await openRow(page, "Middle");
  await menuAction(page, "archive-item");

  await expect(page).toHaveURL(/\/$/);
  await expect(titles(page)).toHaveText(["First", "Last"]);
  await expect(toast(page)).toContainText("Archived");
  expect(backend.bookmark(middle.id)?.archived).toBe(true);

  await undoButton(page).click();

  await expect(titles(page)).toHaveText(["First", "Middle", "Last"]);
  await expect(toast(page)).toHaveText("");
  await expect.poll(() => backend.bookmark(middle.id)?.archived).toBe(false);
});

test("undo after deleting from the reader puts the row back and nothing is deleted", async ({
  page,
  backend,
}) => {
  const middle = seed(backend);
  await page.clock.install();
  await page.goto("/");
  await deleteFromReader(page);

  await expect(titles(page)).toHaveText(["First", "Last"]);
  await expect(toast(page)).toContainText("Deleted");
  // Undo is a real button, reachable from the keyboard.
  await undoButton(page).focus();
  await page.keyboard.press("Enter");

  await expect(titles(page)).toHaveText(["First", "Middle", "Last"]);
  await page.clock.fastForward(UNDO_WINDOW_MS * 2);
  expect(backend.callsTo("rest", "bookmarks", "DELETE")).toHaveLength(0);
  expect(backend.bookmark(middle.id)).toBeDefined();
});

test("a delete reaches the server once the undo window is over", async ({ page, backend }) => {
  const middle = seed(backend);
  await page.clock.install();
  await page.goto("/");
  await deleteFromReader(page);

  await page.clock.fastForward(UNDO_WINDOW_MS - 500);
  expect(backend.callsTo("rest", "bookmarks", "DELETE")).toHaveLength(0);
  await expect(undoButton(page)).toBeVisible();

  await page.clock.fastForward(500);
  await expect.poll(() => backend.bookmark(middle.id)).toBeUndefined();
  await expect(toast(page)).toHaveText("");
  await expect(titles(page)).toHaveText(["First", "Last"]);
});

test("a delete still in its undo window is sent when the page is hidden", async ({
  page,
  backend,
}) => {
  const middle = seed(backend);
  await page.clock.install();
  await page.goto("/");
  await deleteFromReader(page);

  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide")));

  await expect.poll(() => backend.bookmark(middle.id)).toBeUndefined();
  expect(backend.callsTo("rest", "bookmarks", "DELETE")).toHaveLength(1);
  await expect(toast(page)).toHaveText("");
});

test("a second delete sends the first at once; only the second can be undone", async ({
  page,
  backend,
}) => {
  const middle = seed(backend);
  await page.clock.install();
  await page.goto("/");
  await deleteFromReader(page);
  await openRow(page, "Last");
  await menuAction(page, "delete-item");

  await expect.poll(() => backend.bookmark(middle.id)).toBeUndefined();
  await undoButton(page).click();

  await expect(titles(page)).toHaveText(["First", "Last"]);
  await page.clock.fastForward(UNDO_WINDOW_MS * 2);
  expect(backend.callsTo("rest", "bookmarks", "DELETE")).toHaveLength(1);
});

test("signing out sends a delete still in its undo window first", async ({ page, backend }) => {
  const middle = seed(backend);
  await page.clock.install();
  await page.goto("/");
  await deleteFromReader(page);
  // In-app navigation: a reload would itself be a page hide.
  await page.getByRole("button", { name: "Settings" }).click();
  expect(backend.callsTo("rest", "bookmarks", "DELETE")).toHaveLength(0);
  await page.getByTestId("sign-out-btn").click();

  await expect(page).toHaveURL(/\/login/);
  expect(backend.bookmark(middle.id)).toBeUndefined();
});
