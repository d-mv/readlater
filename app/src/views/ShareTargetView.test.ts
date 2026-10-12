import { beforeEach, describe, expect, test, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { flushPromises, mount } from "@vue/test-utils";
import type { Bookmark } from "../lib/supabase";

const { from } = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock("../lib/supabase", () => ({ supabase: { from } }));
vi.mock("../stores/auth", () => ({ useAuthStore: () => ({ userId: "user-1" }) }));

const { query, replace } = vi.hoisted(() => ({
  query: {} as Record<string, string>,
  replace: vi.fn(),
}));
vi.mock("vue-router", () => ({
  useRoute: () => ({ query }),
  useRouter: () => ({ replace }),
}));

const { default: ShareTargetView } = await import("./ShareTargetView.vue");
const { useBookmarksStore } = await import("../stores/bookmarks");

async function mountAndSave() {
  const wrapper = mount(ShareTargetView);
  await flushPromises();
  await wrapper.get('[data-testid="save-btn"]').trigger("click");
  await flushPromises();
  return wrapper;
}

function mockInsert(inserted: unknown) {
  const single = vi.fn().mockResolvedValue({ data: inserted, error: null });
  const select = vi.fn(() => ({ single }));
  const insert = vi.fn(() => ({ select }));
  from.mockReturnValue({ insert });
  return insert;
}

describe("ShareTargetView", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    for (const key of Object.keys(query)) delete query[key];
  });

  // The share target is a GET route, so a cross-site link reaches it exactly
  // like the OS share sheet does — nothing may be saved without a click.
  test("opening the page only shows what would be saved — nothing is written until Save", async () => {
    query.url = "https://arc90.com/x";

    const wrapper = mount(ShareTargetView, { attachTo: document.body });
    await flushPromises();

    expect(from).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain("https://arc90.com/x");
    expect(document.activeElement).toBe(wrapper.get('[data-testid="save-btn"]').element);
    wrapper.unmount();
  });

  test("Save stores a pending bookmark and routes to the list when the url param is present", async () => {
    query.url = "https://arc90.com/x";
    const insert = mockInsert({
      id: "new",
      url: "https://arc90.com/x",
      type: "article",
      status: "pending",
    });

    await mountAndSave();

    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ url: "https://arc90.com/x", status: "pending" }),
    );
    expect(replace).toHaveBeenCalledWith({ name: "list" });
  });

  test("a non-http(s) URL is refused before any Save button is offered", async () => {
    query.url = "javascript:alert(document.domain)";

    const wrapper = mount(ShareTargetView);
    await flushPromises();

    expect(wrapper.find('[data-testid="save-btn"]').exists()).toBe(false);
    expect(wrapper.text()).toContain("Only http(s) pages can be saved.");
    expect(from).not.toHaveBeenCalled();
  });

  test("shows the shared title and saves it with the URL", async () => {
    query.url = "https://arc90.com/x";
    query.title = "  A great article ";
    const insert = mockInsert({ id: "new", url: "https://arc90.com/x", status: "pending" });

    const wrapper = mount(ShareTargetView);
    await flushPromises();
    expect(wrapper.get('[data-testid="shared-title"]').text()).toBe("A great article");
    await wrapper.get('[data-testid="save-btn"]').trigger("click");
    await flushPromises();

    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ title: "A great article" }));
  });

  test("treats shared text that is itself a bare URL the same as a url param", async () => {
    query.text = "https://arc90.com/y";
    const insert = mockInsert({
      id: "new",
      url: "https://arc90.com/y",
      type: "article",
      status: "pending",
    });

    await mountAndSave();

    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ url: "https://arc90.com/y" }));
    expect(replace).toHaveBeenCalledWith({ name: "list" });
  });

  test("saves free-form shared text as a ready note", async () => {
    query.text = "remember to read this later, it was a great point";
    const insert = mockInsert({ id: "note-1", type: "note", status: "ready" });

    const wrapper = mount(ShareTargetView);
    await flushPromises();
    expect(wrapper.text()).toContain("remember to read this later");
    expect(from).not.toHaveBeenCalled();

    await wrapper.get('[data-testid="save-btn"]').trigger("click");
    await flushPromises();

    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ type: "note", status: "ready" }));
    expect(replace).toHaveBeenCalledWith({ name: "list" });
  });

  test("shows a duplicate dialog instead of routing away when the URL was already saved", async () => {
    query.url = "https://arc90.com/x";
    const single = vi
      .fn()
      .mockResolvedValue({ data: null, error: { code: "23505", message: "conflict" } });
    const select = vi.fn(() => ({ single }));
    const insert = vi.fn(() => ({ select }));
    from.mockReturnValueOnce({ insert });

    const existing = {
      id: "existing-1",
      title: "Already saved",
      created_at: "2026-01-01T00:00:00Z",
    };
    const maybeSingle = vi.fn().mockResolvedValue({ data: existing, error: null });
    const eq = vi.fn(() => ({ maybeSingle }));
    const lookupSelect = vi.fn(() => ({ eq }));
    from.mockReturnValueOnce({ select: lookupSelect });

    const wrapper = await mountAndSave();

    expect(replace).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain("Already saved");
  });

  test("a refresh the server rejects shows the error instead of routing away", async () => {
    query.url = "https://arc90.com/x";
    useBookmarksStore().bookmarks = [
      {
        id: "existing-1",
        url: "https://arc90.com/x",
        type: "article",
        status: "ready",
        title: "Loaded already",
        content_edited: false,
        created_at: "2026-01-01T00:00:00Z",
        tags: [],
      } as unknown as Bookmark,
    ];
    const update = vi.fn(() => ({
      eq: vi.fn().mockResolvedValue({ error: { message: "network down" } }),
    }));
    from.mockReturnValueOnce({ update });

    const wrapper = await mountAndSave();
    await wrapper.get('[data-testid="continue-btn"]').trigger("click");
    await flushPromises();

    expect(update).toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain("Couldn't save the change");
  });

  test("shows the duplicate prompt instead of routing away when the URL is already in the loaded list", async () => {
    query.url = "https://arc90.com/x";
    useBookmarksStore().bookmarks = [
      {
        id: "existing-1",
        url: "https://arc90.com/x",
        type: "article",
        status: "ready",
        title: "Loaded already",
        created_at: "2026-01-01T00:00:00Z",
        tags: [],
      } as unknown as Bookmark,
    ];

    const wrapper = await mountAndSave();

    expect(from).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain("Already saved");
  });

  test("shows an error state when neither url nor text is present", async () => {
    const wrapper = mount(ShareTargetView);
    await flushPromises();

    expect(wrapper.text()).toContain("Nothing to save");
    expect(replace).not.toHaveBeenCalled();
  });
});
