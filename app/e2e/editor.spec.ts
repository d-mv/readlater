import type { Locator, Page } from "@playwright/test";

import type { FakeBackend } from "./fakeBackend";
import { expect, menuAction, test } from "./fixtures";

// The editor's layout in a real browser — the unit tests only check the
// props ArticleContent passes to md-editor (plan §5).

const NARROW_BREAKPOINT = 640;

function input(page: Page): Locator {
  return page.locator(".md-editor-input-wrapper");
}

function preview(page: Page): Locator {
  return page.locator(".md-editor-preview-wrapper");
}

function previewOnlyToggle(page: Page): Locator {
  return page.locator('.md-editor-toolbar-item[title="preview only"]');
}

async function width(locator: Locator): Promise<number> {
  return (await locator.boundingBox())?.width ?? 0;
}

async function openEditor(page: Page, backend: FakeBackend) {
  const bookmark = backend.addBookmark({
    title: "Draft",
    content_md: "# Heading\n\n- one\n- two\n\n[a link](https://example.com)",
  });
  await page.goto(`/b/${bookmark.id}`);
  await menuAction(page, "edit-item");
  await expect(page.locator(".cm-content")).toBeVisible();
}

test("on a wide screen the editor shows input and preview side by side", async ({
  page,
  backend,
}) => {
  test.skip(page.viewportSize()!.width <= NARROW_BREAKPOINT, "wide layout");
  await openEditor(page, backend);

  await expect(preview(page).locator("h1")).toHaveText("Heading");
  expect(await width(input(page))).toBeGreaterThan(200);
  expect(await width(preview(page))).toBeGreaterThan(200);
  await expect(previewOnlyToggle(page)).toHaveCount(0);

  // Narrowing the window drops to the one-pane layout.
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(preview(page)).toHaveCount(0);
  await expect(previewOnlyToggle(page)).toBeVisible();
});

/**
 * What a reader sees of rendered markdown, minus container markup: every
 * heading, paragraph, list item, quote, rule, line break, link and image, in
 * document order, with its text or target. Left out, as the two renderers'
 * known, cosmetic differences: code blocks (md-editor adds copy-button
 * chrome) and the empty paragraph markdown-it puts around a lone image
 * (md-editor uses a <figure>).
 */
function renderedShape(root: Locator): Promise<string[]> {
  return root.evaluate((el) =>
    [
      ...el.querySelectorAll(
        "h1, h2, h3, p, li, blockquote, hr, br, a, img, strong, em, :not(pre) > code",
      ),
    ]
      .map((node) => {
        const tag = node.tagName.toLowerCase();
        if (tag === "a") return `a ${node.getAttribute("href")} ${node.textContent}`;
        if (tag === "img") return `img ${node.getAttribute("alt")} ${node.getAttribute("src")}`;
        if (tag === "li") return `li ${node.firstChild?.textContent?.trim()}`;
        return `${tag} ${node.textContent?.trim()}`;
      })
      .filter((entry) => entry !== "p "),
  );
}

test("the editor preview renders markdown like the reader does", async ({ page, backend }) => {
  test.skip(page.viewportSize()!.width <= NARROW_BREAKPOINT, "needs the split preview");
  // Headings, inline marks, links, nested lists, a quote, a rule, a hard
  // break, raw HTML and an image — the shapes Turndown produces from a page.
  const md = [
    "# Title",
    "",
    "Intro with **bold**, _emphasis_, `code` and a [link](https://example.com/a).",
    "",
    "## Section",
    "",
    "- one",
    "- two",
    "  - nested",
    "",
    "1. first",
    "2. second",
    "",
    "> A quote",
    "",
    "```",
    "const x = 1;",
    "```",
    "",
    "![alt text](https://img.e2e.test/p.png)",
    "",
    "---",
    "",
    "Line one  ",
    "line two",
    "",
    "<p>raw html</p>",
  ].join("\n");
  const bookmark = backend.addBookmark({ title: "Draft", content_md: md });
  await page.goto(`/b/${bookmark.id}`);
  const reader = await renderedShape(page.getByTestId("article"));
  await menuAction(page, "edit-item");
  await expect(preview(page).locator("h1")).toHaveText("Title");
  const editorPreview = await renderedShape(page.locator(".md-editor-preview"));

  expect(reader).toContain("a https://example.com/a link");
  expect(reader).toContain("li nested");
  expect(editorPreview).toEqual(reader);
  // The known difference: md-editor wraps a code block in its own
  // copy-button chrome; the code itself is the same.
  await expect(preview(page).locator("pre code")).toContainText("const x = 1;");
});

test("on a phone the editor is one pane, and its toggle swaps in a full-width preview", async ({
  page,
  backend,
}) => {
  test.skip(page.viewportSize()!.width > NARROW_BREAKPOINT, "phone layout");
  await openEditor(page, backend);
  const fullWidth = await width(page.locator(".md-editor"));

  await expect(preview(page)).toHaveCount(0);
  expect(await width(input(page))).toBeGreaterThan(fullWidth * 0.9);

  await previewOnlyToggle(page).click();
  await expect(preview(page).locator("h1")).toHaveText("Heading");
  await expect(preview(page).locator("li")).toHaveText(["one", "two"]);
  expect(await width(preview(page))).toBeGreaterThan(fullWidth * 0.9);
  await expect.poll(() => width(input(page))).toBe(0);

  await previewOnlyToggle(page).click();
  await expect.poll(() => width(input(page))).toBeGreaterThan(fullWidth * 0.9);
});

test("turning the phone to landscape while previewing brings the input back", async ({
  page,
  backend,
}) => {
  test.skip(page.viewportSize()!.width > NARROW_BREAKPOINT, "phone layout");
  await openEditor(page, backend);
  await previewOnlyToggle(page).click();
  await expect.poll(() => width(input(page))).toBe(0);

  await page.setViewportSize({ width: 844, height: 390 });

  // Landscape is wide: split view, and no preview-only toggle to be stranded
  // behind.
  await expect.poll(() => width(input(page))).toBeGreaterThan(200);
  await expect(preview(page)).toBeVisible();
  await expect(previewOnlyToggle(page)).toHaveCount(0);
});
