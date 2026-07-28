import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { flushPromises, mount } from "@vue/test-utils";

const { from, getUser } = vi.hoisted(() => ({ from: vi.fn(), getUser: vi.fn() }));
vi.mock("../lib/supabase", () => ({ supabase: { from, auth: { getUser } } }));

const { query } = vi.hoisted(() => ({ query: {} as Record<string, string> }));
vi.mock("vue-router", () => ({ useRoute: () => ({ query }) }));

const { default: CaptureView } = await import("./CaptureView.vue");

describe("CaptureView", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.stubGlobal("close", vi.fn());
    for (const key of Object.keys(query)) delete query[key];
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  test("saves a pending bookmark with its title, then closes the window", async () => {
    query.url = "https://arc90.com/x";
    query.title = "A great article";
    getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
    const inserted = { id: "new", url: "https://arc90.com/x", type: "article", status: "pending" };
    const single = vi.fn().mockResolvedValue({ data: inserted, error: null });
    const select = vi.fn(() => ({ single }));
    const insert = vi.fn(() => ({ select }));
    from.mockReturnValue({ insert });

    const wrapper = mount(CaptureView);
    await flushPromises();

    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://arc90.com/x",
        title: "A great article",
        status: "pending",
      }),
    );
    expect(wrapper.text()).toContain("Saved");
    expect(window.close).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(800);
    expect(window.close).toHaveBeenCalled();
  });

  test("shows a duplicate dialog, and Continue refreshes the existing row then closes", async () => {
    query.url = "https://arc90.com/x";
    getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
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

    const contentEditedMaybeSingle = vi.fn().mockResolvedValue({ data: { content_edited: false } });
    const contentEditedEq = vi.fn(() => ({ maybeSingle: contentEditedMaybeSingle }));
    const contentEditedSelect = vi.fn(() => ({ eq: contentEditedEq }));
    from.mockReturnValueOnce({ select: contentEditedSelect });

    const update = vi.fn(() => ({ eq: vi.fn().mockResolvedValue({}) }));
    from.mockReturnValueOnce({ update });

    const wrapper = mount(CaptureView);
    await flushPromises();
    expect(wrapper.text()).toContain("Already saved");

    await wrapper.find("button.btn-primary").trigger("click");
    await flushPromises();

    expect(update).toHaveBeenCalledWith(expect.objectContaining({ status: "pending" }));
    expect(wrapper.text()).toContain("Saved");

    await vi.advanceTimersByTimeAsync(800);
    expect(window.close).toHaveBeenCalled();
  });

  test("shows an error state when there's no url param", async () => {
    const wrapper = mount(CaptureView);
    await flushPromises();

    expect(wrapper.text()).toContain("Nothing to save");
    expect(from).not.toHaveBeenCalled();
  });
});
