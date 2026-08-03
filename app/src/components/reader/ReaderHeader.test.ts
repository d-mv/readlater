import { beforeEach, describe, expect, test } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { mount } from "@vue/test-utils";
import ReaderHeader from "./ReaderHeader.vue";
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
    translated_content_md: null,
    translated_lang: null,
    thumbnail_url: null,
    youtube_video_id: null,
    content_edited: false,
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

describe("ReaderHeader", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  test("shows the bookmark's domain", () => {
    const wrapper = mount(ReaderHeader, { props: { bookmark: makeBookmark() } });
    expect(wrapper.text()).toContain("arc90.com");
  });

  test("emits back when the back button is clicked", async () => {
    const wrapper = mount(ReaderHeader, { props: { bookmark: makeBookmark() } });
    await wrapper.find(".back-btn").trigger("click");
    expect(wrapper.emitted("back")).toHaveLength(1);
  });

  test("forwards archive from the menu", async () => {
    const wrapper = mount(ReaderHeader, { props: { bookmark: makeBookmark() } });
    await wrapper.find(".menu-trigger").trigger("click");
    await wrapper.find(".archive-item").trigger("click");
    expect(wrapper.emitted("archive")).toHaveLength(1);
  });

  test("forwards share from the menu", async () => {
    const wrapper = mount(ReaderHeader, { props: { bookmark: makeBookmark() } });
    await wrapper.find(".menu-trigger").trigger("click");
    await wrapper.find(".share-item").trigger("click");
    expect(wrapper.emitted("share")).toHaveLength(1);
  });

  test("forwards edit from the menu", async () => {
    const wrapper = mount(ReaderHeader, { props: { bookmark: makeBookmark() } });
    await wrapper.find(".menu-trigger").trigger("click");
    await wrapper.find(".edit-item").trigger("click");
    expect(wrapper.emitted("edit")).toHaveLength(1);
  });

  test("forwards translate from the menu", async () => {
    const wrapper = mount(ReaderHeader, {
      props: { bookmark: makeBookmark({ url: null, type: "note", content_md: "Some text" }) },
    });
    await wrapper.find(".menu-trigger").trigger("click");
    await wrapper.find(".translate-item").trigger("click");
    expect(wrapper.emitted("translate")).toHaveLength(1);
  });
});
