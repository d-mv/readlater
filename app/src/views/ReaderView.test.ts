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

    expect(update).toHaveBeenCalledWith({ status: "pending", error_message: null });
    expect(wrapper.text()).toContain("Processing…");
  });
});
