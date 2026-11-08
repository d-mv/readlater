import type { Page } from "@playwright/test";

import { expect, menuAction, openMenu, openRow, readerTitle, rows, test } from "./fixtures";

/** The title of the row holding keyboard focus, and whether its ring shows. */
function focusedRow(page: Page) {
  return page.evaluate(() => {
    const active = document.activeElement;
    const row = active?.closest('[data-testid="row"]');
    return {
      title: row?.querySelector('[data-testid="title"]')?.textContent ?? null,
      ringVisible: active?.matches(":focus-visible") ?? false,
    };
  });
}

test("in the list, j/k move a visible focus through the rows and o opens one", async ({
  page,
  backend,
}) => {
  backend.addBookmark({ title: "First" });
  backend.addBookmark({ title: "Second" });
  backend.addBookmark({ title: "Third" });
  await page.goto("/");
  await expect(rows(page)).toHaveCount(3);

  await page.keyboard.press("j");
  expect(await focusedRow(page)).toEqual({ title: "First", ringVisible: true });
  await page.keyboard.press("j");
  await page.keyboard.press("ArrowDown");
  expect((await focusedRow(page)).title).toBe("Third");
  await page.keyboard.press("k");
  expect((await focusedRow(page)).title).toBe("Second");

  await page.keyboard.press("o");
  await expect(readerTitle(page)).toHaveText("Second");

  // Enter, the button's own key, opens the focused row as well.
  await page.keyboard.press("u");
  await expect(rows(page)).toHaveCount(3);
  await page.keyboard.press("j");
  await page.keyboard.press("Enter");
  await expect(readerTitle(page)).toHaveText("First");
});

test("in the list, / goes to search (where keys are text), a opens Add, ? lists the shortcuts", async ({
  page,
  backend,
}) => {
  backend.addBookmark({ title: "Only" });
  await page.goto("/");
  await expect(rows(page)).toHaveCount(1);

  await page.keyboard.press("/");
  const search = page.getByTestId("search-input");
  await expect(search).toBeFocused();
  await page.keyboard.type("jk/a?");
  await expect(search).toHaveValue("jk/a?");
  await expect(search).toBeFocused();
  await expect(page.locator("dialog")).toHaveCount(0);

  await search.fill("");
  await search.blur();
  await page.keyboard.press("a");
  await expect(page.locator("dialog")).toBeVisible();
  // Keys typed into the dialog are the dialog's.
  await page.keyboard.type("j");
  await page.keyboard.press("Escape");
  await expect(page.locator("dialog")).toHaveCount(0);

  await page.keyboard.press("?");
  const help = page.getByTestId("shortcuts-help");
  await expect(help).toBeVisible();
  await expect(help).toHaveAccessibleName("Keyboard shortcuts");
  await expect(help).toContainText("Next item");
  await page.keyboard.press("Escape");
  await expect(help).toHaveCount(0);
});

test("in the reader, m toggles read, e archives with an Undo toast, Escape goes back", async ({
  page,
  backend,
}) => {
  const kept = backend.addBookmark({ title: "Kept" });
  const archived = backend.addBookmark({ title: "To archive" });
  await page.goto("/");

  await openRow(page, "Kept");
  await page.keyboard.press("m");
  await expect.poll(() => backend.bookmark(kept.id)?.read_at).not.toBeNull();
  // The write has landed here too once the menu offers the way back. (Escape
  // inside the menu is the menu's: it closes it, the reader stays.)
  await expect((await openMenu(page)).getByTestId("mark-unread")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("menu-panel")).toHaveCount(0);
  await expect(readerTitle(page)).toHaveText("Kept");
  await page.keyboard.press("m");
  await expect.poll(() => backend.bookmark(kept.id)?.read_at).toBeNull();

  await page.keyboard.press("?");
  await expect(page.getByTestId("shortcuts-help")).toContainText("Back to list");
  // Escape closes the help first; the reader stays.
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("shortcuts-help")).toHaveCount(0);
  await expect(readerTitle(page)).toHaveText("Kept");

  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/\/$/);

  await openRow(page, "To archive");
  await page.keyboard.press("e");
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId("undo-toast")).toContainText("Archived");
  expect(backend.bookmark(archived.id)?.archived).toBe(true);
  await expect(rows(page).getByTestId("title")).toHaveText(["Kept"]);
});

test("typing in the editor never triggers the reader's shortcuts", async ({ page, backend }) => {
  const bookmark = backend.addBookmark({ title: "Draft", content_md: "Body" });
  await page.goto("/");
  await openRow(page, "Draft");
  await menuAction(page, "edit-item");
  const editor = page.locator(".cm-content");
  await expect(editor).toBeVisible();

  await editor.click();
  await page.keyboard.type(" eum?");
  await page.keyboard.press("Escape");

  await expect(editor).toContainText("eum?");
  await expect(page).toHaveURL(new RegExp(`/b/${bookmark.id}$`));
  await expect(page.getByTestId("shortcuts-help")).toHaveCount(0);
  expect(backend.bookmark(bookmark.id)?.archived).toBe(false);
  expect(backend.bookmark(bookmark.id)?.read_at).toBeNull();

  // Outside the editor, still editing: the draft is safe from stray keys too.
  await page.getByTestId("title-input").press("Tab");
  await page.keyboard.press("u");
  await expect(page.getByTestId("save-edit-btn")).toBeVisible();
});
