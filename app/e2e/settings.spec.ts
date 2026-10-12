import { readFile } from "node:fs/promises";

import { AUTH_STORAGE_KEY } from "./supabaseEnv";
import {
  article,
  expect,
  offlineStoreKeys,
  openMenu,
  putOfflineRecord,
  rows,
  test,
} from "./fixtures";

test("the theme toggle cycles light → dark → system and survives a reload", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  const html = page.locator("html");
  const toggle = page.getByTestId("theme-toggle");

  await expect(toggle).toHaveAttribute("title", "Theme: system. Switch to light");
  await expect(html).toHaveAttribute("data-theme", "dark");

  await toggle.click();
  await expect(html).toHaveAttribute("data-theme", "light");
  await expect(toggle).toHaveAttribute("title", "Theme: light. Switch to dark");

  await toggle.click();
  await expect(html).toHaveAttribute("data-theme", "dark");
  await page.emulateMedia({ colorScheme: "light" });
  await page.reload();
  // Applied by theme-init.js before the app mounts, and kept by the store.
  await expect(html).toHaveAttribute("data-theme", "dark");
  await expect(page.getByTestId("theme-toggle")).toHaveAttribute(
    "title",
    "Theme: dark. Switch to system",
  );

  await page.getByTestId("theme-toggle").click();
  await expect(html).toHaveAttribute("data-theme", "light");
  await page.emulateMedia({ colorScheme: "dark" });
  // "system" follows the OS live.
  await expect(html).toHaveAttribute("data-theme", "dark");
});

test("the reader font size steps by 2px within 14–24px and is remembered", async ({
  page,
  backend,
}) => {
  const bookmark = backend.addBookmark({ title: "Sized", content_md: "Some text." });
  await page.goto(`/b/${bookmark.id}`);
  const fontSize = () =>
    article(page)
      .locator("p")
      .first()
      .evaluate((el) => getComputedStyle(el).fontSize);
  await expect.poll(fontSize).toBe("16px");

  const panel = await openMenu(page);
  const increase = panel.getByTestId("font-size-increase");
  const decrease = panel.getByTestId("font-size-decrease");
  await increase.click();
  await expect.poll(fontSize).toBe("18px");
  for (let i = 0; i < 3; i += 1) await increase.click();
  await expect.poll(fontSize).toBe("24px");
  await expect(increase).toBeDisabled();

  await page.reload();
  await expect.poll(fontSize).toBe("24px");

  await openMenu(page);
  for (let i = 0; i < 5; i += 1) await decrease.click();
  await expect.poll(fontSize).toBe("14px");
  await expect(decrease).toBeDisabled();
});

test("settings is reachable from the list and Back returns", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await page.getByRole("button", { name: "Back" }).click();
  await expect(page).toHaveURL(/\/$/);
});

test("export downloads every bookmark with its tags as JSON", async ({ page, backend }) => {
  backend.addBookmark({ title: "First", url: "https://example.com/1", tags: ["keep"] });
  backend.addBookmark({ title: "A note", type: "note", url: null, content_md: "Noted." });
  await page.goto("/settings");

  const download = page.waitForEvent("download");
  await page.getByTestId("export-btn").click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^readlater-export-\d{4}-\d{2}-\d{2}\.json$/);
  const payload = JSON.parse(await readFile((await file.path())!, "utf8"));
  expect(payload.version).toBe(1);
  expect(payload.bookmarks).toHaveLength(2);
  expect(payload.bookmarks[0]).toMatchObject({
    title: "First",
    url: "https://example.com/1",
    tags: [{ name: "keep" }],
  });
  expect(payload.bookmarks[0]).not.toHaveProperty("id");
  expect(payload.bookmarks[1]).toMatchObject({ type: "note", content_md: "Noted." });
});

test("a failed export shows an error", async ({ page, backend }) => {
  await page.goto("/settings");
  backend.fail((c) => c.name === "bookmarks" && c.method === "GET", {
    body: { code: "XX000", message: "export broke", details: null, hint: null },
  });
  await page.getByTestId("export-btn").click();
  await expect(page.getByTestId("error")).toHaveText("export broke");
});

test("import adds new bookmarks with tags and reports skipped rows", async ({ page, backend }) => {
  backend.addBookmark({ title: "Already here", url: "https://example.com/dup" });
  await page.goto("/settings");

  const payload = {
    version: 1,
    exported_at: "2026-01-01T00:00:00Z",
    bookmarks: [
      {
        url: "https://example.com/new",
        type: "article",
        status: "ready",
        title: "Brand new",
        content_md: "Imported body.",
        tags: [{ name: "imported", color: "#123456" }],
      },
      { url: "https://EXAMPLE.com/dup/", type: "article", status: "ready", title: "Dup" },
      { url: "javascript:alert(1)", type: "article", status: "ready", title: "Evil" },
      { type: "article", status: "ready", title: "No URL" },
    ],
  };
  await page.locator('input[type="file"][accept="application/json"]').setInputFiles({
    name: "export.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(payload)),
  });

  await expect(page.getByTestId("result")).toContainText("Imported 1 bookmark. Skipped 3:");
  await expect(page.getByTestId("skipped-list").locator("li")).toHaveText([
    "Evil — invalid row: url must be http(s)",
    "No URL — invalid row: missing url",
    "Dup — already exists",
  ]);
  const imported = backend.bookmarks.find((b) => b.url === "https://example.com/new");
  expect(imported).toMatchObject({ title: "Brand new", content_md: "Imported body." });
  expect(backend.tagNamesOf(imported!.id)).toEqual(["imported"]);

  await page.getByRole("button", { name: "Back" }).click();
  await expect(rows(page)).toHaveCount(2);
});

test("importing something that isn't an export shows an error", async ({ page }) => {
  await page.goto("/settings");
  await page.locator('input[type="file"][accept="application/json"]').setInputFiles({
    name: "junk.json",
    mimeType: "application/json",
    buffer: Buffer.from("{not json"),
  });
  await expect(page.getByTestId("error")).toHaveText("That file isn't valid JSON.");
});

test("sign out clears the device's copy and routes to the login screen", async ({
  page,
  backend,
}) => {
  const bookmark = backend.addBookmark({ title: "Private reading" });
  await page.goto("/");
  await expect(rows(page)).toHaveCount(1);
  // A downloaded article and the persisted list, written directly: the app's
  // own writes currently fail (see offline.spec.ts).
  await putOfflineRecord(page, "bookmarksList", { id: bookmark.id, title: bookmark.title });
  await putOfflineRecord(page, "articles", {
    id: bookmark.id,
    content_md: "Private body.",
    images: [],
    missingImages: [],
    cachedAt: new Date().toISOString(),
  });
  expect(await offlineStoreKeys(page, "articles")).toEqual([bookmark.id]);
  expect(await page.evaluate(() => localStorage.getItem("rl-auth-user"))).not.toBeNull();

  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByTestId("sign-out-btn").click();

  await expect(page).toHaveURL(/\/login$/);
  expect(await page.evaluate((key) => localStorage.getItem(key), AUTH_STORAGE_KEY)).toBeNull();
  expect(await page.evaluate(() => localStorage.getItem("rl-auth-user"))).toBeNull();
  expect(await offlineStoreKeys(page, "articles")).toEqual([]);
  expect(await offlineStoreKeys(page, "bookmarksList")).toEqual([]);
  expect(backend.callsTo("auth", "logout")).toHaveLength(1);

  // Nothing left to get back in with.
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
});
