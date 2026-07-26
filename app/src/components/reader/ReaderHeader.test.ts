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
    thumbnail_url: null,
    word_count: null,
    reading_time: null,
    tags: [],
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

  test("emits archive when the archive button is clicked", async () => {
    const wrapper = mount(ReaderHeader, { props: { bookmark: makeBookmark() } });
    await wrapper.find(".archive-btn").trigger("click");
    expect(wrapper.emitted("archive")).toHaveLength(1);
  });

  test("links the external-link button to the original URL in a new tab", () => {
    const wrapper = mount(ReaderHeader, { props: { bookmark: makeBookmark({ url: "https://example.com/a" }) } });
    const link = wrapper.find(".external-link-btn");
    expect(link.attributes("href")).toBe("https://example.com/a");
    expect(link.attributes("target")).toBe("_blank");
  });

  test("emits delete when the delete button is clicked and confirmed", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const wrapper = mount(ReaderHeader, { props: { bookmark: makeBookmark() } });
    await wrapper.find(".delete-btn").trigger("click");
    expect(wrapper.emitted("delete")).toHaveLength(1);
  });

  test("does not emit delete when the confirmation is cancelled", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const wrapper = mount(ReaderHeader, { props: { bookmark: makeBookmark() } });
    await wrapper.find(".delete-btn").trigger("click");
    expect(wrapper.emitted("delete")).toBeUndefined();
  });
});
