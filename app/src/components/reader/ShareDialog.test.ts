import { afterEach, describe, expect, test, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import ShareDialog from "./ShareDialog.vue";
import Dialog from "../../shared/ui/Dialog.vue";
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
    updated_at: "2026-01-01T00:00:00Z",
    pdf_path: null,
    pdf_parsed: false,
    view_mode: null,
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
    expect(wrapper.find('[data-testid="link-field"]').exists()).toBe(false);
  });

  test("shows the share link built from the bookmark id when public", () => {
    const wrapper = mount(ShareDialog, {
      props: { bookmark: makeBookmark({ is_public: true }), origin: "https://readlater.mlnkv.net" },
    });
    const field = wrapper.find('[data-testid="link-field"]');
    expect((field.element as HTMLInputElement).value).toBe("https://readlater.mlnkv.net/s/abc-123");
  });

  test("confirms before emitting togglePublic when turning sharing on", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const wrapper = mount(ShareDialog, { props: { bookmark: makeBookmark({ is_public: false }) } });

    await wrapper.find('[data-testid="toggle-input"]').setValue(true);

    expect(confirmSpy).toHaveBeenCalled();
    expect(wrapper.emitted("togglePublic")).toEqual([[true]]);
  });

  test("does not emit togglePublic when the confirmation is cancelled", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const wrapper = mount(ShareDialog, { props: { bookmark: makeBookmark({ is_public: false }) } });

    await wrapper.find('[data-testid="toggle-input"]').setValue(true);

    expect(wrapper.emitted("togglePublic")).toBeUndefined();
    // The checkbox must not keep showing "public" for a private bookmark.
    const input = wrapper.find('[data-testid="toggle-input"]').element as HTMLInputElement;
    expect(input.checked).toBe(false);
  });

  test("unsharing does not prompt for confirmation", async () => {
    const confirmSpy = vi.spyOn(window, "confirm");
    const wrapper = mount(ShareDialog, { props: { bookmark: makeBookmark({ is_public: true }) } });

    await wrapper.find('[data-testid="toggle-input"]').setValue(false);

    expect(confirmSpy).not.toHaveBeenCalled();
    expect(wrapper.emitted("togglePublic")).toEqual([[false]]);
  });

  describe("while a toggle is being saved", () => {
    test("the checkbox is disabled", () => {
      const wrapper = mount(ShareDialog, { props: { bookmark: makeBookmark(), saving: true } });
      expect(wrapper.find('[data-testid="toggle-input"]').attributes("disabled")).toBeDefined();
    });

    test("a failed save puts the checkbox back to the bookmark's real state", async () => {
      const bookmark = makeBookmark({ is_public: true });
      const wrapper = mount(ShareDialog, { props: { bookmark } });
      const box = wrapper.find('[data-testid="toggle-input"]');
      (box.element as HTMLInputElement).checked = false;
      await box.trigger("change");
      expect(wrapper.emitted("togglePublic")?.[0]).toEqual([false]);

      await wrapper.setProps({ saving: true });
      await wrapper.setProps({ saving: false, error: "network down" });

      expect((box.element as HTMLInputElement).checked).toBe(true);
      expect(wrapper.find('[data-testid="share-error"]').text()).toBe("network down");
      // Still public, so the link stays on offer.
      expect(wrapper.find('[data-testid="link-field"]').exists()).toBe(true);
    });

    test("no error, no message", () => {
      const wrapper = mount(ShareDialog, { props: { bookmark: makeBookmark(), error: null } });
      expect(wrapper.find('[data-testid="share-error"]').exists()).toBe(false);
    });
  });

  test("emits close when clicking the close button", async () => {
    const wrapper = mount(ShareDialog, { props: { bookmark: makeBookmark() } });
    await wrapper.find('[data-testid="close-btn"]').trigger("click");
    expect(wrapper.emitted("close")).toHaveLength(1);
  });

  test("copies the share link to the clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const wrapper = mount(ShareDialog, {
      props: { bookmark: makeBookmark({ is_public: true }), origin: "https://readlater.mlnkv.net" },
    });

    await wrapper.find('[data-testid="copy-btn"]').trigger("click");

    expect(writeText).toHaveBeenCalledWith("https://readlater.mlnkv.net/s/abc-123");
  });

  test("shows a copied state for two seconds after copying", async () => {
    vi.useFakeTimers();
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
    const wrapper = mount(ShareDialog, { props: { bookmark: makeBookmark({ is_public: true }) } });
    const iconClass = () => wrapper.get('[data-testid="copy-btn"] svg').classes();

    expect(iconClass()).toContain("tabler-icon-copy");
    await wrapper.get('[data-testid="copy-btn"]').trigger("click");
    await flushPromises();
    expect(iconClass()).toContain("tabler-icon-copy-check");

    vi.advanceTimersByTime(2000);
    await flushPromises();
    expect(iconClass()).toContain("tabler-icon-copy");
    vi.useRealTimers();
  });

  test("falls back to a hidden textarea and execCommand when the clipboard API is refused", async () => {
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error("NotAllowedError")) },
    });
    let copiedText: string | undefined;
    const execCommand = vi.fn(() => {
      copiedText = (document.activeElement as HTMLTextAreaElement | null)?.value;
      return true;
    });
    Object.defineProperty(document, "execCommand", { value: execCommand, configurable: true });
    const select = vi.spyOn(HTMLTextAreaElement.prototype, "select").mockImplementation(function (
      this: HTMLTextAreaElement,
    ) {
      this.focus();
    });
    const wrapper = mount(ShareDialog, {
      props: { bookmark: makeBookmark({ is_public: true }), origin: "https://readlater.mlnkv.net" },
    });

    await wrapper.get('[data-testid="copy-btn"]').trigger("click");
    await flushPromises();

    expect(select).toHaveBeenCalled();
    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(copiedText).toBe("https://readlater.mlnkv.net/s/abc-123");
    expect(document.querySelector("body > textarea")).toBeNull();
  });

  test("focusing the link field selects the whole link", async () => {
    const wrapper = mount(ShareDialog, { props: { bookmark: makeBookmark({ is_public: true }) } });
    const field = wrapper.get('[data-testid="link-field"]');
    const select = vi.spyOn(field.element as HTMLInputElement, "select");

    await field.trigger("focus");

    expect(select).toHaveBeenCalled();
  });

  test("closing the sheet itself (Escape or the scrim) emits close", () => {
    const wrapper = mount(ShareDialog, { props: { bookmark: makeBookmark() } });
    wrapper.getComponent(Dialog).vm.$emit("close");
    expect(wrapper.emitted("close")).toHaveLength(1);
  });

  test("defaults the link to the current origin", () => {
    const wrapper = mount(ShareDialog, { props: { bookmark: makeBookmark({ is_public: true }) } });
    const field = wrapper.get('[data-testid="link-field"]').element as HTMLInputElement;
    expect(field.value).toBe(`${window.location.origin}/s/abc-123`);
  });

  describe("native share sheet", () => {
    afterEach(() => {
      delete (navigator as Partial<Navigator>).share;
    });

    test("is not offered where the browser has no Web Share API", () => {
      const wrapper = mount(ShareDialog, {
        props: { bookmark: makeBookmark({ is_public: true }) },
      });
      expect(wrapper.text()).not.toContain("Share…");
    });

    test("shares the link and title", async () => {
      const share = vi.fn().mockResolvedValue(undefined);
      Object.assign(navigator, { share });
      const wrapper = mount(ShareDialog, {
        props: {
          bookmark: makeBookmark({ is_public: true }),
          origin: "https://readlater.mlnkv.net",
        },
      });

      await wrapper.get("button:not([data-testid])").trigger("click");

      expect(share).toHaveBeenCalledWith({
        url: "https://readlater.mlnkv.net/s/abc-123",
        title: "Title",
      });
    });

    test("omits a missing title and ignores the user dismissing the sheet", async () => {
      const share = vi.fn().mockRejectedValue(new DOMException("cancelled", "AbortError"));
      Object.assign(navigator, { share });
      const wrapper = mount(ShareDialog, {
        props: {
          bookmark: makeBookmark({ is_public: true, title: null }),
          origin: "https://readlater.mlnkv.net",
        },
      });

      await wrapper.get("button:not([data-testid])").trigger("click");
      await flushPromises();

      expect(share).toHaveBeenCalledWith({
        url: "https://readlater.mlnkv.net/s/abc-123",
        title: undefined,
      });
    });
  });
});
