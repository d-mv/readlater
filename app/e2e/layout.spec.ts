import type { Page } from "@playwright/test";

import { article, expect, readerTitle, row, rows, test } from "./fixtures";

// Runs in both projects: the phone project (390px) gets the next text step up
// below Tailwind's `sm` breakpoint (640px), the desktop one the compact sizes.
const SIZES = {
  phone: { title: "17px", meta: "13px", tab: "13px", tag: "13px" },
  desktop: { title: "14px", meta: "10px", tab: "11px", tag: "10px" },
};

function fontSize(page: Page, selector: string) {
  return page
    .locator(selector)
    .first()
    .evaluate((el) => getComputedStyle(el).fontSize);
}

async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, "page scrolls sideways").toBeLessThanOrEqual(0);
}

test("list typography follows the breakpoint and nothing overflows sideways", async ({
  page,
  backend,
}) => {
  backend.addBookmark({
    title: "An extraordinarily long title that has to truncate rather than push the layout wider",
    url: "https://a-very-long-subdomain-name.example-with-a-long-domain.com/path",
    tags: ["typography"],
  });
  await page.goto("/");
  await expect(rows(page)).toHaveCount(1);

  const width = page.viewportSize()!.width;
  const expected = width < 640 ? SIZES.phone : SIZES.desktop;
  expect(await fontSize(page, '[data-testid="row"] [data-testid="title"]')).toBe(expected.title);
  expect(await fontSize(page, '[data-testid="row"] .num')).toBe(expected.meta);
  expect(await fontSize(page, '[data-testid="tab"]')).toBe(expected.tab);
  expect(await fontSize(page, '[data-testid="tag-filter-bar"] [data-testid="tag-chip"]')).toBe(
    expected.tag,
  );
  await expectNoHorizontalScroll(page);

  // The header actions all stay on screen.
  for (const name of ["Add", "Settings"]) {
    const box = await page.getByRole("button", { name, exact: true }).boundingBox();
    expect(box!.x + box!.width).toBeLessThanOrEqual(width);
  }

  await page.getByTestId("add-btn").click();
  const dialog = page.locator("dialog[open]");
  const box = await dialog.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(width);
});

test("the reader fits the viewport with long code lines and unbroken words", async ({
  page,
  backend,
}) => {
  const bookmark = backend.addBookmark({
    title: "Wide content",
    content_md: [
      "Intro paragraph.",
      "```",
      `const x = "${"a".repeat(300)}";`,
      "```",
      `Unbroken: ${"b".repeat(200)}`,
      "| a | b | c | d | e | f |\n|---|---|---|---|---|---|\n| 1 | 2 | 3 | 4 | 5 | 6 |",
    ].join("\n\n"),
  });
  await page.goto(`/b/${bookmark.id}`);
  await expect(readerTitle(page)).toHaveText("Wide content");
  await expect(article(page)).toContainText("Intro paragraph.");
  await expectNoHorizontalScroll(page);

  const width = page.viewportSize()!.width;
  const articleBox = await article(page).boundingBox();
  expect(articleBox!.x + articleBox!.width).toBeLessThanOrEqual(width);
  // Reader body text uses the article font size (16px default) on every width.
  expect(await fontSize(page, '[data-testid="article"] p')).toBe("16px");
});

test("settings and the login screen fit the viewport", async ({ page, backend }) => {
  backend.addBookmark();
  await page.goto("/settings");
  await expect(page.getByTestId("export-btn")).toBeVisible();
  await expectNoHorizontalScroll(page);

  await page.getByTestId("sign-out-btn").click();
  await expect(page.getByLabel("Email")).toBeVisible();
  await expectNoHorizontalScroll(page);
  const box = await page.getByRole("button", { name: "Sign in" }).boundingBox();
  expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
});

test("a tapped row opens the reader (touch on the phone project)", async ({ page, backend }) => {
  backend.addBookmark({ title: "Tap me" });
  await page.goto("/");
  const button = row(page, "Tap me").getByRole("button").first();
  if (test.info().project.use.hasTouch) await button.tap();
  else await button.click();
  await expect(readerTitle(page)).toHaveText("Tap me");
});
