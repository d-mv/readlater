import { expect, openRow, readerTitle, row, rows, test } from "./fixtures";

test("lists unarchived bookmarks newest first with type, status and badges", async ({
  page,
  backend,
}) => {
  backend.addBookmark({ title: "Newest article", reading_time: 4 });
  backend.addBookmark({
    title: "A video",
    type: "youtube",
    url: "https://www.youtube.com/watch?v=abc",
  });
  backend.addBookmark({ title: "Shared one", is_public: true });
  backend.addBookmark({ title: "Translated one", translated_lang: "EN" });
  backend.addBookmark({ title: null, status: "pending", url: "https://example.com/queued" });
  backend.addBookmark({ title: null, status: "failed", url: "https://example.com/broken" });
  backend.addBookmark({ title: "Archived one", archived: true });

  await page.goto("/");

  await expect(rows(page).getByTestId("title")).toHaveText([
    "Newest article",
    "A video",
    "Shared one",
    "Translated one",
    "Processing…",
    "Failed to process",
  ]);
  await expect(row(page, "Newest article")).toContainText("example.com · 4 min");
  await expect(row(page, "Shared one").getByTestId("public-badge")).toBeVisible();
  await expect(row(page, "Translated one").getByTestId("translated-badge")).toBeVisible();
  await expect(row(page, "Newest article").getByTestId("translated-badge")).toHaveCount(0);
  await expect(row(page, "Newest article").getByTestId("public-badge")).toHaveCount(0);
});

test("All/Archived tabs filter the list and the unread count ignores read and archived rows", async ({
  page,
  backend,
}) => {
  backend.addBookmark({ title: "Unread 1" });
  backend.addBookmark({ title: "Unread 2" });
  backend.addBookmark({ title: "Read already", read_at: "2026-05-02T00:00:00Z" });
  backend.addBookmark({ title: "Old archived", archived: true });

  await page.goto("/");
  const allTab = page.getByTestId("tab").filter({ hasText: "All" });
  const archivedTab = page.getByTestId("tab").filter({ hasText: "Archived" });

  await expect(allTab).toHaveAttribute("aria-pressed", "true");
  await expect(rows(page)).toHaveCount(3);
  await expect(page.getByText("2 unread")).toBeVisible();
  await expect(row(page, "Read already").getByTestId("title")).toHaveAttribute("data-read", "true");
  await expect(row(page, "Read already")).toContainText("read");

  await archivedTab.click();
  await expect(archivedTab).toHaveAttribute("aria-pressed", "true");
  await expect(rows(page).getByTestId("title")).toHaveText(["Old archived"]);

  await allTab.click();
  await expect(rows(page)).toHaveCount(3);
});

test("empty states: no bookmarks at all, and an empty Archived tab", async ({ page, backend }) => {
  await page.goto("/");
  await expect(page.getByTestId("empty-state")).toHaveText("Nothing here yet.");
  await expect(page.getByText(/unread/)).toHaveCount(0);

  backend.addBookmark({ title: "Only unarchived" });
  await page.reload();
  await expect(rows(page)).toHaveCount(1);
  await page.getByTestId("tab").filter({ hasText: "Archived" }).click();
  await expect(page.getByTestId("empty-state")).toBeVisible();
});

test("tag filter chips narrow the list to rows carrying every selected tag", async ({
  page,
  backend,
}) => {
  backend.addBookmark({ title: "Rust and web", tags: ["rust", "web"] });
  backend.addBookmark({ title: "Only rust", tags: ["rust"] });
  backend.addBookmark({ title: "Untagged" });

  await page.goto("/");
  const bar = page.getByTestId("tag-filter-bar");
  await expect(bar.getByTestId("tag-chip")).toHaveText(["rust", "web"]);

  const rust = bar.getByTestId("tag-chip").filter({ hasText: "rust" });
  const web = bar.getByTestId("tag-chip").filter({ hasText: "web" });
  await rust.click();
  await expect(rust).toHaveAttribute("aria-pressed", "true");
  await expect(rows(page).getByTestId("title")).toHaveText(["Rust and web", "Only rust"]);

  await web.click();
  await expect(rows(page).getByTestId("title")).toHaveText(["Rust and web"]);

  await rust.click();
  await web.click();
  await expect(rows(page)).toHaveCount(3);
});

test("search runs on submit, not per keystroke, and clearing it restores the list", async ({
  page,
  backend,
}) => {
  backend.addBookmark({ title: "Gardening in spring", content_md: "Tomatoes and basil." });
  backend.addBookmark({ title: "Compilers", content_md: "Parsing and tomatoes? No." });
  backend.addBookmark({ title: "Databases", content_md: "Indexes." });

  await page.goto("/");
  await expect(rows(page)).toHaveCount(3);
  const searches = () =>
    backend.callsTo("rest", "bookmarks", "GET").filter((c) => c.params.has("search_vector"));

  const input = page.getByTestId("search-input");
  await input.fill("tomatoes");
  await page.waitForTimeout(300);
  expect(searches()).toHaveLength(0);

  await input.press("Enter");
  await expect(rows(page).getByTestId("title")).toHaveText(["Gardening in spring", "Compilers"]);
  expect(searches()).toHaveLength(1);
  expect(searches()[0]!.params.get("search_vector")).toBe("wfts.tomatoes");

  await input.fill("no such words");
  await input.press("Enter");
  await expect(page.getByTestId("empty-state")).toBeVisible();

  await input.fill("");
  await expect(rows(page)).toHaveCount(3);
});

test("infinite scroll pages in older bookmarks, and Load more retries a failed page", async ({
  page,
  backend,
}) => {
  backend.addBookmarks(120, (i) => ({ title: `Bookmark ${String(i + 1).padStart(3, "0")}` }));
  // The second page fails once.
  backend.fail((call) => call.name === "bookmarks" && call.params.has("or"), { times: 1 });

  await page.goto("/");
  await expect(rows(page)).toHaveCount(50);
  await expect(rows(page).last()).toContainText("Bookmark 050");

  // Scrolling to the bottom brings the sentinel into range; the failed page
  // leaves the Load more button to retry with.
  await rows(page).last().scrollIntoViewIfNeeded();
  const loadMore = page.getByTestId("load-more");
  await expect(loadMore).toBeVisible();
  await expect(rows(page)).toHaveCount(50);

  await loadMore.click();
  await expect(rows(page)).toHaveCount(100);
  await rows(page).last().scrollIntoViewIfNeeded();
  await expect(rows(page)).toHaveCount(120);
  await expect(rows(page).last()).toContainText("Bookmark 120");
  await expect(loadMore).toHaveCount(0);

  // Keyset paging: every row exactly once.
  const titles = await rows(page).getByTestId("title").allTextContents();
  expect(new Set(titles).size).toBe(120);
});

test("a Realtime INSERT and DELETE update the open list without a reload", async ({
  page,
  backend,
}) => {
  const first = backend.addBookmark({ title: "Already listed" });
  await page.goto("/");
  await expect(rows(page)).toHaveCount(1);
  await expect.poll(() => backend.realtimeJoined).toBe(true);

  const captured = backend.addBookmark({
    title: "Captured elsewhere",
    created_at: "2026-06-02T00:00:00.000Z",
  });
  backend.pushChange("INSERT", captured);
  await expect(rows(page).getByTestId("title")).toHaveText([
    "Captured elsewhere",
    "Already listed",
  ]);

  backend.pushChange("DELETE", first);
  await expect(rows(page).getByTestId("title")).toHaveText(["Captured elsewhere"]);
});

test("the list keeps working when Realtime is unavailable", async ({ page, backend }) => {
  backend.realtimeMode = "close";
  backend.addBookmark({ title: "Still listed" });
  await page.goto("/");
  await expect(rows(page)).toHaveText([/Still listed/]);
});

test("returning to the list delta-syncs changes and deletions instead of re-reading the page", async ({
  page,
  backend,
}) => {
  const kept = backend.addBookmark({ title: "Kept" });
  const doomed = backend.addBookmark({ title: "Deleted elsewhere" });
  await page.goto("/");
  await expect(rows(page)).toHaveCount(2);

  await openRow(page, "Kept");
  await expect(readerTitle(page)).toHaveText("Kept");

  // Meanwhile, another device renames one row and deletes the other.
  kept.title = "Kept, renamed";
  kept.updated_at = backend.now();
  backend.bookmarks = backend.bookmarks.filter((b) => b.id !== doomed.id);
  backend.deletions.push({ bookmark_id: doomed.id, deleted_at: backend.now() });

  await page.getByTestId("back-btn").click();
  await expect(rows(page).getByTestId("title")).toHaveText(["Kept, renamed"]);
  const deltaCalls = backend.callsTo("rest", "bookmark_deletions", "GET");
  expect(deltaCalls.length).toBeGreaterThan(0);
});
