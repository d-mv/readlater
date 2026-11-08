import { expect, openMenu, openRow, rows, test } from "./fixtures";

function sharedLinks(page: import("@playwright/test").Page) {
  return page.getByTestId("shared-links");
}

test("settings lists every shared bookmark with its public link", async ({
  page,
  backend,
  baseURL,
}) => {
  const older = backend.addBookmark({
    title: "Older share",
    is_public: true,
    created_at: "2026-10-01T10:00:00.000000+00:00",
  });
  const newer = backend.addBookmark({
    title: "Newer share",
    is_public: true,
    created_at: "2026-11-01T10:00:00.000000+00:00",
  });
  backend.addBookmark({ title: "Private one", is_public: false });
  await page.goto("/settings");

  const items = sharedLinks(page).getByTestId("shared-link");
  await expect(items.getByTestId("shared-link-title")).toHaveText(["Newer share", "Older share"]);
  await expect(items.first().getByTestId("shared-link-url")).toHaveAttribute(
    "href",
    `${baseURL}/s/${newer.id}`,
  );
  await expect(items.nth(1).getByTestId("shared-link-url")).toHaveText(`${baseURL}/s/${older.id}`);
  // One read, filtered server-side.
  const reads = backend
    .callsTo("rest", "bookmarks", "GET")
    .filter((c) => c.params.get("is_public") === "eq.true");
  expect(reads).toHaveLength(1);
});

test("revoke makes the bookmark private and drops it from the list", async ({ page, backend }) => {
  const shared = backend.addBookmark({ title: "To revoke", is_public: true });
  backend.addBookmark({ title: "Still shared", is_public: true });
  await page.goto("/settings");

  await page.getByRole("button", { name: "Revoke link to To revoke" }).click();
  await expect(sharedLinks(page).getByTestId("shared-link")).toHaveCount(1);
  await expect(sharedLinks(page).getByTestId("shared-link-title")).toHaveText("Still shared");
  expect(backend.bookmark(shared.id)?.is_public).toBe(false);

  // The public view no longer serves it.
  await page.goto(`/s/${shared.id}`);
  await expect(page.getByTestId("status-placeholder")).toHaveText("Not found");
});

test("revoking the last link shows the empty state; a bookmark shared later appears", async ({
  page,
  backend,
}) => {
  const shared = backend.addBookmark({ title: "Only share", is_public: true });
  await page.goto("/settings");
  await page.getByTestId("shared-link-revoke").click();
  await expect(sharedLinks(page).getByTestId("shared-links-empty")).toBeVisible();

  // Shared again (same id, so the same link): listed again on the next visit.
  backend.bookmark(shared.id)!.is_public = true;
  await page.reload();
  await expect(sharedLinks(page).getByTestId("shared-link")).toHaveAttribute("data-id", shared.id);
});

test("a failed revoke keeps the row and shows why", async ({ page, backend }) => {
  const shared = backend.addBookmark({ title: "Stubborn", is_public: true });
  await page.goto("/settings");
  await expect(sharedLinks(page).getByTestId("shared-link")).toHaveCount(1);
  backend.fail((c) => c.name === "bookmarks" && c.method === "PATCH");

  await page.getByTestId("shared-link-revoke").click();
  await expect(page.getByTestId("shared-links-revoke-error")).toBeVisible();
  await expect(sharedLinks(page).getByTestId("shared-link")).toHaveCount(1);
  expect(backend.bookmark(shared.id)?.is_public).toBe(true);
});

test("a failed read shows an error and Try again recovers", async ({ page, backend }) => {
  backend.addBookmark({ title: "Shared", is_public: true });
  backend.fail((c) => c.name === "bookmarks" && c.params.get("is_public") === "eq.true");
  await page.goto("/settings");

  await expect(page.getByTestId("shared-links-error")).toBeVisible();
  await page.getByTestId("shared-links-retry").click();
  await expect(sharedLinks(page).getByTestId("shared-link-title")).toHaveText("Shared");
});

test("no shared bookmarks: the empty state", async ({ page, backend }) => {
  backend.addBookmark({ title: "Private", is_public: false });
  await page.goto("/settings");
  await expect(sharedLinks(page).getByTestId("shared-links-empty")).toHaveText(/Nothing is shared/);
});

test("copy puts the public link on the clipboard", async ({
  page,
  backend,
  context,
  baseURL,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "clipboard permissions are Chromium-only");
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const shared = backend.addBookmark({ title: "Copy me", is_public: true });
  await page.goto("/settings");
  await page.getByRole("button", { name: "Copy link to Copy me" }).click();
  await expect(page.getByTestId("shared-links-status")).toHaveText("Link copied");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    `${baseURL}/s/${shared.id}`,
  );
});

test("a revoke in settings is reflected in the reader's share sheet", async ({ page, backend }) => {
  backend.addBookmark({ title: "Shared from list", is_public: true });
  await page.goto("/");
  await expect(rows(page)).toHaveCount(1);
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByTestId("shared-link-revoke").click();
  await expect(sharedLinks(page).getByTestId("shared-links-empty")).toBeVisible();

  await page.getByRole("button", { name: "Back" }).click();
  await openRow(page, "Shared from list");
  const menu = await openMenu(page);
  await menu.getByTestId("share-item").click();
  await expect(page.getByTestId("toggle-input")).not.toBeChecked();
});
