import { describe, expect, test } from "vitest";
import { mount } from "@vue/test-utils";
import BookmarkRow from "./BookmarkRow.vue";
import type { Bookmark } from "../../lib/supabase";

function makeBookmark(overrides: Partial<Bookmark> = {}): Bookmark {
  return {
    id: "1",
    url: "https://arc90.com/x",
    type: "article",
    status: "ready",
    title: "A short history of the readability algorithm",
    author: null,
    excerpt: null,
    content_md: null,
    translated_content_md: null,
    translated_lang: null,
    thumbnail_url: null,
    youtube_video_id: null,
    content_edited: false,
    word_count: 100,
    reading_time: 6,
    tags: [],
    is_public: false,
    archived: false,
    read_at: null,
    error_message: null,
    created_at: "2026-01-01T00:00:00Z",
    processed_at: null,
    updated_at: "2026-01-01T00:00:00Z",
    pdf_path: null,
    pdf_parsed: false,
    view_mode: null,
    ...overrides,
  };
}

describe("BookmarkRow", () => {
  test("renders the title and formatted meta line", () => {
    const wrapper = mount(BookmarkRow, { props: { bookmark: makeBookmark() } });
    expect(wrapper.text()).toContain("A short history of the readability algorithm");
    expect(wrapper.text()).toContain("arc90.com · 6 min");
  });

  test("emits open with the bookmark id when clicked", async () => {
    const wrapper = mount(BookmarkRow, { props: { bookmark: makeBookmark({ id: "abc" }) } });
    await wrapper.find("button").trigger("click");
    expect(wrapper.emitted("open")).toEqual([["abc"]]);
  });

  test("applies read styling when read_at is set", () => {
    const wrapper = mount(BookmarkRow, {
      props: { bookmark: makeBookmark({ read_at: "2026-01-02T00:00:00Z" }) },
    });
    expect(wrapper.find('[data-testid="title"]').attributes("data-read")).toBe("true");
  });

  test("shows a public badge when the bookmark is shared", () => {
    const wrapper = mount(BookmarkRow, { props: { bookmark: makeBookmark({ is_public: true }) } });
    expect(wrapper.find('[data-testid="public-badge"]').exists()).toBe(true);
  });

  test("hides the public badge when the bookmark is not shared", () => {
    const wrapper = mount(BookmarkRow, { props: { bookmark: makeBookmark({ is_public: false }) } });
    expect(wrapper.find('[data-testid="public-badge"]').exists()).toBe(false);
  });

  test("falls back to the URL when there's no title yet", () => {
    const wrapper = mount(BookmarkRow, { props: { bookmark: makeBookmark({ title: null }) } });
    expect(wrapper.text()).toContain("https://arc90.com/x");
  });

  test.each([
    ["pdf", "PDF"],
    ["note", "Note"],
  ] as const)("a %s with neither title nor URL is labelled by its type", (type, label) => {
    const wrapper = mount(BookmarkRow, {
      props: { bookmark: makeBookmark({ type, title: null, url: null }) },
    });
    expect(wrapper.get('[data-testid="title"]').text()).toBe(label);
  });

  test.each(["pending", "processing"] as const)(
    "a %s row without a title shows a spinner and 'Processing…'",
    (status) => {
      const wrapper = mount(BookmarkRow, {
        props: { bookmark: makeBookmark({ status, title: null }) },
      });
      const title = wrapper.get('[data-testid="title"]');
      expect(title.text()).toBe("Processing…");
      expect(title.classes()).toContain("italic");
      expect(wrapper.find("svg.tabler-icon-loader-2").exists()).toBe(true);
    },
  );

  test("a failed row without a title says so with a warning icon", () => {
    const wrapper = mount(BookmarkRow, {
      props: { bookmark: makeBookmark({ status: "failed", title: null }) },
    });
    const title = wrapper.get('[data-testid="title"]');
    expect(title.text()).toBe("Failed to process");
    expect(title.classes()).toContain("text-danger");
    expect(wrapper.find("svg.tabler-icon-alert-triangle").exists()).toBe(true);
  });

  test("a YouTube bookmark gets the YouTube icon; an article gets the document icon", () => {
    const video = mount(BookmarkRow, { props: { bookmark: makeBookmark({ type: "youtube" }) } });
    const article = mount(BookmarkRow, { props: { bookmark: makeBookmark() } });
    expect(video.find("svg.tabler-icon-brand-youtube").exists()).toBe(true);
    expect(article.find("svg.tabler-icon-file-text").exists()).toBe(true);
  });

  test("shows a translated badge only once a translation exists", () => {
    const translated = mount(BookmarkRow, {
      props: { bookmark: makeBookmark({ translated_lang: "en" }) },
    });
    const plain = mount(BookmarkRow, { props: { bookmark: makeBookmark() } });
    expect(translated.find('[data-testid="translated-badge"]').exists()).toBe(true);
    expect(plain.find('[data-testid="translated-badge"]').exists()).toBe(false);
  });

  test("a cached copy missing a single image says '1 image'", () => {
    const wrapper = mount(BookmarkRow, {
      props: { bookmark: makeBookmark(), isCached: true, missingImages: 1 },
    });
    expect(wrapper.get('[data-testid="offline-toggle"]').attributes("title")).toBe(
      "Saved offline without 1 image — remove offline copy",
    );
  });

  test("shows a save-offline toggle for unread rows", () => {
    const wrapper = mount(BookmarkRow, {
      props: { bookmark: makeBookmark({ archived: false, read_at: null }) },
    });
    expect(wrapper.find('[data-testid="offline-toggle"]').exists()).toBe(true);
  });

  test("hides the save-offline toggle once a bookmark is read", () => {
    const wrapper = mount(BookmarkRow, {
      props: { bookmark: makeBookmark({ read_at: "2026-01-02T00:00:00Z" }) },
    });
    expect(wrapper.find('[data-testid="offline-toggle"]').exists()).toBe(false);
  });

  test("hides the save-offline toggle for archived rows", () => {
    const wrapper = mount(BookmarkRow, {
      props: { bookmark: makeBookmark({ archived: true, read_at: null }) },
    });
    expect(wrapper.find('[data-testid="offline-toggle"]').exists()).toBe(false);
  });

  test("a read or archived row with an offline copy can still remove it", () => {
    for (const bookmark of [
      makeBookmark({ read_at: "2026-01-02T00:00:00Z" }),
      makeBookmark({ archived: true, read_at: null }),
    ]) {
      const toggle = mount(BookmarkRow, { props: { bookmark, isCached: true } }).find(
        '[data-testid="offline-toggle"]',
      );
      expect(toggle.exists()).toBe(true);
      expect(toggle.attributes("title")).toBe("Remove offline copy");
    }
  });

  test("emits toggleOffline with the bookmark id without triggering open", async () => {
    const wrapper = mount(BookmarkRow, {
      props: { bookmark: makeBookmark({ id: "abc", archived: false, read_at: null }) },
    });
    await wrapper.find('[data-testid="offline-toggle"]').trigger("click");
    expect(wrapper.emitted("toggleOffline")).toEqual([["abc"]]);
    expect(wrapper.emitted("open")).toBeUndefined();
  });

  test("shows a cached state when isCached is true", () => {
    const wrapper = mount(BookmarkRow, {
      props: { bookmark: makeBookmark({ archived: false, read_at: null }), isCached: true },
    });
    expect(wrapper.find('[data-testid="offline-toggle"]').attributes("aria-pressed")).toBe("true");
  });

  test("a cached copy missing images says so on the offline toggle", () => {
    const wrapper = mount(BookmarkRow, {
      props: {
        bookmark: makeBookmark({ archived: false, read_at: null }),
        isCached: true,
        missingImages: 2,
      },
    });
    const toggle = wrapper.find('[data-testid="offline-toggle"]');
    expect(toggle.attributes("title")).toBe("Saved offline without 2 images — remove offline copy");
    expect(wrapper.find('[data-testid="images-not-cached"]').exists()).toBe(true);
  });

  test("a complete cached copy shows the plain cached state", () => {
    const wrapper = mount(BookmarkRow, {
      props: { bookmark: makeBookmark({ archived: false, read_at: null }), isCached: true },
    });
    expect(wrapper.find('[data-testid="offline-toggle"]').attributes("title")).toBe(
      "Remove offline copy",
    );
    expect(wrapper.find('[data-testid="images-not-cached"]').exists()).toBe(false);
  });
});
