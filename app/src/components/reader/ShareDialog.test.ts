import { afterEach, describe, expect, test, vi } from "vitest";
import { mount } from "@vue/test-utils";
import ShareDialog from "./ShareDialog.vue";
import type { Bookmark } from "../../lib/supabase";

function makeBookmark(overrides: Partial<Bookmark> = {}): Bookmark {
  return {
    id: "abc-123",
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

describe("ShareDialog", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("does not show the link field when not public", () => {
    const wrapper = mount(ShareDialog, {
      props: {
        bookmark: makeBookmark({ is_public: false }),
        origin: "https://readlater.mlnkv.net",
      },
    });
    expect(wrapper.find(".link-field").exists()).toBe(false);
  });

  test("shows the share link built from the bookmark id when public", () => {
    const wrapper = mount(ShareDialog, {
      props: { bookmark: makeBookmark({ is_public: true }), origin: "https://readlater.mlnkv.net" },
    });
    const field = wrapper.find(".link-field");
    expect((field.element as HTMLInputElement).value).toBe("https://readlater.mlnkv.net/s/abc-123");
  });

  test("confirms before emitting togglePublic when turning sharing on", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const wrapper = mount(ShareDialog, { props: { bookmark: makeBookmark({ is_public: false }) } });

    await wrapper.find(".toggle-input").setValue(true);

    expect(confirmSpy).toHaveBeenCalled();
    expect(wrapper.emitted("togglePublic")).toEqual([[true]]);
  });

  test("does not emit togglePublic when the confirmation is cancelled", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const wrapper = mount(ShareDialog, { props: { bookmark: makeBookmark({ is_public: false }) } });

    await wrapper.find(".toggle-input").setValue(true);

    expect(wrapper.emitted("togglePublic")).toBeUndefined();
  });

  test("unsharing does not prompt for confirmation", async () => {
    const confirmSpy = vi.spyOn(window, "confirm");
    const wrapper = mount(ShareDialog, { props: { bookmark: makeBookmark({ is_public: true }) } });

    await wrapper.find(".toggle-input").setValue(false);

    expect(confirmSpy).not.toHaveBeenCalled();
    expect(wrapper.emitted("togglePublic")).toEqual([[false]]);
  });

  test("emits close when clicking the close button", async () => {
    const wrapper = mount(ShareDialog, { props: { bookmark: makeBookmark() } });
    await wrapper.find(".close-btn").trigger("click");
    expect(wrapper.emitted("close")).toHaveLength(1);
  });

  test("copies the share link to the clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const wrapper = mount(ShareDialog, {
      props: { bookmark: makeBookmark({ is_public: true }), origin: "https://readlater.mlnkv.net" },
    });

    await wrapper.find(".copy-btn").trigger("click");

    expect(writeText).toHaveBeenCalledWith("https://readlater.mlnkv.net/s/abc-123");
  });
});
