import "fake-indexeddb/auto";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { flushPromises, mount } from "@vue/test-utils";
import { useBookmarksStore } from "../stores/bookmarks";

const pushMock = vi.fn();
vi.mock("vue-router", () => ({ useRouter: () => ({ push: pushMock }) }));

const realtimeChannel = { on: () => realtimeChannel, subscribe: () => realtimeChannel };
vi.mock("../lib/supabase", () => ({
  supabase: {
    from: () => ({ select: () => ({ order: () => Promise.resolve({ data: [], error: null }) }) }),
    channel: () => realtimeChannel,
    removeChannel: () => {},
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

  test("typing does not run a search; submitting does", async () => {
    const wrapper = mount(ReadingListView);
    await flushPromises();
    const store = useBookmarksStore();
    const fetchSpy = vi.spyOn(store, "fetch").mockResolvedValue(undefined);

    await wrapper.get("input.search-input").setValue("readability");
    expect(fetchSpy).not.toHaveBeenCalled();

    await wrapper.get("form.search-form").trigger("submit");
    expect(store.searchQuery).toBe("readability");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  test("clearing the search box immediately reloads the full list", async () => {
    const wrapper = mount(ReadingListView);
    await flushPromises();
    const store = useBookmarksStore();
    const fetchSpy = vi.spyOn(store, "fetch").mockResolvedValue(undefined);

    await wrapper.get("input.search-input").setValue("readability");
    await wrapper.get("form.search-form").trigger("submit");
    fetchSpy.mockClear();

    await wrapper.get("input.search-input").setValue("");
    expect(store.searchQuery).toBe("");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  test("toggling a tag filters client-side without a query", async () => {
    const wrapper = mount(ReadingListView);
    await flushPromises();
    const store = useBookmarksStore();
    const fetchSpy = vi.spyOn(store, "fetch").mockResolvedValue(undefined);
    store.setActiveTagIds([]);

    // Drive the TagFilterBar toggle handler.
    wrapper.findComponent({ name: "TagFilterBar" }).vm.$emit("toggle", "tag-1");
    await flushPromises();

    expect(store.activeTagIds).toEqual(["tag-1"]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
