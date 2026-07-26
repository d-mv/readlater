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
    thumbnail_url: null,
    word_count: 100,
    reading_time: 6,
    tags: [],
    archived: false,
    read_at: null,
    error_message: null,
    created_at: "2026-01-01T00:00:00Z",
    processed_at: null,
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
    expect(wrapper.find(".title").classes()).toContain("title-read");
  });

  test("falls back to the URL when there's no title yet", () => {
    const wrapper = mount(BookmarkRow, { props: { bookmark: makeBookmark({ title: null }) } });
    expect(wrapper.text()).toContain("https://arc90.com/x");
  });

  test("shows a save-offline toggle for unread rows", () => {
    const wrapper = mount(BookmarkRow, {
      props: { bookmark: makeBookmark({ archived: false, read_at: null }) },
    });
    expect(wrapper.find(".offline-toggle").exists()).toBe(true);
  });

  test("hides the save-offline toggle once a bookmark is read", () => {
    const wrapper = mount(BookmarkRow, {
      props: { bookmark: makeBookmark({ read_at: "2026-01-02T00:00:00Z" }) },
    });
    expect(wrapper.find(".offline-toggle").exists()).toBe(false);
  });

  test("hides the save-offline toggle for archived rows", () => {
    const wrapper = mount(BookmarkRow, {
      props: { bookmark: makeBookmark({ archived: true, read_at: null }) },
    });
    expect(wrapper.find(".offline-toggle").exists()).toBe(false);
  });

  test("emits toggleOffline with the bookmark id without triggering open", async () => {
    const wrapper = mount(BookmarkRow, {
      props: { bookmark: makeBookmark({ id: "abc", archived: false, read_at: null }) },
    });
    await wrapper.find(".offline-toggle").trigger("click");
    expect(wrapper.emitted("toggleOffline")).toEqual([["abc"]]);
    expect(wrapper.emitted("open")).toBeUndefined();
  });

  test("shows a cached state when isCached is true", () => {
    const wrapper = mount(BookmarkRow, {
      props: { bookmark: makeBookmark({ archived: false, read_at: null }), isCached: true },
    });
    expect(wrapper.find(".offline-toggle").classes()).toContain("offline-toggle-cached");
  });
});
