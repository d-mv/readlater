import { article, expect, readerTitle, test } from "./fixtures";

test.use({ auth: "signed-out" });

test("a public bookmark renders at /s/:id without a session or reader actions", async ({
  page,
  backend,
}) => {
  const shared = backend.addBookmark({
    title: "Shared essay",
    author: "Grace Hopper",
    reading_time: 5,
    is_public: true,
    content_md: "Read **this**.",
  });
  await page.goto(`/s/${shared.id}`);

  await expect(page).toHaveURL(new RegExp(`/s/${shared.id}$`));
  await expect(readerTitle(page)).toHaveText("Shared essay");
  await expect(page.getByText("By Grace Hopper · 5 min read")).toBeVisible();
  await expect(article(page).locator("strong")).toHaveText("this");
  await expect(page.getByTestId("menu-trigger")).toHaveCount(0);
  await expect(page.getByTestId("tag-draft-input")).toHaveCount(0);
  expect(backend.callsTo("rpc", "get_public_bookmark")[0]?.body).toEqual({
    bookmark_id: shared.id,
  });
  expect(backend.callsTo("rest")).toHaveLength(0);
});

test("a private or unknown id shows Not found", async ({ page, backend }) => {
  const priv = backend.addBookmark({ title: "Private", is_public: false });
  await page.goto(`/s/${priv.id}`);
  await expect(page.getByTestId("status-placeholder")).toHaveText("Not found");
  await expect(page.getByText("Private")).toHaveCount(0);

  await page.goto("/s/00000000-0000-4000-8000-0000000000ff");
  await expect(page.getByTestId("status-placeholder")).toHaveText("Not found");
});

test("a public YouTube bookmark offers the click-to-play player", async ({ page, backend }) => {
  const video = backend.addBookmark({
    type: "youtube",
    title: "Public talk",
    is_public: true,
    youtube_video_id: "xyz789",
    content_md: "Talk notes.",
  });
  await page.goto(`/s/${video.id}`);
  await page.getByTestId("youtube-play").click();
  await expect(page.locator('iframe[title="YouTube video player"]')).toHaveAttribute(
    "src",
    "https://www.youtube-nocookie.com/embed/xyz789",
  );
});
