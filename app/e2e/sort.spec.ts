import { expect, offlineStoreKeys, rows, test } from "./fixtures";

// Seeded rows go back in time: "Bookmark 001" is the newest.
const title = (i: number) => `Bookmark ${String(i + 1).padStart(3, "0")}`;

test("oldest first pages through every row in ascending order, and the choice survives a reload", async ({
  page,
  backend,
}) => {
  backend.addBookmarks(120, (i) => ({ title: title(i) }));
  await page.goto("/");
  await expect(rows(page).first()).toContainText("Bookmark 001");

  const toggle = page.getByTestId("sort-toggle");
  await expect(toggle).toHaveAccessibleName("Oldest first");
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");

  await expect(rows(page)).toHaveCount(50);
  await expect(rows(page).first()).toContainText("Bookmark 120");
  await expect(rows(page).last()).toContainText("Bookmark 071");

  await rows(page).last().scrollIntoViewIfNeeded();
  await expect(rows(page)).toHaveCount(100);
  await rows(page).last().scrollIntoViewIfNeeded();
  await expect(rows(page)).toHaveCount(120);
  await expect(page.getByTestId("load-more")).toHaveCount(0);
  const titles = await rows(page).getByTestId("title").allTextContents();
  expect(titles).toEqual(Array.from({ length: 120 }, (_, i) => title(119 - i)));

  // The keyset cursor runs forward: created_at greater than the newest loaded.
  const pages = backend
    .callsTo("rest", "bookmarks", "GET")
    .filter((c) => c.params.get("order")?.startsWith("created_at.asc"));
  expect(pages.length).toBe(3);
  expect(pages[1]!.params.get("or")).toMatch(/^\(created_at\.gt\./);

  await page.reload();
  await expect(page.getByTestId("sort-toggle")).toHaveAttribute("aria-pressed", "true");
  await expect(rows(page).first()).toContainText("Bookmark 120");
});

test("oldest first leaves the persisted newest-first list alone, and newest first resumes it by delta", async ({
  page,
  backend,
}) => {
  const seeded = backend.addBookmarks(60, (i) => ({ title: title(i) }));
  const newestPage = seeded.slice(0, 50).map((b) => b.id);
  await page.goto("/");
  await expect(rows(page)).toHaveCount(50);
  await expect
    .poll(async () => (await offlineStoreKeys(page, "bookmarksList")).sort())
    .toEqual([...newestPage].sort());

  await page.getByTestId("sort-toggle").click();
  await expect(rows(page).first()).toContainText("Bookmark 060");
  await rows(page).last().scrollIntoViewIfNeeded();
  await expect(rows(page)).toHaveCount(60);
  // A capture elsewhere: oldest first it sorts last, and the end is loaded.
  await expect.poll(() => backend.realtimeJoined).toBe(true);
  const captured = backend.addBookmark({
    title: "Captured elsewhere",
    created_at: "2026-06-02T00:00:00.000Z",
  });
  backend.pushChange("INSERT", captured);
  await expect(rows(page).last()).toContainText("Captured elsewhere");

  // Give any (wrong) persist a moment, then check nothing was rewritten.
  await page.waitForTimeout(300);
  expect((await offlineStoreKeys(page, "bookmarksList")).sort()).toEqual([...newestPage].sort());

  const deltasBefore = backend.callsTo("rest", "bookmark_deletions", "GET").length;
  await page.getByTestId("sort-toggle").click();
  await expect(rows(page).first()).toContainText("Captured elsewhere");
  await expect(rows(page).nth(1)).toContainText("Bookmark 001");
  expect(backend.callsTo("rest", "bookmark_deletions", "GET").length).toBe(deltasBefore + 1);
});

test("search results follow the chosen order", async ({ page, backend }) => {
  backend.addBookmark({ title: "Tomatoes, newer", content_md: "tomatoes" });
  backend.addBookmark({ title: "Tomatoes, older", content_md: "tomatoes" });
  backend.addBookmark({ title: "Basil", content_md: "basil" });
  await page.goto("/");
  await page.getByTestId("sort-toggle").click();
  await expect(rows(page).getByTestId("title")).toHaveText([
    "Basil",
    "Tomatoes, older",
    "Tomatoes, newer",
  ]);

  const input = page.getByTestId("search-input");
  await input.fill("tomatoes");
  await input.press("Enter");
  await expect(rows(page).getByTestId("title")).toHaveText(["Tomatoes, older", "Tomatoes, newer"]);

  const searches = () =>
    backend.callsTo("rest", "bookmarks", "GET").filter((c) => c.params.has("search_vector"));
  expect(searches()).toHaveLength(1);
  // Switching re-sorts the result set without running the search again.
  await page.getByTestId("sort-toggle").click();
  await expect(rows(page).getByTestId("title")).toHaveText(["Tomatoes, newer", "Tomatoes, older"]);
  expect(searches()).toHaveLength(1);
});
