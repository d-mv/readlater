import { nextTick } from "vue";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import type { Bookmark } from "../lib/supabase";

const { from, invoke, storageCreateSignedUrl, storageRemove, pushMock, realtimeChannel } =
  vi.hoisted(() => {
    const realtimeChannel = { on: () => realtimeChannel, subscribe: () => realtimeChannel };
    return {
      from: vi.fn(),
      invoke: vi.fn(),
      storageCreateSignedUrl: vi.fn(),
      storageRemove: vi.fn(),
      pushMock: vi.fn(),
      realtimeChannel,
    };
  });
vi.mock("../lib/supabase", () => ({
  supabase: {
    from,
    functions: { invoke },
    channel: () => realtimeChannel,
    removeChannel: () => {},
    storage: {
      from: () => ({
        createSignedUrl: storageCreateSignedUrl,
        remove: storageRemove,
        getPublicUrl: () => ({
          data: {
            publicUrl: "https://example.supabase.co/storage/v1/object/public/bookmark-assets/",
          },
        }),
      }),
    },
  },
}));
vi.mock("vue-router", () => ({ useRouter: () => ({ push: pushMock }) }));

const { default: ReaderView } = await import("./ReaderView.vue");
const { useBookmarksStore } = await import("../stores/bookmarks");
const { useOfflineCacheStore } = await import("../stores/offlineCache");

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

// A reader left mounted keeps its window/document listeners, and would answer
// the visibility and connectivity events later tests dispatch.
enableAutoUnmount(afterEach);

describe("ReaderView", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("fetches the full row when the store only holds a body-less list-projection row", async () => {
    const store = useBookmarksStore();
    const listRow = makeBookmark({ id: "1", status: "ready", title: "An article" });
    delete (listRow as unknown as Record<string, unknown>).content_md;
    store.bookmarks = [listRow];

    const full = makeBookmark({ id: "1", status: "ready", content_md: "the full body" });
    const single = vi.fn().mockResolvedValue({ data: full, error: null });
    const eqSelect = vi.fn(() => ({ single }));
    const select = vi.fn(() => ({ eq: eqSelect }));
    from.mockReturnValue({ select });

    const wrapper = mount(ReaderView, { props: { id: "1" } });
    await flushPromises();

    expect(select).toHaveBeenCalledWith("*, tags(id, name, color)");
    expect(wrapper.findComponent({ name: "ArticleContent" }).props("contentMd")).toBe(
      "the full body",
    );
  });

  test("pulls the full body when a Realtime update flips the article to ready", async () => {
    const store = useBookmarksStore();
    store.bookmarks = [makeBookmark({ id: "1", status: "processing", content_md: null })];

    const ready = makeBookmark({ id: "1", status: "ready", content_md: "freshly parsed" });
    const single = vi.fn().mockResolvedValue({ data: ready, error: null });
    const select = vi.fn(() => ({ eq: () => ({ single }) }));
    from.mockReturnValue({ select });

    const wrapper = mount(ReaderView, { props: { id: "1" } });
    await flushPromises();
    expect(select).not.toHaveBeenCalled();

    // Simulate the store applying a Realtime UPDATE.
    store.bookmarks[0]!.status = "ready";
    await flushPromises();

    expect(select).toHaveBeenCalledWith("*, tags(id, name, color)");
    expect(wrapper.findComponent({ name: "ArticleContent" }).props("contentMd")).toBe(
      "freshly parsed",
    );
  });

  test("does not re-fetch when the store already holds the full row with its body", async () => {
    const store = useBookmarksStore();
    store.bookmarks = [makeBookmark({ id: "1", status: "ready", content_md: "already here" })];

    const select = vi.fn();
    from.mockReturnValue({ select });

    const wrapper = mount(ReaderView, { props: { id: "1" } });
    await flushPromises();

    expect(select).not.toHaveBeenCalled();
    expect(wrapper.findComponent({ name: "ArticleContent" }).props("contentMd")).toBe(
      "already here",
    );
  });

  describe("images missing from the offline copy", () => {
    function mountCachedArticle(missing: number) {
      const store = useBookmarksStore();
      store.bookmarks = [makeBookmark({ id: "1", status: "ready", content_md: "body" })];
      vi.spyOn(useOfflineCacheStore(), "missingImageCount").mockReturnValue(missing);
      return mount(ReaderView, { props: { id: "1" } });
    }

    afterEach(() => vi.restoreAllMocks());

    test("are called out while reading offline", async () => {
      vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
      const wrapper = mountCachedArticle(3);
      await flushPromises();

      expect(wrapper.find('[data-testid="images-not-cached"]').text()).toBe(
        "3 images weren't saved for offline reading.",
      );
    });

    test("are not mentioned online, where the images load normally", async () => {
      vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
      const wrapper = mountCachedArticle(3);
      await flushPromises();

      expect(wrapper.find('[data-testid="images-not-cached"]').exists()).toBe(false);
    });

    test("the note appears when the connection drops mid-read", async () => {
      const onLine = vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
      const wrapper = mountCachedArticle(1);
      await flushPromises();

      onLine.mockReturnValue(false);
      window.dispatchEvent(new Event("offline"));
      await nextTick();

      expect(wrapper.find('[data-testid="images-not-cached"]').text()).toBe(
        "1 image wasn't saved for offline reading.",
      );
    });
  });

  test("shows not found / offline unavailable state when bookmark cannot be loaded", async () => {
    const store = useBookmarksStore();
    store.bookmarks = [];
    vi.spyOn(store, "fetchOne").mockResolvedValue(null);

    const wrapper = mount(ReaderView, { props: { id: "missing-1" } });
    await flushPromises();

    expect(wrapper.find('[data-testid="not-found"]').exists()).toBe(true);
    expect(wrapper.text()).toContain("Article not available offline");
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
    const retryButton = wrapper.get('button[data-testid="retry-btn"]');

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
      await wrapper.find('[data-testid="menu-trigger"]').trigger("click");
      await wrapper.find('[data-testid="edit-item"]').trigger("click");
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

      expect(wrapper.find('h1[data-testid="title"]').exists()).toBe(false);
      const titleInput = wrapper.get('input[data-testid="title-input"]');
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

      await wrapper.get('input[data-testid="title-input"]').setValue("Edited title");
      // Simulate the editor reporting new draft content, the same way md-editor-v3 does via update:modelValue.
      await wrapper
        .findComponent({ name: "ArticleContent" })
        .vm.$emit("update:modelValue", "one two three four");

      await wrapper.find('[data-testid="save-edit-btn"]').trigger("click");
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
      expect(wrapper.find('h1[data-testid="title"]').text()).toBe("Edited title");
      expect(wrapper.find('input[data-testid="title-input"]').exists()).toBe(false);
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

      await wrapper.get('input[data-testid="title-input"]').setValue("Edited title");
      await wrapper.find('[data-testid="cancel-edit-btn"]').trigger("click");

      expect(update).not.toHaveBeenCalled();
      expect(wrapper.find('h1[data-testid="title"]').text()).toBe("Original title");
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
      await wrapper.find('[data-testid="menu-trigger"]').trigger("click");
      await wrapper.find('[data-testid="translate-item"]').trigger("click");
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
        body: { bookmark_id: "1", target_lang: expect.any(String) },
      });
      expect(wrapper.text()).toContain("Translated");
      expect(wrapper.findComponent({ name: "ArticleContent" }).props("contentMd")).toBe(
        "Hello world",
      );

      await wrapper.find('[data-testid="translate-toggle"]').trigger("click");
      expect(wrapper.text()).toContain("Original");
      expect(wrapper.findComponent({ name: "ArticleContent" }).props("contentMd")).toBe(
        "Bonjour le monde",
      );
    });

    test("a second Translate while one is in flight does not call DeepL again", async () => {
      mockReadyNote(
        makeBookmark({ id: "1", status: "ready", url: null, type: "note", content_md: "Salut" }),
      );
      invoke.mockReturnValue(new Promise(() => {}));

      const wrapper = mount(ReaderView, { props: { id: "1" } });
      await flushPromises();
      await clickTranslate(wrapper);
      await clickTranslate(wrapper);
      await flushPromises();

      expect(invoke).toHaveBeenCalledTimes(1);
      expect(wrapper.text()).toContain("Translating…");
    });

    test("editing during a translation keeps the editor open when the translation arrives", async () => {
      mockReadyNote(
        makeBookmark({ id: "1", status: "ready", url: null, type: "note", content_md: "Salut" }),
      );
      let respond!: (value: unknown) => void;
      invoke.mockReturnValue(new Promise((r) => (respond = r)));

      const wrapper = mount(ReaderView, { props: { id: "1" } });
      await flushPromises();
      await clickTranslate(wrapper);
      await wrapper.find('[data-testid="menu-trigger"]').trigger("click");
      await wrapper.find('[data-testid="edit-item"]').trigger("click");

      respond({ data: { translated_text: "Hi", translated_lang: "EN" }, error: null });
      await flushPromises();

      expect(wrapper.find('input[data-testid="title-input"]').exists()).toBe(true);
      expect(wrapper.find('[data-testid="translate-bar"]').exists()).toBe(false);
      expect(wrapper.findComponent({ name: "ArticleContent" }).props("editing")).toBe(true);
    });

    test("a translation that finishes after switching bookmarks doesn't touch the new one", async () => {
      const store = useBookmarksStore();
      store.bookmarks = [
        makeBookmark({ id: "1", status: "ready", url: null, type: "note", content_md: "Un" }),
        makeBookmark({ id: "2", status: "ready", url: null, type: "note", content_md: "Deux" }),
      ];
      let respond!: (value: unknown) => void;
      invoke.mockReturnValue(new Promise((r) => (respond = r)));

      const wrapper = mount(ReaderView, { props: { id: "1" } });
      await flushPromises();
      await clickTranslate(wrapper);
      await wrapper.setProps({ id: "2" });

      respond({ data: null, error: { message: "DeepL quota exceeded" } });
      await flushPromises();

      expect(wrapper.text()).not.toContain("DeepL quota exceeded");
      expect(wrapper.find('[data-testid="translate-bar"]').exists()).toBe(false);
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
      await wrapper.find('[data-testid="translate-toggle"]').trigger("click"); // switch to original first
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

      await wrapper.find('[data-testid="pdf-view-toggle"]').trigger("click");
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

      expect(wrapper.find('[data-testid="pdf-view-bar"]').exists()).toBe(false);
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
      await wrapper.find('[data-testid="menu-trigger"]').trigger("click");
      await wrapper.find('[data-testid="open-original"]').trigger("click");
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
      await wrapper.find('[data-testid="menu-trigger"]').trigger("click");
      await wrapper.find('[data-testid="trash-pdf-item"]').trigger("click");
      await flushPromises();

      expect(storageRemove).toHaveBeenCalledWith(["user-1/a.pdf"]);
      expect(wrapper.find('[data-testid="pdf-view-bar"]').exists()).toBe(false);
      await wrapper.find('[data-testid="menu-trigger"]').trigger("click");
      expect(wrapper.find('[data-testid="open-original"]').exists()).toBe(false);
    });
  });

  describe("failed writes", () => {
    test("archiving that fails shows an error and stays in the reader", async () => {
      const ready = makeBookmark({ id: "1", status: "ready", archived: false });
      const single = vi.fn().mockResolvedValue({ data: ready, error: null });
      const select = vi.fn(() => ({ eq: vi.fn(() => ({ single })) }));
      const eqUpdate = vi.fn().mockResolvedValue({ error: { message: "offline" } });
      from.mockReturnValue({ select, update: vi.fn(() => ({ eq: eqUpdate })) });

      const wrapper = mount(ReaderView, { props: { id: "1" } });
      await flushPromises();

      await wrapper.find('[data-testid="menu-trigger"]').trigger("click");
      await wrapper.find('[data-testid="archive-item"]').trigger("click");
      await flushPromises();

      expect(pushMock).not.toHaveBeenCalled();
      expect(wrapper.find('[data-testid="action-error"]').text()).toMatch(/Couldn't save/);
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

      await wrapper.find('[data-testid="menu-trigger"]').trigger("click");
      await wrapper.find('[data-testid="delete-item"]').trigger("click");

      expect(pushMock).toHaveBeenCalledWith({ name: "list" });

      resolveRemove({ error: null });
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

      const scrollEl = wrapper.find('[data-testid="scroll-area"]').element as HTMLDivElement;
      Object.defineProperty(scrollEl, "scrollHeight", { value: 1000, configurable: true });
      Object.defineProperty(scrollEl, "clientHeight", { value: 200, configurable: true });

      vi.advanceTimersByTime(100);
      await flushPromises();

      expect(scrollEl.scrollTop).toBe(400);
    });

    test("restores the saved position once the body arrives for a list row opened without one", async () => {
      const store = useBookmarksStore();
      const listRow = makeBookmark({ id: "1", status: "ready", progress: 0.5 });
      delete (listRow as unknown as Record<string, unknown>).content_md;
      store.bookmarks = [listRow];

      let resolveFetch!: (value: { data: Bookmark; error: null }) => void;
      const single = vi.fn(
        () =>
          new Promise((resolve) => {
            resolveFetch = resolve;
          }),
      );
      from.mockReturnValue({ select: vi.fn(() => ({ eq: () => ({ single }) })) });

      const wrapper = mount(ReaderView, { props: { id: "1" } });
      await flushPromises();

      // While the body is loading only a placeholder renders — nothing to scroll.
      const scrollEl = wrapper.find('[data-testid="scroll-area"]').element as HTMLDivElement;
      Object.defineProperty(scrollEl, "scrollHeight", { value: 200, configurable: true });
      Object.defineProperty(scrollEl, "clientHeight", { value: 200, configurable: true });
      vi.advanceTimersByTime(100);
      await flushPromises();
      expect(scrollEl.scrollTop).toBe(0);

      resolveFetch({
        data: makeBookmark({ id: "1", status: "ready", progress: 0.5, content_md: "Long body" }),
        error: null,
      });
      await flushPromises();
      Object.defineProperty(scrollEl, "scrollHeight", { value: 1000, configurable: true });
      vi.advanceTimersByTime(100);
      await flushPromises();

      expect(scrollEl.scrollTop).toBe(400);
    });

    test("does not save progress from scrolls made before the body is restored", async () => {
      const store = useBookmarksStore();
      const listRow = makeBookmark({ id: "1", status: "ready", progress: 0.5 });
      delete (listRow as unknown as Record<string, unknown>).content_md;
      store.bookmarks = [listRow];

      const update = vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ error: null }) }));
      const single = vi.fn(() => new Promise(() => {}));
      from.mockReturnValue({ select: vi.fn(() => ({ eq: () => ({ single }) })), update });

      const wrapper = mount(ReaderView, { props: { id: "1" } });
      await flushPromises();

      const scrollEl = wrapper.find('[data-testid="scroll-area"]').element as HTMLDivElement;
      Object.defineProperty(scrollEl, "scrollHeight", { value: 1000, configurable: true });
      Object.defineProperty(scrollEl, "clientHeight", { value: 200, configurable: true });
      // A stray scroll on the placeholder (10%) must not overwrite the saved 50%.
      Object.defineProperty(scrollEl, "scrollTop", {
        value: 80,
        configurable: true,
        writable: true,
      });
      scrollEl.dispatchEvent(new Event("scroll"));
      await nextTick();
      await vi.advanceTimersByTimeAsync(2000);

      expect(update).not.toHaveBeenCalled();
    });

    test("writes a pending position to the bookmark it was read on, not the next one", async () => {
      const store = useBookmarksStore();
      const eqUpdate = vi.fn().mockResolvedValue({ error: null });
      const update = vi.fn(() => ({ eq: eqUpdate }));
      store.bookmarks = [
        makeBookmark({ id: "1", status: "ready", progress: 0, content_md: "One" }),
        makeBookmark({ id: "2", status: "ready", progress: 0, content_md: "Two" }),
      ];
      from.mockReturnValue({ update });

      const wrapper = mount(ReaderView, { props: { id: "1" } });
      await flushPromises();

      const scrollEl = wrapper.find('[data-testid="scroll-area"]').element as HTMLDivElement;
      Object.defineProperty(scrollEl, "scrollHeight", { value: 1000, configurable: true });
      Object.defineProperty(scrollEl, "clientHeight", { value: 200, configurable: true });
      Object.defineProperty(scrollEl, "scrollTop", {
        value: 400,
        configurable: true,
        writable: true,
      });
      scrollEl.dispatchEvent(new Event("scroll"));
      await nextTick();

      // Navigate to another bookmark before the debounced write fires.
      await wrapper.setProps({ id: "2" });
      await vi.advanceTimersByTimeAsync(2000);

      expect(update).toHaveBeenCalledTimes(1);
      expect(update).toHaveBeenCalledWith({ progress: 0.5 });
      expect(eqUpdate).toHaveBeenCalledWith("id", "1");
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

      const scrollEl = wrapper.find('[data-testid="scroll-area"]').element as HTMLDivElement;
      Object.defineProperty(scrollEl, "scrollHeight", { value: 1000, configurable: true });
      Object.defineProperty(scrollEl, "clientHeight", { value: 200, configurable: true });
      Object.defineProperty(scrollEl, "scrollTop", {
        value: 400,
        configurable: true,
        writable: true,
      });

      scrollEl.dispatchEvent(new Event("scroll"));
      await nextTick();
      await vi.advanceTimersByTimeAsync(2000);

      expect(update).toHaveBeenCalledWith({ progress: 0.5 });
    });

    test("ignores scroll movements smaller than the write threshold", async () => {
      const update = vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ error: null }) }));
      const ready = makeBookmark({ id: "1", status: "ready", progress: 0, content_md: "Text" });
      const single = vi.fn().mockResolvedValue({ data: ready, error: null });
      from.mockReturnValue({ select: vi.fn(() => ({ eq: () => ({ single }) })), update });

      const wrapper = mount(ReaderView, { props: { id: "1" } });
      await flushPromises();

      const scrollEl = wrapper.find('[data-testid="scroll-area"]').element as HTMLDivElement;
      Object.defineProperty(scrollEl, "scrollHeight", { value: 1000, configurable: true });
      Object.defineProperty(scrollEl, "clientHeight", { value: 200, configurable: true });
      Object.defineProperty(scrollEl, "scrollTop", {
        value: 8,
        configurable: true,
        writable: true,
      });

      scrollEl.dispatchEvent(new Event("scroll"));
      await nextTick();
      await vi.advanceTimersByTimeAsync(2000);

      expect(update).not.toHaveBeenCalled();
    });

    test("flushes the pending progress write when the page is hidden", async () => {
      const update = vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ error: null }) }));
      const ready = makeBookmark({ id: "1", status: "ready", progress: 0, content_md: "Text" });
      const single = vi.fn().mockResolvedValue({ data: ready, error: null });
      from.mockReturnValue({ select: vi.fn(() => ({ eq: () => ({ single }) })), update });

      const wrapper = mount(ReaderView, { props: { id: "1" } });
      await flushPromises();

      const scrollEl = wrapper.find('[data-testid="scroll-area"]').element as HTMLDivElement;
      Object.defineProperty(scrollEl, "scrollHeight", { value: 1000, configurable: true });
      Object.defineProperty(scrollEl, "clientHeight", { value: 200, configurable: true });
      Object.defineProperty(scrollEl, "scrollTop", {
        value: 600,
        configurable: true,
        writable: true,
      });

      scrollEl.dispatchEvent(new Event("scroll"));
      await nextTick();
      // Before the debounce would fire.
      window.dispatchEvent(new Event("pagehide"));

      expect(update).toHaveBeenCalledWith({ progress: 0.75 });
    });
  });

  describe("actions", () => {
    function mountReady(overrides: Partial<Bookmark> = {}) {
      const store = useBookmarksStore();
      store.bookmarks = [
        makeBookmark({ id: "1", status: "ready", content_md: "Body", ...overrides }),
      ];
      const wrapper = mount(ReaderView, { props: { id: "1" } });
      return { store, wrapper };
    }

    async function openMenuItem(wrapper: ReturnType<typeof mount>, testId: string) {
      await wrapper.get('[data-testid="menu-trigger"]').trigger("click");
      await wrapper.get(`[data-testid="${testId}"]`).trigger("click");
      await flushPromises();
    }

    test("Back returns to the reading list", async () => {
      const { wrapper } = mountReady();
      await flushPromises();

      await wrapper.get('[data-testid="back-btn"]').trigger("click");

      expect(pushMock).toHaveBeenCalledWith({ name: "list" });
    });

    test("the not-available screen also leads back to the list", async () => {
      vi.spyOn(useBookmarksStore(), "fetchOne").mockResolvedValue(null);
      const wrapper = mount(ReaderView, { props: { id: "missing" } });
      await flushPromises();

      await wrapper.get('[data-testid="back-to-list-btn"]').trigger("click");

      expect(pushMock).toHaveBeenCalledWith({ name: "list" });
    });

    test("a successful archive returns to the list", async () => {
      const { store, wrapper } = mountReady();
      const archive = vi.spyOn(store, "archive").mockResolvedValue({ error: null });
      await flushPromises();

      await openMenuItem(wrapper, "archive-item");

      expect(archive).toHaveBeenCalledWith("1");
      expect(pushMock).toHaveBeenCalledWith({ name: "list" });
    });

    test("Mark as read and Mark as unread write through the store", async () => {
      const { store, wrapper } = mountReady({ read_at: null });
      const markRead = vi.spyOn(store, "markRead").mockResolvedValue({ error: null });
      const markUnread = vi.spyOn(store, "markUnread").mockResolvedValue({ error: null });
      await flushPromises();

      await openMenuItem(wrapper, "mark-read");
      expect(markRead).toHaveBeenCalledWith("1");

      store.bookmarks[0]!.read_at = "2026-02-01T00:00:00Z";
      await flushPromises();
      await openMenuItem(wrapper, "mark-unread");
      expect(markUnread).toHaveBeenCalledWith("1");
      expect(wrapper.find('[data-testid="action-error"]').exists()).toBe(false);
    });

    test("a failed mark-as-read is reported", async () => {
      const { store, wrapper } = mountReady({ read_at: null });
      vi.spyOn(store, "markRead").mockResolvedValue({ error: "Couldn't save the change." });
      await flushPromises();

      await openMenuItem(wrapper, "mark-read");

      expect(wrapper.get('[data-testid="action-error"]').text()).toBe("Couldn't save the change.");
    });

    test("Share opens the dialog, which can make the bookmark public and be closed", async () => {
      const { store, wrapper } = mountReady({ is_public: false });
      const setPublic = vi.spyOn(store, "setPublic").mockResolvedValue({ error: null });
      const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
      await flushPromises();

      await openMenuItem(wrapper, "share-item");
      const dialog = wrapper.findComponent({ name: "ShareDialog" });
      expect(dialog.exists()).toBe(true);

      await dialog.get('[data-testid="toggle-input"]').setValue(true);
      await flushPromises();
      expect(setPublic).toHaveBeenCalledWith("1", true);

      await dialog.get('[data-testid="close-btn"]').trigger("click");
      expect(wrapper.findComponent({ name: "ShareDialog" }).exists()).toBe(false);
      confirm.mockRestore();
    });

    test("adding and removing a tag go through the store for this bookmark", async () => {
      const { store, wrapper } = mountReady({
        tags: [{ id: "t1", name: "later", color: "#000" }],
      } as Partial<Bookmark>);
      const addTag = vi.spyOn(store, "addTag").mockResolvedValue({ error: null });
      const removeTag = vi.spyOn(store, "removeTag").mockResolvedValue({ error: null });
      await flushPromises();

      const tagInput = wrapper.findComponent({ name: "TagInput" });
      tagInput.vm.$emit("add", "physics");
      tagInput.vm.$emit("remove", "t1");
      await flushPromises();

      expect(addTag).toHaveBeenCalledWith("1", "physics");
      expect(removeTag).toHaveBeenCalledWith("1", "t1");
    });

    test("a failed article without an error message shows no details line", async () => {
      const { wrapper } = mountReady({ status: "failed", error_message: null });
      await flushPromises();

      const placeholder = wrapper.get('[data-testid="status-placeholder"]');
      expect(placeholder.text()).toContain("Couldn't process this article.");
      expect(placeholder.findAll("p")).toHaveLength(1);
    });

    test("an article deleted while its body loads after turning ready isn't cached", async () => {
      const { store, wrapper } = mountReady({ status: "processing", content_md: null });
      await flushPromises();
      const cacheSpy = vi.spyOn(useOfflineCacheStore(), "cacheBookmark");
      vi.spyOn(store, "fetchOne").mockImplementation(async () => {
        store.bookmarks = [];
        return null;
      });

      store.bookmarks[0]!.status = "ready";
      await flushPromises();

      expect(cacheSpy).not.toHaveBeenCalled();
      expect(wrapper.find('[data-testid="not-found"]').exists()).toBe(true);
    });
  });

  describe("editing, more", () => {
    async function enterEditMode(wrapper: ReturnType<typeof mount>) {
      await wrapper.get('[data-testid="menu-trigger"]').trigger("click");
      await wrapper.get('[data-testid="edit-item"]').trigger("click");
    }

    function titleValue(wrapper: ReturnType<typeof mount>) {
      return (wrapper.get('input[data-testid="title-input"]').element as HTMLInputElement).value;
    }

    test("choosing Edit again while editing keeps the current draft", async () => {
      const store = useBookmarksStore();
      store.bookmarks = [
        makeBookmark({ id: "1", status: "ready", title: "T", content_md: "Body" }),
      ];
      const wrapper = mount(ReaderView, { props: { id: "1" } });
      await flushPromises();

      await enterEditMode(wrapper);
      await wrapper.get('input[data-testid="title-input"]').setValue("Draft title");
      await enterEditMode(wrapper);

      expect(titleValue(wrapper)).toBe("Draft title");
    });

    test("a ready bookmark without a title or body opens the editor empty", async () => {
      const store = useBookmarksStore();
      store.bookmarks = [makeBookmark({ id: "1", status: "ready", title: null, content_md: null })];
      const wrapper = mount(ReaderView, { props: { id: "1" } });
      await flushPromises();

      await enterEditMode(wrapper);

      expect(wrapper.findComponent({ name: "ArticleContent" }).props("modelValue")).toBe("");
      expect(titleValue(wrapper)).toBe("");
    });

    test("a save the server rejects keeps the editor and the draft open", async () => {
      const store = useBookmarksStore();
      store.bookmarks = [
        makeBookmark({ id: "1", status: "ready", title: "T", content_md: "Body" }),
      ];
      vi.spyOn(store, "updateContent").mockResolvedValue({ error: "Couldn't save the change." });
      const wrapper = mount(ReaderView, { props: { id: "1" } });
      await flushPromises();

      await enterEditMode(wrapper);
      await wrapper.get('input[data-testid="title-input"]').setValue("Unsaved title");
      await wrapper.get('[data-testid="save-edit-btn"]').trigger("click");
      await flushPromises();

      expect(wrapper.get('[data-testid="action-error"]').text()).toBe("Couldn't save the change.");
      expect(titleValue(wrapper)).toBe("Unsaved title");
    });
  });

  describe("translate, more", () => {
    test("falls back to English when the browser reports no language", async () => {
      const store = useBookmarksStore();
      store.bookmarks = [
        makeBookmark({ id: "1", status: "ready", url: null, type: "note", content_md: "Hola" }),
      ];
      const translate = vi
        .spyOn(store, "translateBookmark")
        .mockResolvedValue({ translatedText: "Hello", error: null });
      const language = vi.spyOn(navigator, "language", "get").mockReturnValue("");
      const wrapper = mount(ReaderView, { props: { id: "1" } });
      await flushPromises();

      await wrapper.get('[data-testid="menu-trigger"]').trigger("click");
      await wrapper.get('[data-testid="translate-item"]').trigger("click");
      await flushPromises();

      expect(translate).toHaveBeenCalledWith("1", "Hola", "EN");
      language.mockRestore();
    });

    test("the toggle switches back and forth between translation and original", async () => {
      const store = useBookmarksStore();
      store.bookmarks = [
        makeBookmark({
          id: "1",
          status: "ready",
          content_md: "Bonjour",
          translated_content_md: "Hello",
          translated_lang: "EN",
        }),
      ];
      const wrapper = mount(ReaderView, { props: { id: "1" } });
      await flushPromises();
      const body = () => wrapper.findComponent({ name: "ArticleContent" }).props("contentMd");
      const toggle = () => wrapper.get('[data-testid="translate-toggle"]');

      await toggle().trigger("click");
      expect(body()).toBe("Bonjour");
      expect(toggle().text()).toBe("Show translation");

      await toggle().trigger("click");
      expect(body()).toBe("Hello");
      expect(toggle().text()).toBe("Show original");
    });
  });

  describe("pdf, more", () => {
    function parsedPdf(overrides: Partial<Bookmark> = {}) {
      return makeBookmark({
        id: "1",
        status: "ready",
        url: null,
        type: "pdf",
        content_md: "Extracted",
        pdf_path: "user-1/a.pdf",
        pdf_parsed: true,
        ...overrides,
      });
    }

    test("a PDF saved in the original view switches back to markdown", async () => {
      const store = useBookmarksStore();
      store.bookmarks = [parsedPdf({ view_mode: "original" })];
      storageCreateSignedUrl.mockResolvedValue({
        data: { signedUrl: "https://storage.example/a" },
        error: null,
      });
      const setViewMode = vi.spyOn(store, "setViewMode").mockResolvedValue({ error: null });
      const wrapper = mount(ReaderView, { props: { id: "1" } });
      await flushPromises();

      expect(wrapper.get('[data-testid="pdf-view-bar"]').text()).toContain("Original PDF");
      await wrapper.get('[data-testid="pdf-view-toggle"]').trigger("click");

      expect(setViewMode).toHaveBeenCalledWith("1", "markdown");
    });

    test("Open original does nothing when the signed url can't be created", async () => {
      useBookmarksStore().bookmarks = [parsedPdf()];
      storageCreateSignedUrl.mockResolvedValue({ data: null, error: { message: "denied" } });
      const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
      const wrapper = mount(ReaderView, { props: { id: "1" } });
      await flushPromises();

      await wrapper.get('[data-testid="menu-trigger"]').trigger("click");
      await wrapper.get('[data-testid="open-original"]').trigger("click");
      await flushPromises();

      expect(storageCreateSignedUrl).toHaveBeenCalled();
      expect(openSpy).not.toHaveBeenCalled();
      openSpy.mockRestore();
    });

    test("ignores an open-original-PDF request for a bookmark with no stored PDF", async () => {
      useBookmarksStore().bookmarks = [
        makeBookmark({ id: "1", status: "ready", content_md: "Body" }),
      ];
      const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
      const wrapper = mount(ReaderView, { props: { id: "1" } });
      await flushPromises();

      wrapper.findComponent({ name: "ReaderHeader" }).vm.$emit("openOriginalPdf");
      await flushPromises();

      expect(storageCreateSignedUrl).not.toHaveBeenCalled();
      expect(openSpy).not.toHaveBeenCalled();
      openSpy.mockRestore();
    });
  });

  describe("reading progress, more", () => {
    function scrollArea(wrapper: ReturnType<typeof mount>, height: number, client: number) {
      const el = wrapper.get('[data-testid="scroll-area"]').element as HTMLDivElement;
      Object.defineProperty(el, "scrollHeight", { value: height, configurable: true });
      Object.defineProperty(el, "clientHeight", { value: client, configurable: true });
      return el;
    }

    test("a body that fits on screen is not scrolled", async () => {
      useBookmarksStore().bookmarks = [
        makeBookmark({ id: "1", status: "ready", progress: 0.5, content_md: "Short" }),
      ];
      const wrapper = mount(ReaderView, { props: { id: "1" } });
      await flushPromises();
      const el = scrollArea(wrapper, 200, 200);

      vi.advanceTimersByTime(100);
      await flushPromises();

      expect(el.scrollTop).toBe(0);
    });

    test("a bookmark with no saved progress starts at the top and writes nothing", async () => {
      const update = vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ error: null }) }));
      from.mockReturnValue({ update });
      useBookmarksStore().bookmarks = [
        makeBookmark({ id: "1", status: "ready", progress: null, content_md: "Text" }),
      ];
      const wrapper = mount(ReaderView, { props: { id: "1" } });
      await flushPromises();
      const el = scrollArea(wrapper, 1000, 200);

      await vi.advanceTimersByTimeAsync(2000);

      expect(el.scrollTop).toBe(0);
      expect(update).not.toHaveBeenCalled();
    });

    test("closing the reader before the restore runs leaves the detached page alone", async () => {
      useBookmarksStore().bookmarks = [
        makeBookmark({ id: "1", status: "ready", progress: 0.5, content_md: "Text" }),
      ];
      const wrapper = mount(ReaderView, { props: { id: "1" } });
      // The restore is now queued for the next animation frame.
      await flushPromises();
      const el = scrollArea(wrapper, 1000, 200);
      wrapper.unmount();

      vi.advanceTimersByTime(100);
      await flushPromises();

      expect(el.scrollTop).toBe(0);
    });

    test("a live update to the open bookmark doesn't jump back to the saved position", async () => {
      const store = useBookmarksStore();
      store.bookmarks = [
        makeBookmark({ id: "1", status: "ready", progress: 0.5, content_md: "Text" }),
      ];
      const wrapper = mount(ReaderView, { props: { id: "1" } });
      await flushPromises();
      const el = scrollArea(wrapper, 1000, 200);
      vi.advanceTimersByTime(100);
      await flushPromises();
      expect(el.scrollTop).toBe(400);

      el.scrollTop = 600;
      store.bookmarks = [{ ...store.bookmarks[0]!, title: "Renamed elsewhere" }];
      await flushPromises();
      vi.advanceTimersByTime(100);
      await flushPromises();

      expect(wrapper.get('[data-testid="title"]').text()).toBe("Renamed elsewhere");
      expect(el.scrollTop).toBe(600);
    });

    test("leaving the reader writes the pending position and stops listening", async () => {
      const eqUpdate = vi.fn().mockResolvedValue({ error: null });
      const update = vi.fn(() => ({ eq: eqUpdate }));
      from.mockReturnValue({ update });
      useBookmarksStore().bookmarks = [
        makeBookmark({ id: "1", status: "ready", progress: 0, content_md: "Text" }),
      ];
      const wrapper = mount(ReaderView, { props: { id: "1" } });
      await flushPromises();
      const el = scrollArea(wrapper, 1000, 200);
      Object.defineProperty(el, "scrollTop", { value: 200, configurable: true, writable: true });
      el.dispatchEvent(new Event("scroll"));
      await nextTick();

      wrapper.unmount();
      expect(update).toHaveBeenCalledWith({ progress: 0.25 });
      expect(eqUpdate).toHaveBeenCalledWith("id", "1");

      window.dispatchEvent(new Event("pagehide"));
      await vi.advanceTimersByTimeAsync(2000);
      expect(update).toHaveBeenCalledTimes(1);
    });
  });

  describe("reading progress across devices", () => {
    afterEach(() => vi.restoreAllMocks());

    function setVisibility(state: DocumentVisibilityState) {
      vi.spyOn(document, "visibilityState", "get").mockReturnValue(state);
      document.dispatchEvent(new Event("visibilitychange"));
    }

    function scrollArea(wrapper: ReturnType<typeof mount>) {
      const el = wrapper.get('[data-testid="scroll-area"]').element as HTMLDivElement;
      Object.defineProperty(el, "scrollHeight", { value: 1000, configurable: true });
      Object.defineProperty(el, "clientHeight", { value: 200, configurable: true });
      return el;
    }

    /** Reader open and tracking at 50% (scrollTop 400). */
    async function openAtHalf(serverRow: () => Bookmark) {
      const update = vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ error: null }) }));
      const single = vi.fn(
        async (): Promise<{ data: Bookmark | null; error: unknown }> => ({
          data: serverRow(),
          error: null,
        }),
      );
      from.mockReturnValue({ select: vi.fn(() => ({ eq: () => ({ single }) })), update });
      useBookmarksStore().bookmarks = [
        makeBookmark({ id: "1", status: "ready", progress: 0.5, content_md: "Text" }),
      ];
      const wrapper = mount(ReaderView, { props: { id: "1" } });
      await flushPromises();
      const el = scrollArea(wrapper);
      vi.advanceTimersByTime(100);
      await flushPromises();
      el.dispatchEvent(new Event("scroll"));
      expect(el.scrollTop).toBe(400);
      return { el, update, single };
    }

    test("hiding the app writes the pending position", async () => {
      const { el, update } = await openAtHalf(() => makeBookmark({}));
      el.scrollTop = 600;
      el.dispatchEvent(new Event("scroll"));
      await nextTick();

      setVisibility("hidden");

      expect(update).toHaveBeenCalledWith({ progress: 0.75 });
    });

    test("coming back moves to a position saved on another device", async () => {
      const { el } = await openAtHalf(() =>
        makeBookmark({ id: "1", status: "ready", progress: 0.25, content_md: "Text" }),
      );

      setVisibility("visible");
      await flushPromises();
      vi.advanceTimersByTime(100);
      await flushPromises();

      expect(el.scrollTop).toBe(200);
      expect(useBookmarksStore().bookmarks[0]!.progress).toBe(0.25);
    });

    test("coming back stays put when the saved position is where the reader is", async () => {
      const { el, single } = await openAtHalf(() =>
        makeBookmark({ id: "1", status: "ready", progress: 0.51, content_md: "Text" }),
      );

      setVisibility("visible");
      await flushPromises();
      vi.advanceTimersByTime(100);
      await flushPromises();

      expect(single).toHaveBeenCalled();
      expect(el.scrollTop).toBe(400);
    });

    test("reconnecting sends the position read offline instead of pulling an older one", async () => {
      const { el, single } = await openAtHalf(() =>
        makeBookmark({ id: "1", status: "ready", progress: 0.25, content_md: "Text" }),
      );
      const eq = vi.fn().mockResolvedValue({ error: { message: "Failed to fetch" } });
      const update = vi.fn(() => ({ eq }));
      from.mockReturnValue({ select: vi.fn(() => ({ eq: () => ({ single }) })), update });
      el.scrollTop = 600;
      el.dispatchEvent(new Event("scroll"));
      await vi.advanceTimersByTimeAsync(2000);
      expect(update).toHaveBeenCalledWith({ progress: 0.75 });

      // Still failing: nothing pulled, nothing moved.
      window.dispatchEvent(new Event("online"));
      await flushPromises();
      expect(single).not.toHaveBeenCalled();

      // Back for real: the unsent write lands first, so the pull agrees with it.
      eq.mockResolvedValue({ error: null });
      single.mockImplementation(async () => ({
        data: makeBookmark({ id: "1", status: "ready", progress: 0.75, content_md: "Text" }),
        error: null,
      }));
      window.dispatchEvent(new Event("online"));
      await flushPromises();
      vi.advanceTimersByTime(100);
      await flushPromises();

      expect(update).toHaveBeenLastCalledWith({ progress: 0.75 });
      expect(single).toHaveBeenCalled();
      expect(el.scrollTop).toBe(600);
    });

    test("a pending write that fails on return leaves the position alone", async () => {
      const { el, single } = await openAtHalf(() => makeBookmark({}));
      const eq = vi.fn().mockResolvedValue({ error: { message: "Failed to fetch" } });
      from.mockReturnValue({
        select: vi.fn(() => ({ eq: () => ({ single }) })),
        update: () => ({ eq }),
      });
      el.scrollTop = 600;
      el.dispatchEvent(new Event("scroll"));
      await nextTick();

      setVisibility("visible");
      await flushPromises();

      expect(eq).toHaveBeenCalled();
      expect(single).not.toHaveBeenCalled();
    });

    test("scrolling while the saved position loads keeps the reader where it is", async () => {
      const { el, single } = await openAtHalf(() => makeBookmark({}));
      const row = deferredRow();
      single.mockImplementation(() => row.promise);

      setVisibility("visible");
      await flushPromises();
      el.scrollTop = 800;
      el.dispatchEvent(new Event("scroll"));
      row.resolve(makeBookmark({ id: "1", status: "ready", progress: 0.1, content_md: "Text" }));
      await flushPromises();
      vi.advanceTimersByTime(100);
      await flushPromises();

      expect(el.scrollTop).toBe(800);
    });

    test("a saved position cleared elsewhere goes back to the top", async () => {
      const { el } = await openAtHalf(() =>
        makeBookmark({ id: "1", status: "ready", progress: null, content_md: "Text" }),
      );

      setVisibility("visible");
      await flushPromises();
      vi.advanceTimersByTime(100);
      await flushPromises();

      expect(el.scrollTop).toBe(0);
    });

    test("a bookmark gone by the time it loads leaves the position alone", async () => {
      const { el, single } = await openAtHalf(() => makeBookmark({}));
      const row = deferredRow();
      single.mockImplementation(() => row.promise);

      setVisibility("visible");
      await flushPromises();
      useBookmarksStore().bookmarks = [];
      row.resolve(null);
      await flushPromises();
      vi.advanceTimersByTime(100);
      await flushPromises();

      expect(el.scrollTop).toBe(400);
    });

    /** A `.single()` response held until the test resolves it (null: not found). */
    function deferredRow() {
      let resolve!: (row: Bookmark | null) => void;
      const promise = new Promise<{ data: Bookmark | null; error: unknown }>((res) => {
        resolve = (row) =>
          res(row ? { data: row, error: null } : { data: null, error: { code: "PGRST116" } });
      });
      return { promise, resolve };
    }

    test("offline, coming back doesn't try the server", async () => {
      const { single } = await openAtHalf(() => makeBookmark({}));
      vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);

      setVisibility("visible");
      await flushPromises();

      expect(single).not.toHaveBeenCalled();
    });

    test("before the position is restored, coming back does nothing", async () => {
      const single = vi.fn(() => new Promise(() => {}));
      from.mockReturnValue({ select: vi.fn(() => ({ eq: () => ({ single }) })) });
      const listRow = makeBookmark({ id: "1", status: "ready", progress: 0.5 });
      delete (listRow as unknown as Record<string, unknown>).content_md;
      useBookmarksStore().bookmarks = [listRow];
      mount(ReaderView, { props: { id: "1" } });
      await flushPromises();

      setVisibility("visible");
      await flushPromises();

      expect(single).toHaveBeenCalledTimes(1);
    });
  });
});
