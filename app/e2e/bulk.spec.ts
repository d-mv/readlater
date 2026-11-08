import type { BrowserContext, Page } from "@playwright/test";

import type { BackendCall, FakeBackend, ServerBookmark } from "./fakeBackend";
import { expect, offlineStoreKeys, row, rows, test } from "./fixtures";

// The undo window (stores/undo.ts UNDO_WINDOW_MS).
const UNDO_WINDOW_MS = 5000;

const titles = (page: Page) => rows(page).getByTestId("title");
const bar = (page: Page) => page.getByTestId("selection-bar");
const toast = (page: Page) => page.getByTestId("undo-toast");
const undoButton = (page: Page) => toast(page).getByRole("button", { name: "Undo" });
const tab = (page: Page, name: string) => page.getByTestId("tab").filter({ hasText: name });

/** Five rows, newest first: Alpha…Echo. */
function seed(backend: FakeBackend): Record<string, ServerBookmark> {
  return Object.fromEntries(
    ["Alpha", "Bravo", "Charlie", "Delta", "Echo"].map((title) => [
      title,
      backend.addBookmark({ title }),
    ]),
  );
}

async function selectRows(page: Page, ...names: string[]) {
  await page.getByRole("button", { name: "Select", exact: true }).click();
  // Selecting, each row is a toggle named by its title.
  for (const name of names) await page.getByRole("button", { name, exact: true }).click();
  await expect(page.getByTestId("selection-count")).toHaveText(`${names.length} selected`);
}

/** The bookmark ids a write's `id=in.(…)` filter names. */
function idsOf(call: BackendCall): string[] {
  const filter = call.params.get("id") ?? "";
  expect(filter).toMatch(/^in\.\(.*\)$/);
  return filter.slice(4, -1).split(",").sort();
}

const sorted = (...rows: ServerBookmark[]) => rows.map((b) => b.id).sort();

test("archive several rows in one request; one undo brings them all back in one more", async ({
  page,
  backend,
}) => {
  const seeded = seed(backend);
  await page.goto("/");
  await expect(rows(page)).toHaveCount(5);

  await selectRows(page, "Alpha", "Charlie", "Echo");
  await bar(page).getByRole("button", { name: "Archive" }).click();

  await expect(titles(page)).toHaveText(["Bravo", "Delta"]);
  await expect(bar(page)).toBeHidden();
  await expect(toast(page)).toContainText("3 archived");
  const archives = backend.callsTo("rest", "bookmarks", "PATCH");
  expect(archives).toHaveLength(1);
  expect(archives[0]!.body).toEqual({ archived: true });
  expect(idsOf(archives[0]!)).toEqual(sorted(seeded.Alpha!, seeded.Charlie!, seeded.Echo!));

  await undoButton(page).click();

  await expect(titles(page)).toHaveText(["Alpha", "Bravo", "Charlie", "Delta", "Echo"]);
  const writes = backend.callsTo("rest", "bookmarks", "PATCH");
  expect(writes).toHaveLength(2);
  expect(writes[1]!.body).toEqual({ archived: false });
  expect(idsOf(writes[1]!)).toEqual(sorted(seeded.Alpha!, seeded.Charlie!, seeded.Echo!));
  for (const name of ["Alpha", "Charlie", "Echo"])
    expect(backend.bookmark(seeded[name]!.id)?.archived).toBe(false);
});

test("a bulk delete is one DELETE once the undo window is over", async ({ page, backend }) => {
  const seeded = seed(backend);
  await page.clock.install();
  await page.goto("/");

  await selectRows(page, "Bravo", "Delta");
  await bar(page).getByRole("button", { name: "Delete" }).click();

  await expect(titles(page)).toHaveText(["Alpha", "Charlie", "Echo"]);
  await expect(toast(page)).toContainText("2 deleted");
  await page.clock.fastForward(UNDO_WINDOW_MS - 500);
  expect(backend.callsTo("rest", "bookmarks", "DELETE")).toHaveLength(0);

  await page.clock.fastForward(500);
  await expect.poll(() => backend.bookmark(seeded.Bravo!.id)).toBeUndefined();
  const deletes = backend.callsTo("rest", "bookmarks", "DELETE");
  expect(deletes).toHaveLength(1);
  expect(idsOf(deletes[0]!)).toEqual(sorted(seeded.Bravo!, seeded.Delta!));
  expect(backend.bookmark(seeded.Delta!.id)).toBeUndefined();
  await expect(titles(page)).toHaveText(["Alpha", "Charlie", "Echo"]);
});

test("undoing a bulk delete puts every row back in place and deletes nothing", async ({
  page,
  backend,
}) => {
  seed(backend);
  await page.clock.install();
  await page.goto("/");

  await selectRows(page, "Alpha", "Charlie", "Echo");
  await bar(page).getByRole("button", { name: "Delete" }).click();
  await expect(titles(page)).toHaveText(["Bravo", "Delta"]);
  await undoButton(page).click();

  await expect(titles(page)).toHaveText(["Alpha", "Bravo", "Charlie", "Delta", "Echo"]);
  await page.clock.fastForward(UNDO_WINDOW_MS * 2);
  expect(backend.callsTo("rest", "bookmarks", "DELETE")).toHaveLength(0);
});

test("a bulk delete still in its undo window is sent when the page is hidden", async ({
  page,
  backend,
}) => {
  const seeded = seed(backend);
  await page.clock.install();
  await page.goto("/");
  await selectRows(page, "Alpha", "Bravo");
  await bar(page).getByRole("button", { name: "Delete" }).click();

  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide")));

  await expect.poll(() => backend.bookmark(seeded.Alpha!.id)).toBeUndefined();
  expect(backend.bookmark(seeded.Bravo!.id)).toBeUndefined();
  expect(backend.callsTo("rest", "bookmarks", "DELETE")).toHaveLength(1);
});

test("mark read stamps the selected rows in one request", async ({ page, backend }) => {
  const seeded = seed(backend);
  await page.goto("/");

  await selectRows(page, "Bravo", "Charlie");
  await bar(page).getByRole("button", { name: "Mark read" }).click();

  await expect(bar(page)).toBeHidden();
  await expect(row(page, "Bravo").getByTestId("title")).toHaveAttribute("data-read", "true");
  await expect(row(page, "Charlie").getByTestId("title")).toHaveAttribute("data-read", "true");
  await expect(row(page, "Alpha").getByTestId("title")).not.toHaveAttribute("data-read");
  const writes = backend.callsTo("rest", "bookmarks", "PATCH");
  expect(writes).toHaveLength(1);
  expect(idsOf(writes[0]!)).toEqual(sorted(seeded.Bravo!, seeded.Charlie!));
  expect(backend.bookmark(seeded.Bravo!.id)?.read_at).not.toBeNull();
});

test("a refused bulk write changes nothing and says so", async ({ page, backend }) => {
  seed(backend);
  await page.goto("/");
  await selectRows(page, "Alpha", "Bravo");
  backend.fail((call) => call.name === "bookmarks" && call.method === "PATCH");

  await bar(page).getByRole("button", { name: "Archive" }).click();

  await expect(toast(page).getByTestId("undo-toast-card")).toHaveClass(/bg-danger/);
  await expect(titles(page)).toHaveText(["Alpha", "Bravo", "Charlie", "Delta", "Echo"]);
  // The selection stays for a retry.
  await expect(page.getByTestId("selection-count")).toHaveText("2 selected");
});

test("save offline downloads every selected unread row", async ({ page, backend }) => {
  const seeded = seed(backend);
  backend.bookmark(seeded.Delta!.id)!.read_at = "2026-05-02T00:00:00.000Z";
  await page.goto("/");

  await selectRows(page, "Alpha", "Bravo", "Charlie", "Delta");
  await bar(page).getByRole("button", { name: "Save offline" }).click();

  await expect(bar(page)).toBeHidden();
  await expect
    .poll(async () => (await offlineStoreKeys(page, "articles")).sort())
    .toEqual(sorted(seeded.Alpha!, seeded.Bravo!, seeded.Charlie!));
  for (const name of ["Alpha", "Bravo", "Charlie"]) {
    await expect(row(page, name).getByTestId("offline-toggle")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  }
});

test("on the Archived tab the bar unarchives", async ({ page, backend }) => {
  const seeded = seed(backend);
  for (const name of ["Bravo", "Delta"]) backend.bookmark(seeded[name]!.id)!.archived = true;
  await page.goto("/");
  await tab(page, "Archived").click();
  await expect(titles(page)).toHaveText(["Bravo", "Delta"]);

  await selectRows(page, "Bravo", "Delta");
  await expect(bar(page).getByRole("button", { name: "Archive", exact: true })).toHaveCount(0);
  await bar(page).getByRole("button", { name: "Unarchive" }).click();

  await expect(titles(page)).toHaveCount(0);
  await expect(toast(page)).toContainText("2 unarchived");
  await tab(page, "All").click();
  await expect(titles(page)).toHaveText(["Alpha", "Bravo", "Charlie", "Delta", "Echo"]);
});

test("x selects the focused row and Escape leaves selection", async ({ page, backend }) => {
  seed(backend);
  await page.goto("/");
  await expect(rows(page)).toHaveCount(5);

  await page.keyboard.press("j");
  await page.keyboard.press("x");
  await page.keyboard.press("j");
  await page.keyboard.press("j");
  await page.keyboard.press("x");

  await expect(page.getByTestId("selection-count")).toHaveText("2 selected");
  await expect(page.getByRole("button", { name: "Alpha", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByRole("button", { name: "Charlie", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  await page.keyboard.press("Escape");
  await expect(bar(page)).toBeHidden();
  await expect(page.getByRole("button", { name: "Alpha", exact: true })).toHaveCount(0);
});

test("switching tabs leaves selection", async ({ page, backend }) => {
  seed(backend);
  await page.goto("/");
  await selectRows(page, "Alpha");

  await tab(page, "Archived").click();
  await expect(bar(page)).toBeHidden();
  await tab(page, "All").click();

  await expect(bar(page)).toBeHidden();
  await expect(rows(page).first().getByTestId("row-open")).not.toHaveAttribute("aria-pressed");
});

async function goOffline(context: BrowserContext, page: Page) {
  await context.setOffline(true);
  await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(false);
}

test("offline, the bar's actions are off and it says why", async ({ page, context, backend }) => {
  seed(backend);
  await page.goto("/");
  const toggle = row(page, "Alpha").getByTestId("offline-toggle");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => offlineStoreKeys(page, "bookmarksList")).not.toHaveLength(0);

  backend.offline = true;
  await goOffline(context, page);
  await expect(titles(page)).toHaveText(["Alpha"]);
  await selectRows(page, "Alpha");

  await expect(bar(page)).toContainText("Offline");
  for (const name of ["Archive", "Delete", "Mark read", "Save offline"]) {
    await expect(bar(page).getByRole("button", { name, exact: true })).toBeDisabled();
  }
});
