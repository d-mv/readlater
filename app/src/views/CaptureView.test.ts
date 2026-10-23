import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { flushPromises, mount } from "@vue/test-utils";
import type { Bookmark } from "../lib/supabase";

const { from } = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock("../lib/supabase", () => ({ supabase: { from } }));
vi.mock("../stores/auth", () => ({ useAuthStore: () => ({ userId: "user-1" }) }));

const { query } = vi.hoisted(() => ({ query: {} as Record<string, string> }));
vi.mock("vue-router", () => ({ useRoute: () => ({ query }) }));

const { default: CaptureView } = await import("./CaptureView.vue");
const { useBookmarksStore } = await import("../stores/bookmarks");

async function clickSave(wrapper: ReturnType<typeof mount>) {
  await click(wrapper.get('[data-testid="save-btn"]'));
  await flushPromises();
}

/** Mocks the insert → unique violation → lookup sequence of a duplicate add. */
function mockDuplicateInsert() {
  const single = vi
    .fn()
    .mockResolvedValue({ data: null, error: { code: "23505", message: "conflict" } });
  const select = vi.fn(() => ({ single }));
  const insert = vi.fn(() => ({ select }));
  from.mockReturnValueOnce({ insert });

  const existing = { id: "existing-1", title: "Already saved", created_at: "2026-01-01T00:00:00Z" };
  const maybeSingle = vi.fn().mockResolvedValue({ data: existing, error: null });
  // Duplicate lookup: .eq("user_id", …).eq("url_normalized", …).maybeSingle()
  const eq = vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle })) }));
  from.mockReturnValueOnce({ select: vi.fn(() => ({ eq })) });

  const contentEditedMaybeSingle = vi.fn().mockResolvedValue({ data: { content_edited: false } });
  const contentEditedEq = vi.fn(() => ({ maybeSingle: contentEditedMaybeSingle }));
  from.mockReturnValueOnce({ select: vi.fn(() => ({ eq: contentEditedEq })) });
}

/** A click as the browser reports it: detail 1 for a pointer, 0 for a key. */
async function click(target: { element: Element }, detail = 1) {
  target.element.dispatchEvent(new MouseEvent("click", { detail, bubbles: true }));
  await flushPromises();
}

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

  test("opening the page only shows what would be saved — nothing is written until Save", async () => {
    query.url = "https://arc90.com/x";
    query.title = "A great article";

    const wrapper = mount(CaptureView);
    await flushPromises();

    expect(from).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain("A great article");
    expect(wrapper.text()).toContain("https://arc90.com/x");
    expect(wrapper.find('[data-testid="save-btn"]').exists()).toBe(true);
  });

  test("doesn't focus Save: a page that opened the popup can't save it with keys", async () => {
    query.url = "https://arc90.com/x";

    const wrapper = mount(CaptureView, { attachTo: document.body });
    await flushPromises();

    expect(document.activeElement).not.toBe(wrapper.get('[data-testid="save-btn"]').element);
    wrapper.unmount();
  });

  test("ignores Save pressed by keyboard right after the prompt appears", async () => {
    query.url = "https://arc90.com/x";
    const insert = vi.fn();
    from.mockReturnValue({ insert });

    const wrapper = mount(CaptureView);
    await flushPromises();
    // A keyboard activation is a click with detail 0.
    await click(wrapper.get('[data-testid="save-btn"]'), 0);
    await flushPromises();

    expect(insert).not.toHaveBeenCalled();
    expect(wrapper.find('[data-testid="confirm-panel"]').exists()).toBe(true);
  });

  test("Save stores a pending bookmark with its title, then closes the window", async () => {
    query.url = "https://arc90.com/x";
    query.title = "A great article";
    const inserted = { id: "new", url: "https://arc90.com/x", type: "article", status: "pending" };
    const single = vi.fn().mockResolvedValue({ data: inserted, error: null });
    const select = vi.fn(() => ({ single }));
    const insert = vi.fn(() => ({ select }));
    from.mockReturnValue({ insert });

    const wrapper = mount(CaptureView);
    await flushPromises();
    await clickSave(wrapper);

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

  test("a non-http(s) url is refused without offering Save", async () => {
    query.url = "javascript:alert(1)";

    const wrapper = mount(CaptureView);
    await flushPromises();

    expect(wrapper.find('[data-testid="save-btn"]').exists()).toBe(false);
    expect(wrapper.text()).toContain("Only http(s)");
    expect(from).not.toHaveBeenCalled();
  });

  test("shows a duplicate dialog, and Continue refreshes the existing row then closes", async () => {
    query.url = "https://arc90.com/x";
    mockDuplicateInsert();
    const update = vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ error: null }) }));
    from.mockReturnValueOnce({ update });

    const wrapper = mount(CaptureView);
    await flushPromises();
    await clickSave(wrapper);
    expect(wrapper.text()).toContain("Already saved");

    // A keypress right as the prompt appears is ignored here too.
    await click(wrapper.get('[data-testid="continue-btn"]'), 0);
    expect(update).not.toHaveBeenCalled();

    await click(wrapper.get('[data-testid="continue-btn"]'));
    await flushPromises();

    expect(update).toHaveBeenCalledWith(expect.objectContaining({ status: "pending" }));
    expect(wrapper.text()).toContain("Saved");

    await vi.advanceTimersByTimeAsync(800);
    expect(window.close).toHaveBeenCalled();
  });

  test("a refresh the server rejects shows the error instead of Saved", async () => {
    query.url = "https://arc90.com/x";
    mockDuplicateInsert();
    const update = vi.fn(() => ({
      eq: vi.fn().mockResolvedValue({ error: { message: "network down" } }),
    }));
    from.mockReturnValueOnce({ update });

    const wrapper = mount(CaptureView);
    await flushPromises();
    await clickSave(wrapper);
    await click(wrapper.get('[data-testid="continue-btn"]'));
    await flushPromises();
    await vi.advanceTimersByTimeAsync(800);

    expect(wrapper.text()).toContain("Couldn't save the change");
    expect(wrapper.text()).not.toContain("Saved");
    expect(window.close).not.toHaveBeenCalled();
  });

  test("shows the duplicate prompt, not Saved, when the URL is already in the loaded list", async () => {
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

    const wrapper = mount(CaptureView);
    await flushPromises();
    await clickSave(wrapper);
    await vi.advanceTimersByTimeAsync(800);

    expect(from).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain("Already saved");
    expect(wrapper.text()).not.toContain("Saved");
    expect(window.close).not.toHaveBeenCalled();
  });

  test("a blank title param falls back to showing just the URL", async () => {
    query.url = "https://arc90.com/x";
    query.title = "   ";

    const wrapper = mount(CaptureView);
    await flushPromises();

    const lines = wrapper.findAll('[data-testid="confirm-panel"] p').map((p) => p.text());
    expect(lines).toEqual(["https://arc90.com/x"]);
  });

  test("a double-click on Save stores the bookmark once", async () => {
    query.url = "https://arc90.com/x";
    const inserted = { id: "new", url: "https://arc90.com/x", type: "article", status: "pending" };
    const insert = vi.fn(() => ({
      select: vi.fn(() => ({ single: vi.fn().mockResolvedValue({ data: inserted, error: null }) })),
    }));
    from.mockReturnValue({ insert });

    const wrapper = mount(CaptureView);
    await flushPromises();
    const save = wrapper.get('[data-testid="save-btn"]').element as HTMLButtonElement;
    save.dispatchEvent(new MouseEvent("click", { detail: 1, bubbles: true }));
    save.dispatchEvent(new MouseEvent("click", { detail: 1, bubbles: true }));
    await flushPromises();

    expect(insert).toHaveBeenCalledTimes(1);
    expect(wrapper.text()).toContain("Saved");
  });

  test("a double-click on Continue re-queues the existing bookmark only once", async () => {
    query.url = "https://arc90.com/x";
    mockDuplicateInsert();
    const update = vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ error: null }) }));
    from.mockReturnValue({ update });

    const wrapper = mount(CaptureView);
    await flushPromises();
    await clickSave(wrapper);
    const button = wrapper.get('[data-testid="continue-btn"]').element as HTMLButtonElement;
    button.dispatchEvent(new MouseEvent("click", { detail: 1, bubbles: true }));
    button.dispatchEvent(new MouseEvent("click", { detail: 1, bubbles: true }));
    await flushPromises();

    expect(update).toHaveBeenCalledTimes(1);
    expect(wrapper.text()).toContain("Saved");
  });

  test("Cancel closes the popup without saving", async () => {
    query.url = "https://arc90.com/x";

    const wrapper = mount(CaptureView);
    await flushPromises();
    await wrapper.get('[data-testid="confirm-panel"] button').trigger("click");

    expect(window.close).toHaveBeenCalledTimes(1);
    expect(from).not.toHaveBeenCalled();
  });

  test("shows an error state when there's no url param", async () => {
    const wrapper = mount(CaptureView);
    await flushPromises();

    expect(wrapper.text()).toContain("Nothing to save");
    expect(from).not.toHaveBeenCalled();
  });
});
