import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { flushPromises, mount } from "@vue/test-utils";
import type { Bookmark } from "../lib/supabase";

const { from } = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock("../lib/supabase", () => ({ supabase: { from } }));

vi.mock("vue-router", () => ({ useRouter: () => ({ push: vi.fn() }) }));

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
    thumbnail_url: null,
    youtube_video_id: null,
    content_edited: false,
    error_message: "Readability could not extract article content",
    word_count: null,
    reading_time: null,
    created_at: "2026-01-01T00:00:00Z",
    processed_at: null,
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

    expect(update).toHaveBeenCalledWith({ status: "pending", error_message: null, content_edited: false });
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
      await wrapper.findComponent({ name: "ArticleContent" }).vm.$emit("update:modelValue", "one two three four");

      await wrapper.find(".save-edit-btn").trigger("click");
      await flushPromises();

      expect(update).toHaveBeenCalledWith({
        title: "Edited title",
        content_md: "one two three four",
        word_count: 4,
        reading_time: 1,
        content_edited: true,
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
});
