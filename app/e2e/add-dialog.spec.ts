import type { Page } from "@playwright/test";

import { answerNextConfirm, expect, row, rows, test } from "./fixtures";

function dialog(page: Page) {
  return page.locator("dialog[open]");
}

async function openDialog(page: Page, mode: "url" | "snippet" | "file" = "url") {
  await page.getByTestId("add-btn").click();
  await expect(dialog(page)).toBeVisible();
  if (mode !== "url") await dialog(page).getByTestId(`mode-${mode}`).click();
}

test.beforeEach(async ({ page, backend }) => {
  backend.addBookmark({ title: "Existing", url: "https://example.com/existing" });
  await page.goto("/");
  await expect(rows(page)).toHaveCount(1);
});

test("URL mode saves a pending article that shows as processing at the top", async ({
  page,
  backend,
}) => {
  await openDialog(page);
  await dialog(page).getByLabel("URL").fill("https://news.example.org/story");
  await dialog(page).getByTestId("submit-btn").click();

  await expect(dialog(page)).toHaveCount(0);
  await expect(rows(page).first()).toContainText("Processing…");
  await expect(rows(page)).toHaveCount(2);
  const saved = backend.bookmarks.find((b) => b.url === "https://news.example.org/story");
  expect(saved).toMatchObject({ status: "pending", type: "article" });
});

test("a YouTube URL is saved as a video", async ({ page, backend }) => {
  await openDialog(page);
  await dialog(page).getByLabel("URL").fill("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  await dialog(page).getByLabel("URL").press("Enter");
  await expect(dialog(page)).toHaveCount(0);
  expect(backend.bookmarks.find((b) => b.url?.includes("youtube"))?.type).toBe("youtube");
});

test("a non-http URL is refused in the dialog", async ({ page, backend }) => {
  await openDialog(page);
  await dialog(page).getByLabel("URL").fill("ftp://files.example.com/a");
  await dialog(page).getByTestId("submit-btn").click();
  await expect(dialog(page).getByTestId("error")).toHaveText("Enter a valid http(s) URL.");
  expect(backend.callsTo("rest", "bookmarks", "POST")).toHaveLength(0);
});

test("a URL already in the list asks before re-saving, and Add anyway refreshes it", async ({
  page,
  backend,
}) => {
  const existing = backend.bookmarks[0]!;
  await openDialog(page);
  await dialog(page).getByLabel("URL").fill("https://example.com/existing");
  await dialog(page).getByTestId("submit-btn").click();

  await expect(dialog(page)).toContainText("This URL is already saved. Add it again?");
  // Cancel goes back to the form, nothing written.
  await dialog(page).getByTestId("cancel-btn").click();
  await expect(dialog(page).getByLabel("URL")).toBeVisible();

  await dialog(page).getByTestId("submit-btn").click();
  await dialog(page).getByTestId("confirm-btn").click();
  await expect(dialog(page)).toHaveCount(0);
  expect(backend.bookmark(existing.id)?.status).toBe("pending");
  await expect(row(page, "Existing")).toHaveCount(1);
  expect(backend.callsTo("rest", "bookmarks", "POST")).toHaveLength(0);
});

test("a URL that only matches after normalisation hits the unique index and prompts too", async ({
  page,
  backend,
}) => {
  const hidden = backend.addBookmark({
    title: "Saved long ago",
    url: "https://example.com/older",
    created_at: "2020-01-01T00:00:00.000Z",
  });
  await openDialog(page);
  await dialog(page).getByLabel("URL").fill("https://EXAMPLE.com/older/");
  await dialog(page).getByTestId("submit-btn").click();
  await expect(dialog(page)).toContainText("This URL is already saved.");

  await dialog(page).getByTestId("confirm-btn").click();
  await expect(dialog(page)).toHaveCount(0);
  expect(backend.bookmark(hidden.id)?.status).toBe("pending");
});

test("re-saving a hand-edited bookmark needs a second confirmation", async ({ page, backend }) => {
  const edited = backend.addBookmark({
    title: "Edited by hand",
    url: "https://example.com/edited",
    content_edited: true,
  });
  await page.reload();
  await openDialog(page);
  await dialog(page).getByLabel("URL").fill("https://example.com/edited");
  await dialog(page).getByTestId("submit-btn").click();

  answerNextConfirm(page, false);
  await dialog(page).getByTestId("confirm-btn").click();
  await expect(dialog(page)).toHaveCount(0);
  expect(backend.bookmark(edited.id)).toMatchObject({ status: "ready", content_edited: true });

  await openDialog(page);
  await dialog(page).getByLabel("URL").fill("https://example.com/edited");
  await dialog(page).getByTestId("submit-btn").click();
  answerNextConfirm(page, true);
  await dialog(page).getByTestId("confirm-btn").click();
  await expect(dialog(page)).toHaveCount(0);
  expect(backend.bookmark(edited.id)).toMatchObject({ status: "pending", content_edited: false });
});

test("a failed insert keeps the dialog open with the error", async ({ page, backend }) => {
  backend.fail((c) => c.name === "bookmarks" && c.method === "POST", {
    status: 500,
    body: { code: "XX000", message: "database is on fire", details: null, hint: null },
  });
  await openDialog(page);
  await dialog(page).getByLabel("URL").fill("https://example.com/new");
  await dialog(page).getByTestId("submit-btn").click();
  await expect(dialog(page).getByTestId("error")).toHaveText("database is on fire");
  await expect(rows(page)).toHaveCount(1);
});

test("Snippet mode saves typed text as a ready note", async ({ page, backend }) => {
  await openDialog(page, "snippet");
  const submit = dialog(page).getByTestId("submit-btn");
  await expect(submit).toBeDisabled();
  await dialog(page).getByLabel("Snippet").fill("A thought worth keeping.\nSecond line.");
  await submit.click();

  await expect(dialog(page)).toHaveCount(0);
  await expect(rows(page).first()).toContainText("A thought worth keeping.");
  const note = backend.bookmarks.find((b) => b.type === "note");
  expect(note).toMatchObject({ status: "ready", url: null });
  expect(note?.content_md).toBe("A thought worth keeping.\nSecond line.");
  expect(backend.callsTo("functions", "snippet")).toHaveLength(0);
});

test("Snippet mode sends pasted rich text through the snippet function", async ({
  page,
  backend,
}) => {
  await openDialog(page, "snippet");
  const textarea = dialog(page).getByLabel("Snippet");
  await textarea.focus();
  await textarea.evaluate((el) => {
    const data = new DataTransfer();
    data.setData("text/html", "<p>Rich <strong>bold</strong> text</p>");
    data.setData("text/plain", "Rich bold text");
    el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true }));
  });
  // A synthetic paste doesn't insert text; type what the paste would have.
  await textarea.fill("Rich bold text");
  await dialog(page).getByTestId("submit-btn").click();

  await expect(dialog(page)).toHaveCount(0);
  const [call] = backend.callsTo("functions", "snippet");
  expect(call?.body).toEqual({
    html: "<p>Rich <strong>bold</strong> text</p>",
    text: "Rich bold text",
  });
  await expect(rows(page).first()).toContainText("Rich **bold** text");
});

test("File mode imports a Markdown file as a note", async ({ page, backend }) => {
  await openDialog(page, "file");
  await expect(dialog(page).getByTestId("submit-btn")).toBeDisabled();
  await dialog(page)
    .locator("#bookmark-file")
    .setInputFiles({
      name: "notes.md",
      mimeType: "text/markdown",
      buffer: Buffer.from("# Notes\n\nSome markdown."),
    });
  await expect(dialog(page).getByTestId("dropzone")).toContainText("notes.md");
  await dialog(page).getByTestId("submit-btn").click();

  await expect(dialog(page)).toHaveCount(0);
  await expect(rows(page).first()).toContainText("notes.md");
  const [call] = backend.callsTo("functions", "file-import");
  const body = call?.body as { filename: string; contentBase64: string };
  expect(body.filename).toBe("notes.md");
  expect(Buffer.from(body.contentBase64, "base64").toString()).toBe("# Notes\n\nSome markdown.");
});

test("File mode uploads a PDF through pdf-import", async ({ page, backend }) => {
  await openDialog(page, "file");
  await dialog(page)
    .locator("#bookmark-file")
    .setInputFiles({
      name: "paper.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4"),
    });
  await dialog(page).getByTestId("submit-btn").click();

  await expect(dialog(page)).toHaveCount(0);
  await expect(rows(page).first()).toContainText("paper.pdf");
  expect(backend.callsTo("functions", "pdf-import")).toHaveLength(1);
  expect(backend.bookmarks.find((b) => b.type === "pdf")?.pdf_path).toBeTruthy();
});

test("File mode rejects unsupported and oversized files before uploading", async ({
  page,
  backend,
}) => {
  await openDialog(page, "file");
  const input = dialog(page).locator("#bookmark-file");
  await input.setInputFiles({ name: "image.png", mimeType: "image/png", buffer: Buffer.from("x") });
  await expect(dialog(page).getByTestId("error")).toHaveText(
    "Unsupported file type. Use .md, .markdown, .docx, or .pdf.",
  );
  await expect(dialog(page).getByTestId("submit-btn")).toBeDisabled();

  await input.setInputFiles({
    name: "huge.md",
    mimeType: "text/markdown",
    buffer: Buffer.alloc(600 * 1024, "a"),
  });
  await expect(dialog(page).getByTestId("error")).toHaveText(
    "File exceeds the 500KB limit for this type.",
  );
  await expect(dialog(page).getByTestId("submit-btn")).toBeDisabled();
  expect(backend.callsTo("functions")).toHaveLength(0);
});

test("a failing import function shows its error and keeps the dialog", async ({
  page,
  backend,
}) => {
  backend.fail((c) => c.service === "functions" && c.name === "file-import", {
    status: 429,
    body: { error: "rate limited" },
  });
  await openDialog(page, "file");
  await dialog(page)
    .locator("#bookmark-file")
    .setInputFiles({ name: "notes.md", mimeType: "text/markdown", buffer: Buffer.from("hi") });
  await dialog(page).getByTestId("submit-btn").click();
  await expect(dialog(page).getByTestId("error")).toBeVisible();
  await expect(dialog(page)).toBeVisible();
  await expect(rows(page)).toHaveCount(1);
});

test("Cancel closes the dialog without saving", async ({ page, backend }) => {
  await openDialog(page);
  await dialog(page).getByLabel("URL").fill("https://example.com/never");
  await dialog(page).getByTestId("cancel-btn").click();
  await expect(dialog(page)).toHaveCount(0);
  expect(backend.callsTo("rest", "bookmarks", "POST")).toHaveLength(0);
});
