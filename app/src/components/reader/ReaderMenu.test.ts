import { beforeEach, describe, expect, test, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { mount } from "@vue/test-utils";
import ReaderMenu from "./ReaderMenu.vue";
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

async function openMenu(wrapper: ReturnType<typeof mount>) {
  await wrapper.find(".menu-trigger").trigger("click");
}

describe("ReaderMenu", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  test("hides the menu panel until the trigger is clicked", async () => {
    const wrapper = mount(ReaderMenu, { props: { bookmark: makeBookmark() } });
    expect(wrapper.find(".menu-panel").exists()).toBe(false);
    await openMenu(wrapper);
    expect(wrapper.find(".menu-panel").exists()).toBe(true);
  });

  test("marks the share item active when the bookmark is public", async () => {
    const wrapper = mount(ReaderMenu, { props: { bookmark: makeBookmark({ is_public: true }) } });
    await openMenu(wrapper);
    expect(wrapper.find(".share-item").classes()).toContain("share-item-active");
  });

  test("emits share and closes the menu when the share item is clicked", async () => {
    const wrapper = mount(ReaderMenu, { props: { bookmark: makeBookmark() } });
    await openMenu(wrapper);
    await wrapper.find(".share-item").trigger("click");
    expect(wrapper.emitted("share")).toHaveLength(1);
    expect(wrapper.find(".menu-panel").exists()).toBe(false);
  });

  test("emits archive when the archive item is clicked", async () => {
    const wrapper = mount(ReaderMenu, { props: { bookmark: makeBookmark() } });
    await openMenu(wrapper);
    await wrapper.find(".archive-item").trigger("click");
    expect(wrapper.emitted("archive")).toHaveLength(1);
  });

  test("emits edit and closes the menu when the edit item is clicked", async () => {
    const wrapper = mount(ReaderMenu, { props: { bookmark: makeBookmark() } });
    await openMenu(wrapper);
    await wrapper.find(".edit-item").trigger("click");
    expect(wrapper.emitted("edit")).toHaveLength(1);
    expect(wrapper.find(".menu-panel").exists()).toBe(false);
  });

  test("shows the edit item for every bookmark type", async () => {
    for (const type of ["article", "youtube", "note"] as const) {
      const wrapper = mount(ReaderMenu, { props: { bookmark: makeBookmark({ type }) } });
      await openMenu(wrapper);
      expect(wrapper.find(".edit-item").exists()).toBe(true);
    }
  });

  test("links 'Open original' to the bookmark's URL in a new tab", async () => {
    const wrapper = mount(ReaderMenu, {
      props: { bookmark: makeBookmark({ url: "https://example.com/a" }) },
    });
    await openMenu(wrapper);
    const link = wrapper.find(".open-original");
    expect(link.attributes("href")).toBe("https://example.com/a");
    expect(link.attributes("target")).toBe("_blank");
  });

  test("shows a clickable 'Open original' for a PDF with an original file, and emits openOriginalPdf", async () => {
    const wrapper = mount(ReaderMenu, {
      props: {
        bookmark: makeBookmark({ url: null, type: "pdf", pdf_path: "user-1/a.pdf" }),
      },
    });
    await openMenu(wrapper);
    const item = wrapper.find(".open-original");
    expect(item.exists()).toBe(true);
    expect(item.element.tagName).toBe("BUTTON");
    await item.trigger("click");
    expect(wrapper.emitted("openOriginalPdf")).toHaveLength(1);
    expect(wrapper.find(".menu-panel").exists()).toBe(false);
  });

  test("hides 'Open original' for a PDF once the original has been trashed", async () => {
    const wrapper = mount(ReaderMenu, {
      props: { bookmark: makeBookmark({ url: null, type: "pdf", pdf_path: null }) },
    });
    await openMenu(wrapper);
    expect(wrapper.find(".open-original").exists()).toBe(false);
  });

  test("shows 'Trash original PDF' only once parsing succeeded, and emits trashOriginalPdf when confirmed", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const wrapper = mount(ReaderMenu, {
      props: {
        bookmark: makeBookmark({
          url: null,
          type: "pdf",
          pdf_path: "user-1/a.pdf",
          pdf_parsed: true,
        }),
      },
    });
    await openMenu(wrapper);
    const item = wrapper.find(".trash-pdf-item");
    expect(item.exists()).toBe(true);
    await item.trigger("click");
    expect(wrapper.emitted("trashOriginalPdf")).toHaveLength(1);
  });

  test("hides 'Trash original PDF' when parsing failed (no markdown to fall back to)", async () => {
    const wrapper = mount(ReaderMenu, {
      props: {
        bookmark: makeBookmark({
          url: null,
          type: "pdf",
          pdf_path: "user-1/a.pdf",
          pdf_parsed: false,
        }),
      },
    });
    await openMenu(wrapper);
    expect(wrapper.find(".trash-pdf-item").exists()).toBe(false);
  });

  test("does not emit trashOriginalPdf when the confirmation is cancelled", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const wrapper = mount(ReaderMenu, {
      props: {
        bookmark: makeBookmark({
          url: null,
          type: "pdf",
          pdf_path: "user-1/a.pdf",
          pdf_parsed: true,
        }),
      },
    });
    await openMenu(wrapper);
    await wrapper.find(".trash-pdf-item").trigger("click");
    expect(wrapper.emitted("trashOriginalPdf")).toBeUndefined();
  });

  test("links 'Translate…' to a Google Translate page-proxy URL when the bookmark has a URL", async () => {
    const wrapper = mount(ReaderMenu, {
      props: { bookmark: makeBookmark({ url: "https://example.com/a" }) },
    });
    await openMenu(wrapper);
    const link = wrapper.find(".translate-item");
    expect(link.exists()).toBe(true);
    expect(link.attributes("href")).toContain("translate.google.com/translate?");
    expect(link.attributes("href")).toContain(encodeURIComponent("https://example.com/a"));
    expect(link.attributes("target")).toBe("_blank");
  });

  test("emits translate and closes the menu when the translate item is clicked for URL-less bookmarks (notes)", async () => {
    const wrapper = mount(ReaderMenu, {
      props: {
        bookmark: makeBookmark({ url: null, type: "note", content_md: "Bonjour le monde" }),
      },
    });
    await openMenu(wrapper);
    const item = wrapper.find(".translate-item");
    expect(item.exists()).toBe(true);
    expect(item.element.tagName).toBe("BUTTON");
    await item.trigger("click");
    expect(wrapper.emitted("translate")).toHaveLength(1);
    expect(wrapper.find(".menu-panel").exists()).toBe(false);
  });

  test("hides 'Translate…' when there is neither a URL nor content", async () => {
    const wrapper = mount(ReaderMenu, {
      props: { bookmark: makeBookmark({ url: null, type: "note", content_md: null }) },
    });
    await openMenu(wrapper);
    expect(wrapper.find(".translate-item").exists()).toBe(false);
  });

  test("emits delete when confirmed", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const wrapper = mount(ReaderMenu, { props: { bookmark: makeBookmark() } });
    await openMenu(wrapper);
    await wrapper.find(".delete-item").trigger("click");
    expect(wrapper.emitted("delete")).toHaveLength(1);
  });

  test("does not emit delete when the confirmation is cancelled", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const wrapper = mount(ReaderMenu, { props: { bookmark: makeBookmark() } });
    await openMenu(wrapper);
    await wrapper.find(".delete-item").trigger("click");
    expect(wrapper.emitted("delete")).toBeUndefined();
  });

  test("shows 'Mark as read' and emits markRead when unread", async () => {
    const wrapper = mount(ReaderMenu, { props: { bookmark: makeBookmark({ read_at: null }) } });
    await openMenu(wrapper);
    const btn = wrapper.find(".mark-read");
    expect(btn.exists()).toBe(true);
    await btn.trigger("click");
    expect(wrapper.emitted("markRead")).toHaveLength(1);
  });

  test("hides 'Mark as read' once the bookmark is already read", async () => {
    const wrapper = mount(ReaderMenu, {
      props: { bookmark: makeBookmark({ read_at: "2026-01-02T00:00:00Z" }) },
    });
    await openMenu(wrapper);
    expect(wrapper.find(".mark-read").exists()).toBe(false);
  });

  test("shows 'Mark as unread' and emits markUnread when read", async () => {
    const wrapper = mount(ReaderMenu, {
      props: { bookmark: makeBookmark({ read_at: "2026-01-02T00:00:00Z" }) },
    });
    await openMenu(wrapper);
    const btn = wrapper.find(".mark-unread");
    expect(btn.exists()).toBe(true);
    await btn.trigger("click");
    expect(wrapper.emitted("markUnread")).toHaveLength(1);
  });

  test("hides 'Mark as unread' while still unread", async () => {
    const wrapper = mount(ReaderMenu, { props: { bookmark: makeBookmark({ read_at: null }) } });
    await openMenu(wrapper);
    expect(wrapper.find(".mark-unread").exists()).toBe(false);
  });

  test("closes the menu on Escape", async () => {
    const wrapper = mount(ReaderMenu, { props: { bookmark: makeBookmark() } });
    await openMenu(wrapper);
    expect(wrapper.find(".menu-panel").exists()).toBe(true);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await wrapper.vm.$nextTick();
    expect(wrapper.find(".menu-panel").exists()).toBe(false);
  });

  test("closes the menu on an outside click", async () => {
    const wrapper = mount(ReaderMenu, {
      props: { bookmark: makeBookmark() },
      attachTo: document.body,
    });
    await openMenu(wrapper);
    expect(wrapper.find(".menu-panel").exists()).toBe(true);
    document.body.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await wrapper.vm.$nextTick();
    expect(wrapper.find(".menu-panel").exists()).toBe(false);
    wrapper.unmount();
  });
});
