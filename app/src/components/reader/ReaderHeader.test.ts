import { beforeEach, describe, expect, test, vi } from "vitest";
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
    pdf_path: null,
    pdf_parsed: false,
    view_mode: null,
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

  test("forwards openOriginalPdf from the menu", async () => {
    const wrapper = mount(ReaderHeader, {
      props: { bookmark: makeBookmark({ url: null, type: "pdf", pdf_path: "user-1/a.pdf" }) },
    });
    await wrapper.find(".menu-trigger").trigger("click");
    await wrapper.find(".open-original").trigger("click");
    expect(wrapper.emitted("openOriginalPdf")).toHaveLength(1);
  });

  test("forwards trashOriginalPdf from the menu", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const wrapper = mount(ReaderHeader, {
      props: {
        bookmark: makeBookmark({
          url: null,
          type: "pdf",
          pdf_path: "user-1/a.pdf",
          pdf_parsed: true,
        }),
      },
    });
    await wrapper.find(".menu-trigger").trigger("click");
    await wrapper.find(".trash-pdf-item").trigger("click");
    expect(wrapper.emitted("trashOriginalPdf")).toHaveLength(1);
    confirmSpy.mockRestore();
  });
});
