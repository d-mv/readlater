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
