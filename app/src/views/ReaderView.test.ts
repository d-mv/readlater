import { nextTick } from "vue";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { flushPromises, mount } from "@vue/test-utils";
import type { Bookmark } from "../lib/supabase";

const { from, invoke, storageCreateSignedUrl, storageRemove, pushMock } = vi.hoisted(() => ({
  from: vi.fn(),
  invoke: vi.fn(),
  storageCreateSignedUrl: vi.fn(),
  storageRemove: vi.fn(),
  pushMock: vi.fn(),
}));
vi.mock("../lib/supabase", () => ({
  supabase: {
    from,
    functions: { invoke },
    storage: { from: () => ({ createSignedUrl: storageCreateSignedUrl, remove: storageRemove }) },
  },
}));
vi.mock("vue-router", () => ({ useRouter: () => ({ push: pushMock }) }));

const { default: ReaderView } = await import("./ReaderView.vue");

function makeBookmark(overrides: Partial<Bookmark>): Bookmark {
  return {
    id: "1",
    url: "https://arc90.com/x",
    type: "article",
    status: "failed",
    title: null,
    author: null,
    excerpt: null,
    content_md: null,
    translated_content_md: null,
    translated_lang: null,
    thumbnail_url: null,
    youtube_video_id: null,
    content_edited: false,
    error_message: "Readability could not extract article content",
    word_count: null,
    reading_time: null,
    created_at: "2026-01-01T00:00:00Z",
    processed_at: null,
    pdf_path: null,
    pdf_parsed: false,
    view_mode: null,
    progress: 0,
    read_at: null,
    archived: false,
    is_public: false,
    tags: [],
    ...overrides,
  } as Bookmark;
}

describe("ReaderView", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("shows a Try again button for a failed article that resets it to pending", async () => {
    const failed = makeBookmark({ id: "1" });
    const single = vi.fn().mockResolvedValue({ data: failed, error: null });
    const eqSelect = vi.fn(() => ({ single }));
    const select = vi.fn(() => ({ eq: eqSelect }));
    const eqUpdate = vi.fn().mockResolvedValue({ error: null });
    const update = vi.fn(() => ({ eq: eqUpdate }));
    from.mockReturnValue({ select, update });

    const wrapper = mount(ReaderView, { props: { id: "1" } });
    await flushPromises();

    expect(wrapper.text()).toContain("Couldn't process this article.");
    const retryButton = wrapper.get("button.retry-btn");

    await retryButton.trigger("click");
    await flushPromises();

    expect(update).toHaveBeenCalledWith({
      status: "pending",
      error_message: null,
      content_edited: false,
    });
    expect(wrapper.text()).toContain("Processing…");
  });

  describe("editing", () => {
    function mockReadyBookmark(bookmark: Bookmark) {
      const single = vi.fn().mockResolvedValue({ data: bookmark, error: null });
      const eqSelect = vi.fn(() => ({ single }));
      const select = vi.fn(() => ({ eq: eqSelect }));
      const eqUpdate = vi.fn().mockResolvedValue({ error: null });
      const update = vi.fn(() => ({ eq: eqUpdate }));
      from.mockReturnValue({ select, update });
      return { update };
    }

    async function enterEditMode(wrapper: ReturnType<typeof mount>) {
      await wrapper.find(".menu-trigger").trigger("click");
      await wrapper.find(".edit-item").trigger("click");
    }

    test("Edit switches to a title input and the markdown editor, seeded from the bookmark", async () => {
      const ready = makeBookmark({
        id: "1",
        status: "ready",
        title: "Original title",
        content_md: "original content",
      });
      mockReadyBookmark(ready);

      const wrapper = mount(ReaderView, { props: { id: "1" } });
      await flushPromises();
      await enterEditMode(wrapper);

      expect(wrapper.find("h1.title").exists()).toBe(false);
      const titleInput = wrapper.get("input.title-input");
      expect((titleInput.element as HTMLInputElement).value).toBe("Original title");
    });

    test("Save writes the edited title/content_md and recomputed word_count/reading_time, then exits edit mode", async () => {
      const ready = makeBookmark({
        id: "1",
        status: "ready",
        title: "Original title",
        content_md: "original content",
      });
      const { update } = mockReadyBookmark(ready);

      const wrapper = mount(ReaderView, { props: { id: "1" } });
      await flushPromises();
      await enterEditMode(wrapper);

      await wrapper.get("input.title-input").setValue("Edited title");
      // Simulate the editor reporting new draft content, the same way md-editor-v3 does via update:modelValue.
      await wrapper
        .findComponent({ name: "ArticleContent" })
        .vm.$emit("update:modelValue", "one two three four");

      await wrapper.find(".save-edit-btn").trigger("click");
      await flushPromises();

      expect(update).toHaveBeenCalledWith({
        title: "Edited title",
        content_md: "one two three four",
        word_count: 4,
        reading_time: 1,
        content_edited: true,
        translated_content_md: null,
        translated_lang: null,
      });
      expect(wrapper.find("h1.title").text()).toBe("Edited title");
      expect(wrapper.find("input.title-input").exists()).toBe(false);
    });

    test("Cancel discards the draft without saving", async () => {
      const ready = makeBookmark({
        id: "1",
        status: "ready",
        title: "Original title",
        content_md: "original content",
      });
      const { update } = mockReadyBookmark(ready);

      const wrapper = mount(ReaderView, { props: { id: "1" } });
      await flushPromises();
      await enterEditMode(wrapper);

      await wrapper.get("input.title-input").setValue("Edited title");
      await wrapper.find(".cancel-edit-btn").trigger("click");

      expect(update).not.toHaveBeenCalled();
      expect(wrapper.find("h1.title").text()).toBe("Original title");
    });
  });

  describe("translate", () => {
    function mockReadyNote(bookmark: Bookmark) {
      const single = vi.fn().mockResolvedValue({ data: bookmark, error: null });
      const eqSelect = vi.fn(() => ({ single }));
      const select = vi.fn(() => ({ eq: eqSelect }));
      from.mockReturnValue({ select });
    }

    async function clickTranslate(wrapper: ReturnType<typeof mount>) {
      await wrapper.find(".menu-trigger").trigger("click");
      await wrapper.find(".translate-item").trigger("click");
    }

    test("replaces the rendered content with the translation and offers a 'Show original' toggle", async () => {
      const note = makeBookmark({
        id: "1",
        status: "ready",
        url: null,
        type: "note",
        content_md: "Bonjour le monde",
      });
      mockReadyNote(note);
      invoke.mockResolvedValue({
        data: { translated_text: "Hello world", translated_lang: "EN" },
        error: null,
      });

      const wrapper = mount(ReaderView, { props: { id: "1" } });
      await flushPromises();
      await clickTranslate(wrapper);
      await flushPromises();

      expect(invoke).toHaveBeenCalledWith("translate", {
        body: { bookmark_id: "1", text: "Bonjour le monde", target_lang: expect.any(String) },
      });
      expect(wrapper.text()).toContain("Translated");
      expect(wrapper.findComponent({ name: "ArticleContent" }).props("contentMd")).toBe(
        "Hello world",
      );

      await wrapper.find(".translate-toggle").trigger("click");
      expect(wrapper.text()).toContain("Original");
      expect(wrapper.findComponent({ name: "ArticleContent" }).props("contentMd")).toBe(
        "Bonjour le monde",
      );
    });

    test("shows the edge function's error message when translation fails", async () => {
      const note = makeBookmark({
        id: "1",
        status: "ready",
        url: null,
        type: "note",
        content_md: "Bonjour",
      });
      mockReadyNote(note);
      invoke.mockResolvedValue({ data: null, error: { message: "DeepL error" } });

      const wrapper = mount(ReaderView, { props: { id: "1" } });
      await flushPromises();
      await clickTranslate(wrapper);
      await flushPromises();

      expect(wrapper.text()).toContain("DeepL error");
      expect(wrapper.findComponent({ name: "ArticleContent" }).props("contentMd")).toBe("Bonjour");
    });

    test("shows a bookmark's cached translation by default without calling DeepL again", async () => {
      const note = makeBookmark({
        id: "1",
        status: "ready",
        url: null,
        type: "note",
        content_md: "Bonjour le monde",
        translated_content_md: "Hello world",
        translated_lang: "EN",
      });
      mockReadyNote(note);

      const wrapper = mount(ReaderView, { props: { id: "1" } });
      await flushPromises();

      expect(invoke).not.toHaveBeenCalled();
      expect(wrapper.text()).toContain("Translated");
      expect(wrapper.findComponent({ name: "ArticleContent" }).props("contentMd")).toBe(
        "Hello world",
      );
    });

    test("clicking Translate with a cached translation just shows it, without re-calling DeepL", async () => {
      const note = makeBookmark({
        id: "1",
        status: "ready",
        url: null,
        type: "note",
        content_md: "Bonjour le monde",
        translated_content_md: "Hello world",
        translated_lang: "EN",
      });
      mockReadyNote(note);

      const wrapper = mount(ReaderView, { props: { id: "1" } });
      await flushPromises();
      await wrapper.find(".translate-toggle").trigger("click"); // switch to original first
      await clickTranslate(wrapper);
      await flushPromises();

      expect(invoke).not.toHaveBeenCalled();
      expect(wrapper.findComponent({ name: "ArticleContent" }).props("contentMd")).toBe(
        "Hello world",
      );
    });
  });

  describe("pdf", () => {
    function mockReadyBookmark(bookmark: Bookmark) {
      const single = vi.fn().mockResolvedValue({ data: bookmark, error: null });
      const eqSelect = vi.fn(() => ({ single }));
      const select = vi.fn(() => ({ eq: eqSelect }));
      const eqUpdate = vi.fn().mockResolvedValue({ error: null });
      const update = vi.fn(() => ({ eq: eqUpdate }));
      from.mockReturnValue({ select, update });
      return { update };
    }

    test("a parsed PDF defaults to the markdown view and offers a toggle to the original", async () => {
      const pdf = makeBookmark({
        id: "1",
        status: "ready",
        url: null,
        type: "pdf",
        content_md: "Extracted text",
        pdf_path: "user-1/a.pdf",
        pdf_parsed: true,
      });
      mockReadyBookmark(pdf);

      const wrapper = mount(ReaderView, { props: { id: "1" } });
      await flushPromises();

      expect(wrapper.text()).toContain("Markdown");
      expect(wrapper.findComponent({ name: "ArticleContent" }).props("showPdfOriginal")).toBe(
        false,
      );
      expect(storageCreateSignedUrl).not.toHaveBeenCalled();
    });

    test("toggling to the original view resolves a signed url, renders it, and persists the choice", async () => {
      const pdf = makeBookmark({
        id: "1",
        status: "ready",
        url: null,
        type: "pdf",
        content_md: "Extracted text",
        pdf_path: "user-1/a.pdf",
        pdf_parsed: true,
      });
      const { update } = mockReadyBookmark(pdf);
      storageCreateSignedUrl.mockResolvedValue({
        data: { signedUrl: "https://storage.example/signed" },
        error: null,
      });

      const wrapper = mount(ReaderView, { props: { id: "1" } });
      await flushPromises();

      await wrapper.find(".pdf-view-toggle").trigger("click");
      await flushPromises();

      expect(update).toHaveBeenCalledWith({ view_mode: "original" });
      expect(storageCreateSignedUrl).toHaveBeenCalledWith("user-1/a.pdf", 60);
      expect(wrapper.findComponent({ name: "ArticleContent" }).props("showPdfOriginal")).toBe(true);
      expect(wrapper.findComponent({ name: "ArticleContent" }).props("pdfUrl")).toBe(
        "https://storage.example/signed",
      );
      expect(wrapper.text()).toContain("Original PDF");
    });

    test("a PDF with failed parsing forces the original view and loads it automatically, with no toggle", async () => {
      const pdf = makeBookmark({
        id: "1",
        status: "ready",
        url: null,
        type: "pdf",
        content_md: null,
        pdf_path: "user-1/scanned.pdf",
        pdf_parsed: false,
      });
      mockReadyBookmark(pdf);
      storageCreateSignedUrl.mockResolvedValue({
        data: { signedUrl: "https://storage.example/scanned" },
        error: null,
      });

      const wrapper = mount(ReaderView, { props: { id: "1" } });
      await flushPromises();

      expect(wrapper.find(".pdf-view-bar").exists()).toBe(false);
      expect(wrapper.findComponent({ name: "ArticleContent" }).props("showPdfOriginal")).toBe(true);
      expect(wrapper.findComponent({ name: "ArticleContent" }).props("pdfUrl")).toBe(
        "https://storage.example/scanned",
      );
    });

    test("Open original opens a freshly resolved signed url in a new tab", async () => {
      const pdf = makeBookmark({
        id: "1",
        status: "ready",
        url: null,
        type: "pdf",
        content_md: "Extracted text",
        pdf_path: "user-1/a.pdf",
        pdf_parsed: true,
      });
      mockReadyBookmark(pdf);
      storageCreateSignedUrl.mockResolvedValue({
        data: { signedUrl: "https://storage.example/open" },
        error: null,
      });
      const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);

      const wrapper = mount(ReaderView, { props: { id: "1" } });
      await flushPromises();
      await wrapper.find(".menu-trigger").trigger("click");
      await wrapper.find(".open-original").trigger("click");
      await flushPromises();

      expect(openSpy).toHaveBeenCalledWith("https://storage.example/open", "_blank", "noopener");
      openSpy.mockRestore();
    });

    test("Trash original PDF removes the storage object and drops the view toggle", async () => {
      const pdf = makeBookmark({
        id: "1",
        status: "ready",
        url: null,
        type: "pdf",
        content_md: "Extracted text",
        pdf_path: "user-1/a.pdf",
        pdf_parsed: true,
      });
      mockReadyBookmark(pdf);
      storageRemove.mockResolvedValue({ error: null });
      vi.spyOn(window, "confirm").mockReturnValue(true);

      const wrapper = mount(ReaderView, { props: { id: "1" } });
      await flushPromises();
      await wrapper.find(".menu-trigger").trigger("click");
      await wrapper.find(".trash-pdf-item").trigger("click");
      await flushPromises();

      expect(storageRemove).toHaveBeenCalledWith(["user-1/a.pdf"]);
      expect(wrapper.find(".pdf-view-bar").exists()).toBe(false);
      await wrapper.find(".menu-trigger").trigger("click");
      expect(wrapper.find(".open-original").exists()).toBe(false);
    });
  });

  describe("deleting", () => {
    test("navigates back to the list immediately without awaiting deletion response from store", async () => {
      let resolveRemove: (val?: unknown) => void = () => {};
      const removePromise = new Promise((res) => {
        resolveRemove = res;
      });
      const ready = makeBookmark({ id: "1", status: "ready" });
      const single = vi.fn().mockResolvedValue({ data: ready, error: null });
      const eqSelect = vi.fn(() => ({ single }));
      const select = vi.fn(() => ({ eq: eqSelect }));
      const eqDelete = vi.fn().mockReturnValue(removePromise);
      const deleteFn = vi.fn(() => ({ eq: eqDelete }));
      from.mockReturnValue({ select, delete: deleteFn });
      vi.spyOn(window, "confirm").mockReturnValue(true);

      const wrapper = mount(ReaderView, { props: { id: "1" } });
      await flushPromises();

      await wrapper.find(".menu-trigger").trigger("click");
      await wrapper.find(".delete-item").trigger("click");

      expect(pushMock).toHaveBeenCalledWith({ name: "list" });

      resolveRemove();
      await flushPromises();
    });
  });

  describe("reading progress", () => {
    test("restores scroll position based on saved progress in bookmark", async () => {
      const ready = makeBookmark({
        id: "1",
        status: "ready",
        progress: 0.5,
        content_md: "Some long article text",
      });
      const single = vi.fn().mockResolvedValue({ data: ready, error: null });
      const eqSelect = vi.fn(() => ({ single }));
      const select = vi.fn(() => ({ eq: eqSelect }));
      from.mockReturnValue({ select });

      const wrapper = mount(ReaderView, { props: { id: "1" } });
      await flushPromises();

      const scrollEl = wrapper.find(".scroll-area").element as HTMLDivElement;
      Object.defineProperty(scrollEl, "scrollHeight", { value: 1000, configurable: true });
      Object.defineProperty(scrollEl, "clientHeight", { value: 200, configurable: true });

      vi.advanceTimersByTime(100);
      await flushPromises();

      expect(scrollEl.scrollTop).toBe(400);
    });

    test("saves progress as the user scrolls", async () => {
      const eqUpdate = vi.fn().mockResolvedValue({ error: null });
      const update = vi.fn(() => ({ eq: eqUpdate }));
      const ready = makeBookmark({
        id: "1",
        status: "ready",
        progress: 0,
        content_md: "Text",
      });
      const single = vi.fn().mockResolvedValue({ data: ready, error: null });
      const eqSelect = vi.fn(() => ({ single }));
      const select = vi.fn(() => ({ eq: eqSelect }));
      from.mockReturnValue({ select, update });

      const wrapper = mount(ReaderView, { props: { id: "1" } });
      await flushPromises();

      const scrollEl = wrapper.find(".scroll-area").element as HTMLDivElement;
      Object.defineProperty(scrollEl, "scrollHeight", { value: 1000, configurable: true });
      Object.defineProperty(scrollEl, "clientHeight", { value: 200, configurable: true });
      Object.defineProperty(scrollEl, "scrollTop", {
        value: 400,
        configurable: true,
        writable: true,
      });

      scrollEl.dispatchEvent(new Event("scroll"));
      await nextTick();
      await vi.advanceTimersByTimeAsync(600);

      expect(update).toHaveBeenCalledWith({ progress: 0.5 });
    });
  });
});
