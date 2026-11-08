import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
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

// A list left mounted keeps its document keydown listener, which would
// answer (and claim) the shortcut keys later tests press.
enableAutoUnmount(afterEach);

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

  test("losing the connection refetches the list (the offline snapshot)", async () => {
    const { wrapper, store } = await mountSettled();
    const fetchSpy = vi.spyOn(store, "fetch").mockResolvedValue(undefined);

    window.dispatchEvent(new Event("offline"));
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    wrapper.unmount();
    window.dispatchEvent(new Event("offline"));
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

  test("the sort toggle switches the order and scrolls back to the top", async () => {
    const scrollToSpy = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    const { wrapper, store } = await mountSettled();
    const setSort = vi.spyOn(store, "setSort").mockResolvedValue(undefined);

    await wrapper.get('[data-testid="sort-toggle"]').trigger("click");

    expect(setSort).toHaveBeenCalledWith("oldest");
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

  describe("keyboard shortcuts", () => {
    const row = (id: string) =>
      ({
        id,
        title: `Row ${id}`,
        type: "article",
        status: "ready",
        archived: false,
        read_at: null,
        tags: [],
        url: null,
      }) as never;

    async function mountWithRows() {
      const wrapper = mount(ReadingListView, { attachTo: document.body });
      const store = useBookmarksStore();
      await vi.waitFor(() => expect(store.loading).toBe(false));
      await flushPromises();
      store.bookmarks = [row("1"), row("2"), row("3")];
      await flushPromises();
      return { wrapper, store };
    }

    function press(key: string, target: EventTarget = document.body) {
      target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
    }

    const focusedTitle = () =>
      document.activeElement?.closest('[data-testid="row"]')?.querySelector('[data-testid="title"]')
        ?.textContent;

    test("j/k and the arrows move focus through the rows, stopping at either end", async () => {
      await mountWithRows();

      press("j");
      expect(focusedTitle()).toBe("Row 1");
      press("j");
      press("ArrowDown");
      expect(focusedTitle()).toBe("Row 3");
      press("j");
      expect(focusedTitle()).toBe("Row 3");
      press("k");
      expect(focusedTitle()).toBe("Row 2");
      press("ArrowUp");
      press("ArrowUp");
      expect(focusedTitle()).toBe("Row 1");
    });

    test("k with nothing focused starts at the first row", async () => {
      await mountWithRows();

      press("k");

      expect(focusedTitle()).toBe("Row 1");
    });

    test("moving from a row's offline toggle goes to the next row", async () => {
      const { wrapper } = await mountWithRows();
      (wrapper.findAll('[data-testid="offline-toggle"]')[0]!.element as HTMLElement).focus();

      press("j");

      expect(focusedTitle()).toBe("Row 2");
    });

    test("o opens the focused row, and does nothing with no row focused", async () => {
      await mountWithRows();

      press("o");
      expect(pushMock).not.toHaveBeenCalled();

      press("j");
      press("j");
      press("o");
      expect(pushMock).toHaveBeenCalledWith({ name: "reader", params: { id: "2" } });
    });

    test("with no rows, j does nothing", async () => {
      mount(ReadingListView, { attachTo: document.body });
      await flushPromises();

      press("j");

      expect(document.activeElement).toBe(document.body);
    });

    test("/ focuses search, and keys typed there stay text", async () => {
      const { wrapper } = await mountWithRows();

      press("/");
      const search = wrapper.get('input[data-testid="search-input"]').element;
      expect(document.activeElement).toBe(search);

      press("j", search);
      expect(document.activeElement).toBe(search);
    });

    test("a opens the Add dialog", async () => {
      const { wrapper } = await mountWithRows();

      press("a");
      await flushPromises();

      expect(wrapper.find("dialog").exists()).toBe(true);
    });

    test("? shows the shortcuts, and they close again", async () => {
      const { wrapper } = await mountWithRows();

      press("?");
      await flushPromises();
      const help = wrapper.find('[data-testid="shortcuts-help"]');
      expect(help.exists()).toBe(true);
      expect(help.text()).toContain("Next item");

      // Open dialog: the page's shortcuts are off.
      press("j");
      expect(focusedTitle()).toBeUndefined();

      await help.get('[data-testid="close-btn"]').trigger("click");
      expect(wrapper.find('[data-testid="shortcuts-help"]').exists()).toBe(false);
    });
  });

  describe("selection and bulk actions", () => {
    const row = (id: string, extra: Record<string, unknown> = {}) =>
      ({
        id,
        title: `Row ${id}`,
        type: "article",
        status: "ready",
        archived: false,
        read_at: null,
        tags: [],
        url: null,
        content_md: `body ${id}`,
        ...extra,
      }) as never;

    async function setup(rows = [row("1"), row("2"), row("3")]) {
      const { useUndoStore } = await import("../stores/undo");
      const { useOfflineCacheStore } = await import("../stores/offlineCache");
      const wrapper = mount(ReadingListView, { attachTo: document.body });
      const store = useBookmarksStore();
      await vi.waitFor(() => expect(store.loading).toBe(false));
      await flushPromises();
      store.bookmarks = rows;
      await flushPromises();
      return { wrapper, store, undo: useUndoStore(), offlineCache: useOfflineCacheStore() };
    }

    const bar = (wrapper: ReturnType<typeof mount>) =>
      wrapper.find('[data-testid="selection-bar"]');
    const rowButtons = (wrapper: ReturnType<typeof mount>) =>
      wrapper.findAll('[data-testid="row-open"]');
    const selectToggle = (wrapper: ReturnType<typeof mount>) =>
      wrapper.get('[data-testid="select-toggle"]');

    async function select(wrapper: ReturnType<typeof mount>, ...indexes: number[]) {
      if (!bar(wrapper).exists()) await selectToggle(wrapper).trigger("click");
      for (const i of indexes) await rowButtons(wrapper)[i]!.trigger("click");
    }

    async function click(wrapper: ReturnType<typeof mount>, testId: string) {
      await wrapper.get(`[data-testid="${testId}"]`).trigger("click");
      await flushPromises();
    }

    function press(key: string) {
      document.body.dispatchEvent(
        new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
      );
    }

    test("Select turns rows into toggles; a tap selects instead of opening", async () => {
      const { wrapper } = await setup();

      await select(wrapper, 0, 2);

      expect(pushMock).not.toHaveBeenCalled();
      expect(selectToggle(wrapper).attributes("aria-pressed")).toBe("true");
      expect(wrapper.get('[data-testid="selection-count"]').text()).toBe("2 selected");
      expect(rowButtons(wrapper).map((b) => b.attributes("aria-pressed"))).toEqual([
        "true",
        "false",
        "true",
      ]);
    });

    test("select all picks every listed row; Cancel leaves and focus returns to Select", async () => {
      const { wrapper } = await setup();
      await select(wrapper);

      await click(wrapper, "select-all");
      expect(wrapper.get('[data-testid="selection-count"]').text()).toBe("3 selected");
      (wrapper.get('[data-testid="selection-cancel"]').element as HTMLElement).focus();
      await click(wrapper, "selection-cancel");

      expect(bar(wrapper).exists()).toBe(false);
      expect(rowButtons(wrapper)[0]!.attributes("aria-pressed")).toBeUndefined();
      expect(document.activeElement).toBe(selectToggle(wrapper).element);
    });

    test("pressing Select again leaves selection mode", async () => {
      const { wrapper } = await setup();
      await select(wrapper, 1);

      await selectToggle(wrapper).trigger("click");
      await flushPromises();

      expect(bar(wrapper).exists()).toBe(false);
    });

    test("Select is off with nothing listed", async () => {
      const { wrapper } = await setup([]);

      expect(selectToggle(wrapper).attributes("disabled")).toBeDefined();
    });

    test("archive sends the selected ids through the undo store, then selection ends", async () => {
      const { wrapper, undo } = await setup();
      const archive = vi.spyOn(undo, "archive").mockResolvedValue({ error: null });
      await select(wrapper, 0, 2);

      await click(wrapper, "bulk-archive");

      expect(archive).toHaveBeenCalledWith("1", "3");
      expect(bar(wrapper).exists()).toBe(false);
    });

    test("a refused archive keeps the selection for a retry and says why", async () => {
      const { wrapper, undo } = await setup();
      vi.spyOn(undo, "archive").mockResolvedValue({ error: "Couldn't save the change." });
      await select(wrapper, 0);

      await click(wrapper, "bulk-archive");

      expect(bar(wrapper).exists()).toBe(true);
      expect(undo.notice).toEqual({ kind: "failed", message: "Couldn't save the change." });
      undo.reset();
    });

    test("on the Archived tab the bar unarchives", async () => {
      const { wrapper, store, undo } = await setup([
        row("1", { archived: true }),
        row("2", { archived: true }),
      ]);
      store.setFilter("archived");
      await flushPromises();
      const unarchive = vi.spyOn(undo, "unarchive").mockResolvedValue({ error: null });
      await select(wrapper, 0, 1);

      await click(wrapper, "bulk-unarchive");

      expect(unarchive).toHaveBeenCalledWith("1", "2");
      expect(bar(wrapper).exists()).toBe(false);
    });

    test("mark read marks the selected unread rows", async () => {
      const { wrapper, store } = await setup([
        row("1"),
        row("2", { read_at: "2026-11-01T00:00:00Z" }),
      ]);
      const markRead = vi.spyOn(store, "markRead").mockResolvedValue({ error: null });
      await select(wrapper, 0, 1);

      await click(wrapper, "bulk-mark-read");

      expect(markRead).toHaveBeenCalledWith("1");
      expect(bar(wrapper).exists()).toBe(false);
    });

    test("delete stages the selected rows through the undo store", async () => {
      const { wrapper, undo } = await setup();
      const remove = vi.spyOn(undo, "remove").mockImplementation(() => {});
      await select(wrapper, 1, 2);

      await click(wrapper, "bulk-delete");

      expect(remove).toHaveBeenCalledWith("2", "3");
      expect(bar(wrapper).exists()).toBe(false);
    });

    test("save offline downloads the eligible rows once selection has ended", async () => {
      const { wrapper, offlineCache } = await setup([
        row("1"),
        row("2", { read_at: "2026-11-01T00:00:00Z" }),
      ]);
      const cache = vi.spyOn(offlineCache, "cacheBookmark").mockResolvedValue(undefined);
      await select(wrapper, 0, 1);
      expect(wrapper.get('[data-testid="bulk-save-offline"]').attributes("disabled")).toBe(
        undefined,
      );

      await click(wrapper, "bulk-save-offline");

      expect(bar(wrapper).exists()).toBe(false);
      expect(cache.mock.calls.map(([b]) => b.id)).toEqual(["1"]);
    });

    test("the offline snapshot turns the actions off", async () => {
      const { wrapper, store } = await setup();
      store.offlineSnapshot = true;
      await select(wrapper, 0);

      expect(wrapper.find('[data-testid="selection-offline"]').exists()).toBe(true);
      expect(wrapper.get('[data-testid="bulk-archive"]').attributes("disabled")).toBeDefined();
    });

    test.each([
      [
        "a tab switch",
        (w: ReturnType<typeof mount>) =>
          w.findComponent({ name: "StatusTabs" }).vm.$emit("change", "archived"),
      ],
      [
        "a tag toggle",
        (w: ReturnType<typeof mount>) =>
          w.findComponent({ name: "TagFilterBar" }).vm.$emit("toggle", "tag-1"),
      ],
      [
        "a search",
        (w: ReturnType<typeof mount>) => w.get('[data-testid="search-form"]').trigger("submit"),
      ],
    ])("%s ends selection", async (_name, act) => {
      const { wrapper, store } = await setup();
      vi.spyOn(store, "fetch").mockResolvedValue(undefined);
      await select(wrapper, 0);

      await act(wrapper);
      await flushPromises();

      expect(bar(wrapper).exists()).toBe(false);
    });

    test("clearing the search ends selection", async () => {
      const { wrapper, store } = await setup();
      vi.spyOn(store, "fetch").mockResolvedValue(undefined);
      const search = wrapper.get('input[data-testid="search-input"]');
      await search.setValue("x");
      await wrapper.get('[data-testid="search-form"]').trigger("submit");
      await select(wrapper, 0);

      await search.setValue("");
      await flushPromises();

      expect(bar(wrapper).exists()).toBe(false);
    });

    test("x selects the focused row (starting selection), and again deselects it", async () => {
      const { wrapper } = await setup();

      press("x");
      await flushPromises();
      expect(bar(wrapper).exists()).toBe(false);

      press("j");
      press("j");
      press("x");
      await flushPromises();
      expect(wrapper.get('[data-testid="selection-count"]').text()).toBe("1 selected");
      expect(rowButtons(wrapper)[1]!.attributes("aria-pressed")).toBe("true");

      press("x");
      await flushPromises();
      expect(wrapper.get('[data-testid="selection-count"]').text()).toBe("0 selected");
    });

    test("Escape leaves selection mode, keeping focus on the row", async () => {
      const { wrapper } = await setup();
      press("j");
      press("x");
      await flushPromises();

      press("Escape");
      await flushPromises();

      expect(bar(wrapper).exists()).toBe(false);
      expect(document.activeElement).toBe(rowButtons(wrapper)[0]!.element);
    });

    test("the shortcuts list x and Escape", async () => {
      const { wrapper } = await setup();

      press("?");
      await flushPromises();

      const help = wrapper.get('[data-testid="shortcuts-help"]').text();
      expect(help).toContain("Select item");
      expect(help).toContain("Leave selection");
    });
  });
});
