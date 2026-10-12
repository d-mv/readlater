import "fake-indexeddb/auto";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { flushPromises, mount } from "@vue/test-utils";
import { useBookmarksStore } from "../stores/bookmarks";

const pushMock = vi.fn();
vi.mock("vue-router", () => ({ useRouter: () => ({ push: pushMock }) }));

const realtimeChannel = { on: () => realtimeChannel, subscribe: () => realtimeChannel };
const listQuery = () => {
  const q: Record<string, unknown> = {};
  // Chainable and awaitable, like a PostgREST builder: the list query chains
  // .order().order() (keyset on created_at, id) before it's awaited.
  for (const m of ["select", "textSearch", "lt", "or", "gte", "limit", "order"]) q[m] = () => q;
  q.then = (resolve: (v: unknown) => unknown) => resolve({ data: [], error: null });
  return q;
};
vi.mock("../lib/supabase", () => ({
  supabase: {
    from: () => listQuery(),
    channel: () => realtimeChannel,
    removeChannel: () => {},
  },
}));

class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = [];
  callback: IntersectionObserverCallback;
  constructor(cb: IntersectionObserverCallback) {
    this.callback = cb;
    FakeIntersectionObserver.instances.push(this);
  }
  observe() {}
  unobserve() {}
  disconnect() {}
  trigger(isIntersecting: boolean) {
    this.callback(
      [{ isIntersecting } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    );
  }
}

const { default: ReadingListView } = await import("./ReadingListView.vue");

// The mount-time fetch falls back to the IndexedDB snapshot (no session in
// tests), which can resolve after a single flush and reset hasMore — wait it
// out before arranging list state.
async function mountSettled() {
  const wrapper = mount(ReadingListView);
  const store = useBookmarksStore();
  await vi.waitFor(() => expect(store.loading).toBe(false));
  await flushPromises();
  return { wrapper, store };
}

describe("ReadingListView", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    FakeIntersectionObserver.instances = [];
    vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);
  });

  test("renders reading list view header and search bar", async () => {
    const wrapper = mount(ReadingListView);
    await flushPromises();
    expect(wrapper.text()).toContain("Read Later");
    expect(wrapper.get('input[data-testid="search-input"]').attributes("aria-label")).toBe(
      "Search bookmarks",
    );
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

    const searchInput = wrapper.get('input[data-testid="search-input"]');
    await searchInput.setValue("test");

    expect(scrollToSpy).toHaveBeenCalledWith(0, 0);
  });

  test("typing does not run a search; submitting does", async () => {
    const wrapper = mount(ReadingListView);
    await flushPromises();
    const store = useBookmarksStore();
    const fetchSpy = vi.spyOn(store, "fetch").mockResolvedValue(undefined);

    await wrapper.get('input[data-testid="search-input"]').setValue("readability");
    expect(fetchSpy).not.toHaveBeenCalled();

    await wrapper.get('form[data-testid="search-form"]').trigger("submit");
    expect(store.searchQuery).toBe("readability");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  test("clearing the search box immediately reloads the full list", async () => {
    const wrapper = mount(ReadingListView);
    await flushPromises();
    const store = useBookmarksStore();
    const fetchSpy = vi.spyOn(store, "fetch").mockResolvedValue(undefined);

    await wrapper.get('input[data-testid="search-input"]').setValue("readability");
    await wrapper.get('form[data-testid="search-form"]').trigger("submit");
    fetchSpy.mockClear();

    await wrapper.get('input[data-testid="search-input"]').setValue("");
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

  test("the load-more sentinel calls store.loadMore when it scrolls into view", async () => {
    const { store } = await mountSettled();
    const loadMoreSpy = vi.spyOn(store, "loadMore").mockResolvedValue(undefined);

    // Simulate an unfiltered list with a full first page and more to come.
    store.bookmarks = [{ id: "1", archived: false, tags: [] } as never];
    store.hasMore = true;
    await flushPromises();

    FakeIntersectionObserver.instances.at(-1)?.trigger(true);

    expect(loadMoreSpy).toHaveBeenCalled();
  });

  test("an out-of-view sentinel does not call loadMore", async () => {
    mount(ReadingListView);
    await flushPromises();
    const store = useBookmarksStore();
    const loadMoreSpy = vi.spyOn(store, "loadMore").mockResolvedValue(undefined);
    store.bookmarks = [{ id: "1", archived: false, tags: [] } as never];
    store.hasMore = true;
    await flushPromises();

    FakeIntersectionObserver.instances.at(-1)?.trigger(false);

    expect(loadMoreSpy).not.toHaveBeenCalled();
  });

  test("keeps paging while the sentinel stays in range (a sparse tab adds no visible rows)", async () => {
    const { store } = await mountSettled();
    store.bookmarks = [{ id: "1", archived: false, tags: [] } as never];
    store.hasMore = true;
    await flushPromises();

    // Each page brings only archived rows, invisible on this tab; the third
    // page is the last.
    let calls = 0;
    const loadMoreSpy = vi.spyOn(store, "loadMore").mockImplementation(async () => {
      calls += 1;
      store.bookmarks = [
        ...store.bookmarks,
        { id: `archived-${calls}`, archived: true, tags: [] } as never,
      ];
      store.hasMore = calls < 3;
    });

    FakeIntersectionObserver.instances.at(-1)?.trigger(true);
    await flushPromises();

    expect(loadMoreSpy).toHaveBeenCalledTimes(3);
  });

  test("stops paging when a page brings nothing (failed request), instead of spinning", async () => {
    const { store } = await mountSettled();
    store.bookmarks = [{ id: "1", archived: false, tags: [] } as never];
    store.hasMore = true;
    await flushPromises();
    const loadMoreSpy = vi.spyOn(store, "loadMore").mockResolvedValue(undefined);

    FakeIntersectionObserver.instances.at(-1)?.trigger(true);
    await flushPromises();

    expect(loadMoreSpy).toHaveBeenCalledTimes(1);
  });

  test("offers a Load more button whenever older pages exist, even on an empty tab", async () => {
    const { wrapper, store } = await mountSettled();
    // Only archived rows loaded so far: nothing visible on the default tab.
    store.bookmarks = [{ id: "1", archived: true, tags: [] } as never];
    store.hasMore = true;
    await flushPromises();
    const loadMoreSpy = vi.spyOn(store, "loadMore").mockResolvedValue(undefined);

    await wrapper.get('[data-testid="load-more"]').trigger("click");

    expect(loadMoreSpy).toHaveBeenCalled();
  });

  test("no Load more button once the list is exhausted", async () => {
    const { wrapper, store } = await mountSettled();
    store.bookmarks = [{ id: "1", archived: false, tags: [] } as never];
    store.hasMore = false;
    await flushPromises();
    expect(wrapper.find('[data-testid="load-more"]').exists()).toBe(false);
  });

  describe("refetch on return to the app", () => {
    function setVisibility(state: DocumentVisibilityState) {
      vi.spyOn(document, "visibilityState", "get").mockReturnValue(state);
      document.dispatchEvent(new Event("visibilitychange"));
    }

    test("refetches when the app becomes visible again, at most once per 30s", async () => {
      const now = vi.spyOn(Date, "now").mockReturnValue(1_000_000);
      const wrapper = mount(ReadingListView);
      await flushPromises();
      const store = useBookmarksStore();
      const fetchSpy = vi.spyOn(store, "fetch").mockResolvedValue(undefined);

      // Right after mount the list is fresh.
      setVisibility("visible");
      expect(fetchSpy).not.toHaveBeenCalled();

      now.mockReturnValue(1_000_000 + 31_000);
      setVisibility("visible");
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      now.mockReturnValue(1_000_000 + 40_000);
      setVisibility("visible");
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      wrapper.unmount();
      now.mockRestore();
    });

    test("going to the background does not refetch, and listeners go away on unmount", async () => {
      const now = vi.spyOn(Date, "now").mockReturnValue(2_000_000);
      const wrapper = mount(ReadingListView);
      await flushPromises();
      const store = useBookmarksStore();
      const fetchSpy = vi.spyOn(store, "fetch").mockResolvedValue(undefined);
      now.mockReturnValue(2_000_000 + 60_000);

      setVisibility("hidden");
      expect(fetchSpy).not.toHaveBeenCalled();

      wrapper.unmount();
      setVisibility("visible");
      expect(fetchSpy).not.toHaveBeenCalled();
      now.mockRestore();
    });
  });

  test("toggling offline on a bookmark without body fetches the body and caches it", async () => {
    const { useOfflineCacheStore } = await import("../stores/offlineCache");
    const { wrapper, store } = await mountSettled();
    const offlineCache = useOfflineCacheStore();

    const listRow = {
      id: "bm-1",
      title: "Test",
      status: "ready",
      archived: false,
      read_at: null,
      tags: [],
    } as any;
    store.bookmarks = [listRow];
    await flushPromises();

    const fullRow = { ...listRow, content_md: "Full article body" };
    const fetchOneSpy = vi.spyOn(store, "fetchOne").mockResolvedValue(fullRow);
    const cacheSpy = vi.spyOn(offlineCache, "cacheBookmark").mockResolvedValue(undefined);

    wrapper.findComponent({ name: "BookmarkList" }).vm.$emit("toggleOffline", "bm-1");
    await flushPromises();

    expect(fetchOneSpy).toHaveBeenCalledWith("bm-1");
    expect(cacheSpy).toHaveBeenCalledWith(fullRow);
  });

  test("coming back online refetches the list and resubscribes to live changes", async () => {
    const { wrapper, store } = await mountSettled();
    const fetchSpy = vi.spyOn(store, "fetch").mockResolvedValue(undefined);
    const subscribeSpy = vi.spyOn(store, "subscribeToChanges").mockImplementation(() => {});

    window.dispatchEvent(new Event("online"));

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(subscribeSpy).toHaveBeenCalledTimes(1);

    wrapper.unmount();
    window.dispatchEvent(new Event("online"));
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  test("a second intersection while a page is loading doesn't start another page", async () => {
    const { store } = await mountSettled();
    store.bookmarks = [{ id: "1", archived: false, tags: [] } as never];
    store.hasMore = true;
    await flushPromises();
    let finish!: () => void;
    const loadMoreSpy = vi
      .spyOn(store, "loadMore")
      .mockImplementation(() => new Promise<void>((resolve) => (finish = resolve)));

    const observer = FakeIntersectionObserver.instances.at(-1)!;
    observer.trigger(true);
    observer.trigger(true);
    expect(loadMoreSpy).toHaveBeenCalledTimes(1);

    finish();
    await flushPromises();
  });

  test("observes a sentinel that is already rendered when the view mounts", async () => {
    const store = useBookmarksStore();
    store.hasMore = true;
    vi.spyOn(store, "fetch").mockResolvedValue(undefined);
    const observeSpy = vi.spyOn(FakeIntersectionObserver.prototype, "observe");

    const wrapper = mount(ReadingListView);
    await flushPromises();

    expect(observeSpy).toHaveBeenCalledWith(
      wrapper.get('[data-testid="load-more"]').element.parentElement,
    );
    observeSpy.mockRestore();
  });

  test("without IntersectionObserver, older pages load through the Load more button", async () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    const { wrapper, store } = await mountSettled();
    const loadMoreSpy = vi.spyOn(store, "loadMore").mockResolvedValue(undefined);
    store.bookmarks = [{ id: "1", archived: false, tags: [] } as never];
    store.hasMore = true;
    await flushPromises();

    await wrapper.get('[data-testid="load-more"]').trigger("click");

    expect(loadMoreSpy).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  test("shows a loading note instead of the button while a page is in flight", async () => {
    const { wrapper, store } = await mountSettled();
    store.hasMore = true;
    store.loadingMore = true;
    await flushPromises();

    expect(wrapper.text()).toContain("Loading more…");
    expect(wrapper.find('[data-testid="load-more"]').exists()).toBe(false);
  });

  test("opening a bookmark routes to the reader", async () => {
    const { wrapper } = await mountSettled();

    wrapper.findComponent({ name: "BookmarkList" }).vm.$emit("open", "bm-7");

    expect(pushMock).toHaveBeenCalledWith({ name: "reader", params: { id: "bm-7" } });
  });

  test("the settings button routes to settings", async () => {
    const { wrapper } = await mountSettled();

    await wrapper.get('button[aria-label="Settings"]').trigger("click");

    expect(pushMock).toHaveBeenCalledWith({ name: "settings" });
  });

  test("switching tabs applies the filter and scrolls back to the top", async () => {
    const scrollToSpy = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    const { wrapper, store } = await mountSettled();

    wrapper.findComponent({ name: "StatusTabs" }).vm.$emit("change", "archived");

    expect(store.filter).toBe("archived");
    expect(scrollToSpy).toHaveBeenCalledWith(0, 0);
  });

  test("toggling an active tag removes it from the filter", async () => {
    const { wrapper, store } = await mountSettled();
    store.setActiveTagIds(["tag-1", "tag-2"]);

    wrapper.findComponent({ name: "TagFilterBar" }).vm.$emit("toggle", "tag-1");

    expect(store.activeTagIds).toEqual(["tag-2"]);
  });

  describe("toggling offline", () => {
    async function setup() {
      const { useOfflineCacheStore } = await import("../stores/offlineCache");
      const { wrapper, store } = await mountSettled();
      const offlineCache = useOfflineCacheStore();
      const listRow = { id: "bm-1", title: "Test", archived: false, tags: [] } as never;
      store.bookmarks = [listRow];
      const cacheSpy = vi.spyOn(offlineCache, "cacheBookmark").mockResolvedValue(undefined);
      const removeSpy = vi.spyOn(offlineCache, "removeCachedBookmark").mockResolvedValue(undefined);
      const toggle = async (id: string) => {
        wrapper.findComponent({ name: "BookmarkList" }).vm.$emit("toggleOffline", id);
        await flushPromises();
      };
      return { store, offlineCache, listRow, cacheSpy, removeSpy, toggle };
    }

    test("removes the offline copy of a bookmark that is already cached", async () => {
      const { offlineCache, cacheSpy, removeSpy, toggle } = await setup();
      vi.spyOn(offlineCache, "isCached").mockReturnValue(true);

      await toggle("bm-1");

      expect(removeSpy).toHaveBeenCalledWith("bm-1");
      expect(cacheSpy).not.toHaveBeenCalled();
    });

    test("caches the list row as-is when the full row can't be fetched", async () => {
      const { store, listRow, cacheSpy, toggle } = await setup();
      vi.spyOn(store, "fetchOne").mockResolvedValue(null);

      await toggle("bm-1");

      expect(cacheSpy).toHaveBeenCalledWith(listRow);
    });

    test("caches a row that already carries its body without refetching it", async () => {
      const { store, cacheSpy, toggle } = await setup();
      const fullRow = { id: "bm-1", archived: false, tags: [], content_md: "Body" } as never;
      store.bookmarks = [fullRow];
      const fetchOneSpy = vi.spyOn(store, "fetchOne");

      await toggle("bm-1");

      expect(fetchOneSpy).not.toHaveBeenCalled();
      expect(cacheSpy).toHaveBeenCalledWith(fullRow);
    });

    test("ignores an id that is no longer in the list", async () => {
      const { store, cacheSpy, removeSpy, toggle } = await setup();
      const fetchOneSpy = vi.spyOn(store, "fetchOne");

      await toggle("gone");

      expect(fetchOneSpy).not.toHaveBeenCalled();
      expect(cacheSpy).not.toHaveBeenCalled();
      expect(removeSpy).not.toHaveBeenCalled();
    });
  });
});
