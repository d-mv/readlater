import { beforeEach, describe, expect, test, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { flushPromises, mount } from "@vue/test-utils";

const { from, getUser } = vi.hoisted(() => ({ from: vi.fn(), getUser: vi.fn() }));
vi.mock("../lib/supabase", () => ({ supabase: { from, auth: { getUser } } }));

const { query, replace } = vi.hoisted(() => ({ query: {} as Record<string, string>, replace: vi.fn() }));
vi.mock("vue-router", () => ({
  useRoute: () => ({ query }),
  useRouter: () => ({ replace }),
}));

const { default: ShareTargetView } = await import("./ShareTargetView.vue");

describe("ShareTargetView", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    for (const key of Object.keys(query)) delete query[key];
  });

  test("saves a pending bookmark and routes to the list when the url param is present", async () => {
    query.url = "https://arc90.com/x";
    getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
    const inserted = { id: "new", url: "https://arc90.com/x", type: "article", status: "pending" };
    const single = vi.fn().mockResolvedValue({ data: inserted, error: null });
    const select = vi.fn(() => ({ single }));
    const insert = vi.fn(() => ({ select }));
    from.mockReturnValue({ insert });

    mount(ShareTargetView);
    await flushPromises();

    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ url: "https://arc90.com/x", status: "pending" }));
    expect(replace).toHaveBeenCalledWith({ name: "list" });
  });

  test("treats shared text that is itself a bare URL the same as a url param", async () => {
    query.text = "https://arc90.com/y";
    getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
    const inserted = { id: "new", url: "https://arc90.com/y", type: "article", status: "pending" };
    const single = vi.fn().mockResolvedValue({ data: inserted, error: null });
    const select = vi.fn(() => ({ single }));
    const insert = vi.fn(() => ({ select }));
    from.mockReturnValue({ insert });

    mount(ShareTargetView);
    await flushPromises();

    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ url: "https://arc90.com/y" }));
    expect(replace).toHaveBeenCalledWith({ name: "list" });
  });

  test("saves free-form shared text as a ready note", async () => {
    query.text = "remember to read this later, it was a great point";
    getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
    const inserted = { id: "note-1", type: "note", status: "ready" };
    const single = vi.fn().mockResolvedValue({ data: inserted, error: null });
    const select = vi.fn(() => ({ single }));
    const insert = vi.fn(() => ({ select }));
    from.mockReturnValue({ insert });

    mount(ShareTargetView);
    await flushPromises();

    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ type: "note", status: "ready" }));
    expect(replace).toHaveBeenCalledWith({ name: "list" });
  });

  test("shows a duplicate dialog instead of routing away when the URL was already saved", async () => {
    query.url = "https://arc90.com/x";
    getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
    const single = vi.fn().mockResolvedValue({ data: null, error: { code: "23505", message: "conflict" } });
    const select = vi.fn(() => ({ single }));
    const insert = vi.fn(() => ({ select }));
    from.mockReturnValueOnce({ insert });

    const existing = { id: "existing-1", title: "Already saved", created_at: "2026-01-01T00:00:00Z" };
    const maybeSingle = vi.fn().mockResolvedValue({ data: existing, error: null });
    const eq = vi.fn(() => ({ maybeSingle }));
    const lookupSelect = vi.fn(() => ({ eq }));
    from.mockReturnValueOnce({ select: lookupSelect });

    const wrapper = mount(ShareTargetView);
    await flushPromises();

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
