import "fake-indexeddb/auto";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { flushPromises, mount } from "@vue/test-utils";

const pushMock = vi.fn();
vi.mock("vue-router", () => ({ useRouter: () => ({ push: pushMock }) }));

vi.mock("../lib/supabase", () => ({
  supabase: {
    from: () => ({ select: () => ({ order: () => Promise.resolve({ data: [], error: null }) }) }),
  },
}));

const { default: ReadingListView } = await import("./ReadingListView.vue");

describe("ReadingListView", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  test("renders reading list view header and search bar", async () => {
    const wrapper = mount(ReadingListView);
    await flushPromises();
    expect(wrapper.text()).toContain("Read Later");
    expect(wrapper.find("input.search-input").exists()).toBe(true);
  });

  test("saves scroll position on window scroll and restores it on remount", async () => {
    const scrollToSpy = vi.spyOn(window, "scrollTo").mockImplementation(() => {});

    const wrapper1 = mount(ReadingListView);
    await flushPromises();

    vi.spyOn(window, "scrollY", "get").mockReturnValue(350);
    window.dispatchEvent(new Event("scroll"));

    wrapper1.unmount();

    mount(ReadingListView);
    await flushPromises();

    expect(scrollToSpy).toHaveBeenCalledWith(0, 350);
  });

  test("resets scroll position to 0 on search input", async () => {
    const scrollToSpy = vi.spyOn(window, "scrollTo").mockImplementation(() => {});

    const wrapper = mount(ReadingListView);
    await flushPromises();

    vi.spyOn(window, "scrollY", "get").mockReturnValue(350);
    window.dispatchEvent(new Event("scroll"));

    const searchInput = wrapper.get("input.search-input");
    await searchInput.setValue("test");

    expect(scrollToSpy).toHaveBeenCalledWith(0, 0);
  });
});
