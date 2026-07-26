import { describe, expect, test } from "vitest";
import { mount } from "@vue/test-utils";
import ReaderActions from "./ReaderActions.vue";
import type { Bookmark } from "../../lib/supabase";

function makeBookmark(overrides: Partial<Bookmark> = {}): Bookmark {
  return {
    id: "1",
    url: "https://arc90.com/readability",
    type: "article",
    status: "ready",
    title: "Title",
    author: null,
    excerpt: null,
    content_md: null,
    thumbnail_url: null,
    word_count: null,
    reading_time: null,
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

describe("ReaderActions", () => {
  test("links 'Open original' to the bookmark's URL in a new tab", () => {
    const wrapper = mount(ReaderActions, { props: { bookmark: makeBookmark({ url: "https://x.com/a" }) } });
    const link = wrapper.find(".open-original");
    expect(link.attributes("href")).toBe("https://x.com/a");
    expect(link.attributes("target")).toBe("_blank");
  });

  test("shows 'Mark as read' and emits mark-read when unread", async () => {
    const wrapper = mount(ReaderActions, { props: { bookmark: makeBookmark({ read_at: null }) } });
    const btn = wrapper.find(".mark-read");
    expect(btn.exists()).toBe(true);
    await btn.trigger("click");
    expect(wrapper.emitted("markRead")).toHaveLength(1);
  });

  test("hides 'Mark as read' once the bookmark is already read", () => {
    const wrapper = mount(ReaderActions, {
      props: { bookmark: makeBookmark({ read_at: "2026-01-02T00:00:00Z" }) },
    });
    expect(wrapper.find(".mark-read").exists()).toBe(false);
  });

  test("shows 'Mark as unread' and emits mark-unread when read", async () => {
    const wrapper = mount(ReaderActions, {
      props: { bookmark: makeBookmark({ read_at: "2026-01-02T00:00:00Z" }) },
    });
    const btn = wrapper.find(".mark-unread");
    expect(btn.exists()).toBe(true);
    await btn.trigger("click");
    expect(wrapper.emitted("markUnread")).toHaveLength(1);
  });

  test("hides 'Mark as unread' while still unread", () => {
    const wrapper = mount(ReaderActions, { props: { bookmark: makeBookmark({ read_at: null }) } });
    expect(wrapper.find(".mark-unread").exists()).toBe(false);
  });
});
