import { beforeEach, describe, expect, test, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { flushPromises, mount } from "@vue/test-utils";
import PublicReaderView from "./PublicReaderView.vue";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("../lib/supabase", () => ({ supabase: { rpc } }));

describe("PublicReaderView", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  test("renders the bookmark when the RPC returns a public row", async () => {
    rpc.mockResolvedValue({
      data: [
        {
          id: "abc",
          title: "A public note",
          author: null,
          reading_time: null,
          content_md: "hello",
        },
      ],
      error: null,
    });

    const wrapper = mount(PublicReaderView, { props: { id: "abc" } });
    await flushPromises();

    expect(rpc).toHaveBeenCalledWith("get_public_bookmark", { bookmark_id: "abc" });
    expect(wrapper.text()).toContain("A public note");
    expect(wrapper.find(".status-placeholder").exists()).toBe(false);
  });

  test("renders a youtube embed with thumbnail when the public row is a video", async () => {
    rpc.mockResolvedValue({
      data: [
        {
          id: "yt-1",
          title: "A public video",
          author: "Creator",
          reading_time: null,
          content_md: "# A public video\n\n![thumbnail](https://thumb.example/1.jpg)",
          type: "youtube",
          youtube_video_id: "vid123",
          thumbnail_url: "https://thumb.example/1.jpg",
        },
      ],
      error: null,
    });

    const wrapper = mount(PublicReaderView, { props: { id: "yt-1" } });
    await flushPromises();

    expect(wrapper.text()).toContain("A public video");
    expect(wrapper.find("button.youtube-play").exists()).toBe(true);
  });

  test("renders correctly from only the public-safe column projection", async () => {
    rpc.mockResolvedValue({
      data: [
        {
          id: "abc",
          type: "article",
          title: "Trimmed row",
          author: "Jane",
          excerpt: null,
          content_md: "body",
          thumbnail_url: null,
          youtube_video_id: null,
          word_count: 400,
          reading_time: 2,
          created_at: "2026-01-01T00:00:00Z",
        },
      ],
      error: null,
    });

    const wrapper = mount(PublicReaderView, { props: { id: "abc" } });
    await flushPromises();

    expect(wrapper.text()).toContain("Trimmed row");
    expect(wrapper.text()).toContain("By Jane");
    expect(wrapper.text()).toContain("2 min read");
  });

  test("shows a not-found state when the RPC returns no rows", async () => {
    rpc.mockResolvedValue({ data: [], error: null });

    const wrapper = mount(PublicReaderView, { props: { id: "missing" } });
    await flushPromises();

    expect(wrapper.text()).toContain("Not found");
  });

  test("shows the same not-found state on an RPC error, without distinguishing why", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "denied" } });

    const wrapper = mount(PublicReaderView, { props: { id: "abc" } });
    await flushPromises();

    expect(wrapper.text()).toContain("Not found");
  });
});
