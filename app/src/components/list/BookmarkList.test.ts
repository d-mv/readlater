import { describe, expect, test } from "vitest";
import { mount } from "@vue/test-utils";
import BookmarkList from "./BookmarkList.vue";
import type { Bookmark } from "../../lib/supabase";

function makeBookmark(overrides: Partial<Bookmark> = {}): Bookmark {
  return {
    id: "1",
    url: "https://arc90.com/x",
    type: "article",
    status: "ready",
    title: "Title",
    author: null,
    excerpt: null,
    content_md: null,
    thumbnail_url: null,
    word_count: 100,
    reading_time: 6,
    tags: [],
    is_public: false,
    archived: false,
    read_at: null,
    error_message: null,
    created_at: "2026-01-01T00:00:00Z",
    processed_at: null,
    ...overrides,
  };
}

describe("BookmarkList", () => {
  test("renders one row per bookmark", () => {
    const wrapper = mount(BookmarkList, {
      props: { bookmarks: [makeBookmark({ id: "1" }), makeBookmark({ id: "2" })] },
    });
    expect(wrapper.findAll(".row")).toHaveLength(2);
  });

  test("shows an empty state when there are no bookmarks", () => {
    const wrapper = mount(BookmarkList, { props: { bookmarks: [] } });
    expect(wrapper.find(".empty-state").exists()).toBe(true);
  });

  test("re-emits open with the clicked bookmark's id", async () => {
    const wrapper = mount(BookmarkList, { props: { bookmarks: [makeBookmark({ id: "xyz" })] } });
    await wrapper.find("button").trigger("click");
    expect(wrapper.emitted("open")).toEqual([["xyz"]]);
  });

  test("re-emits toggleOffline with the clicked bookmark's id", async () => {
    const wrapper = mount(BookmarkList, {
      props: { bookmarks: [makeBookmark({ id: "xyz", archived: false, read_at: null })] },
    });
    await wrapper.find(".offline-toggle").trigger("click");
    expect(wrapper.emitted("toggleOffline")).toEqual([["xyz"]]);
  });

  test("marks a row as cached when its id is in cachedIds", () => {
    const wrapper = mount(BookmarkList, {
      props: {
        bookmarks: [makeBookmark({ id: "xyz", archived: false, read_at: null })],
        cachedIds: new Set(["xyz"]),
      },
    });
    expect(wrapper.find(".offline-toggle").classes()).toContain("offline-toggle-cached");
  });
});
