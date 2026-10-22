import { expect, rows, test, USER } from "./fixtures";

function captureUrl(params: Record<string, string>) {
  return `/capture?${new URLSearchParams(params)}`;
}

test.describe("bookmarklet popup (/capture)", () => {
  test("shows what will be saved and saves only on the Save click", async ({ page, backend }) => {
    await page.goto(captureUrl({ url: "https://blog.example.com/post", title: "A post" }));

    const panel = page.getByTestId("confirm-panel");
    await expect(panel).toContainText("A post");
    await expect(panel).toContainText("https://blog.example.com/post");
    // Opening the URL alone must never save (any site can open it).
    await page.waitForTimeout(300);
    expect(backend.callsTo("rest", "bookmarks", "POST")).toHaveLength(0);

    await page.getByTestId("save-btn").click();
    await expect(page.getByTestId("status-placeholder")).toContainText("Saved");
    expect(backend.bookmarks).toEqual([
      expect.objectContaining({
        url: "https://blog.example.com/post",
        title: "A post",
        status: "pending",
      }),
    ]);
  });

  test("the Save button is focused so Enter saves", async ({ page, backend }) => {
    await page.goto(captureUrl({ url: "https://example.com/enter" }));
    await expect(page.getByTestId("save-btn")).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("status-placeholder")).toContainText("Saved");
    expect(backend.bookmarks).toHaveLength(1);
  });

  test("refuses non-http URLs and empty requests without offering Save", async ({
    page,
    backend,
  }) => {
    await page.goto(captureUrl({ url: "javascript:alert(document.cookie)" }));
    await expect(page.getByTestId("status-placeholder")).toContainText(
      "Only http(s) pages can be saved.",
    );
    await expect(page.getByTestId("save-btn")).toHaveCount(0);

    await page.goto("/capture");
    await expect(page.getByTestId("status-placeholder")).toContainText("Nothing to save.");
    expect(backend.callsTo("rest", "bookmarks", "POST")).toHaveLength(0);
  });

  test("an already-saved URL says when, and Continue re-queues it", async ({ page, backend }) => {
    const existing = backend.addBookmark({
      url: "https://example.com/again",
      created_at: "2026-03-04T10:00:00.000Z",
    });
    await page.goto(captureUrl({ url: "https://example.com/again/" }));
    await page.getByTestId("save-btn").click();

    await expect(page.getByTestId("status-placeholder")).toContainText("Already saved on");
    await page.getByTestId("continue-btn").click();
    await expect(page.getByTestId("status-placeholder")).toContainText("Saved");
    expect(backend.bookmark(existing.id)?.status).toBe("pending");
    expect(backend.bookmarks).toHaveLength(1);
  });

  test.describe("signed out", () => {
    test.use({ auth: "signed-out" });

    test("goes to login instead of saving, then back to the same capture", async ({
      page,
      backend,
    }) => {
      await page.goto(captureUrl({ url: "https://example.com/x" }));
      await expect(page).toHaveURL(/\/login\?redirect=/);
      expect(backend.callsTo("rest")).toHaveLength(0);

      await page.getByLabel("Email").fill(USER.email);
      await page.getByLabel("Password").fill(USER.password);
      await page.getByRole("button", { name: "Sign in" }).click();

      await expect(page).toHaveURL(/\/capture\?/);
      await expect(page.getByTestId("save-btn")).toBeVisible();
      // Still nothing saved until the click.
      expect(backend.bookmarks).toHaveLength(0);
    });
  });
});

test.describe("share target (/share-target)", () => {
  test("a shared URL is saved after Save and the app routes to the list", async ({
    page,
    backend,
  }) => {
    await page.goto("/share-target?url=https%3A%2F%2Fexample.com%2Fshared&title=Shared%20page");
    await expect(page.getByTestId("shared-title")).toHaveText("Shared page");
    await expect(page.getByTestId("confirm-panel")).toContainText("https://example.com/shared");
    expect(backend.bookmarks).toHaveLength(0);

    await page.getByTestId("save-btn").click();
    await expect(page).toHaveURL(/\/$/);
    await expect(rows(page)).toHaveCount(1);
    expect(backend.bookmarks[0]).toMatchObject({
      url: "https://example.com/shared",
      title: "Shared page",
      status: "pending",
    });
  });

  test("shared text is saved as a ready note", async ({ page, backend }) => {
    await page.goto(
      `/share-target?${new URLSearchParams({ text: "Remember: buy oat milk.\nAnd bread." })}`,
    );
    await expect(page.getByTestId("confirm-panel")).toContainText("Remember: buy oat milk.");
    await page.getByTestId("save-btn").click();

    await expect(page).toHaveURL(/\/$/);
    await expect(rows(page).first()).toContainText("Remember: buy oat milk.");
    expect(backend.bookmarks[0]).toMatchObject({
      type: "note",
      status: "ready",
      url: null,
      content_md: "Remember: buy oat milk.\nAnd bread.",
    });
  });

  test("text that is just a URL is saved as that URL", async ({ page, backend }) => {
    await page.goto(`/share-target?${new URLSearchParams({ text: "https://example.com/bare" })}`);
    await page.getByTestId("save-btn").click();
    await expect(page).toHaveURL(/\/$/);
    expect(backend.bookmarks[0]).toMatchObject({
      type: "article",
      url: "https://example.com/bare",
      status: "pending",
    });
  });

  test("a non-http URL is refused with a way back to the list", async ({ page, backend }) => {
    await page.goto(`/share-target?${new URLSearchParams({ url: "ftp://example.com/file" })}`);
    await expect(page.getByTestId("status-placeholder")).toContainText(
      "Only http(s) pages can be saved.",
    );
    await expect(page.getByTestId("save-btn")).toHaveCount(0);
    await page.getByRole("button", { name: "Back to list" }).click();
    await expect(page).toHaveURL(/\/$/);
    expect(backend.callsTo("rest", "bookmarks", "POST")).toHaveLength(0);
  });

  test("a duplicate offers Continue, which re-queues it and opens the list", async ({
    page,
    backend,
  }) => {
    const existing = backend.addBookmark({ url: "https://example.com/dupe", title: "Dupe" });
    await page.goto(`/share-target?${new URLSearchParams({ url: "https://example.com/dupe" })}`);
    await page.getByTestId("save-btn").click();
    await expect(page.getByTestId("status-placeholder")).toContainText("Already saved on");
    await page.getByTestId("continue-btn").click();
    await expect(page).toHaveURL(/\/$/);
    expect(backend.bookmark(existing.id)?.status).toBe("pending");
  });

  test("Cancel goes to the list without saving", async ({ page, backend }) => {
    await page.goto(`/share-target?${new URLSearchParams({ text: "Never mind" })}`);
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page).toHaveURL(/\/$/);
    expect(backend.bookmarks).toHaveLength(0);
  });
});
