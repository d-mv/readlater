import { expect, openMenu, rows, test } from "./fixtures";

test("the Add dialog is modal: focus moves in, Escape closes it and focus returns", async ({
  page,
}) => {
  await page.goto("/");
  const add = page.getByTestId("add-btn");
  await add.focus();
  await page.keyboard.press("Enter");

  const dialog = page.locator("dialog[open]");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("URL")).toBeFocused();
  // Opened with showModal(): the page behind is inert.
  expect(await dialog.evaluate((el) => el.matches(":modal"))).toBe(true);

  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(add).toBeFocused();
});

test("the share sheet closes on Escape", async ({ page, backend }) => {
  const bookmark = backend.addBookmark();
  await page.goto(`/b/${bookmark.id}`);
  await openMenu(page);
  await page.getByTestId("share-item").click();
  const sheet = page.getByRole("dialog", { name: "Share bookmark" });
  await expect(sheet).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(sheet).toHaveCount(0);
});

test("the reader menu supports arrow keys, Home/End and Escape", async ({ page, backend }) => {
  const bookmark = backend.addBookmark({ url: "https://example.com/menu" });
  await page.goto(`/b/${bookmark.id}`);

  const trigger = page.getByTestId("menu-trigger");
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await trigger.focus();
  await page.keyboard.press("Enter");
  await expect(trigger).toHaveAttribute("aria-expanded", "true");

  const items = page.getByRole("menu", { name: "Article actions" }).getByRole("menuitem");
  const names = await items.allTextContents();
  expect(names.map((n) => n.trim())).toEqual([
    "Open original",
    "Translate…",
    "Translate page",
    "Edit",
    "Mark as read",
    "Share…",
    "Archive",
    "Delete",
  ]);

  // Opening focuses the first item.
  await expect(items.first()).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(items.nth(1)).toBeFocused();
  await page.keyboard.press("End");
  await expect(items.last()).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(items.first()).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(items.last()).toBeFocused();
  await page.keyboard.press("Home");
  await expect(items.first()).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(page.getByTestId("menu-panel")).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test("a click outside the reader menu closes it", async ({ page, backend }) => {
  const bookmark = backend.addBookmark();
  await page.goto(`/b/${bookmark.id}`);
  await openMenu(page);
  // Bottom-left corner: clear of the panel, which covers most of a phone's width.
  const { height } = page.viewportSize()!;
  await page.locator("body").click({ position: { x: 4, y: height - 4 } });
  await expect(page.getByTestId("menu-panel")).toHaveCount(0);
});

test("list controls have accessible names", async ({ page, backend }) => {
  backend.addBookmark({ tags: ["a11y"] });
  await page.goto("/");
  await expect(rows(page)).toHaveCount(1);
  await expect(page.getByRole("searchbox", { name: "Search bookmarks" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Settings" })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Theme: / })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save offline" })).toBeVisible();
  await expect(page.getByRole("button", { name: "a11y" })).toHaveAttribute("aria-pressed", "false");
});
