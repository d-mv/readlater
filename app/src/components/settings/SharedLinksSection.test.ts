import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";

const { from, setPublic, copyText } = vi.hoisted(() => ({
  from: vi.fn(),
  setPublic: vi.fn(),
  copyText: vi.fn(),
}));
vi.mock("../../lib/supabase", () => ({ supabase: { from } }));
vi.mock("../../stores/bookmarks", () => ({ useBookmarksStore: () => ({ setPublic }) }));
vi.mock("../../utils/clipboard", () => ({ copyText }));

const { default: SharedLinksSection } = await import("./SharedLinksSection.vue");
const { SHARED_LINKS_LOAD_FAILED } = await import("../../composables/useSharedLinks");

type Response = { data: unknown[] | null; error: { message: string } | null };

function answer(response: Response | Promise<Response>) {
  from.mockReturnValueOnce({
    select: () => ({ eq: () => ({ order: () => Promise.resolve(response) }) }),
  });
}

const rows = [
  {
    id: "a",
    title: "First shared",
    url: "https://example.com/a",
    created_at: "2026-11-03T10:00:00Z",
  },
  { id: "b", title: null, url: "https://example.com/b", created_at: "2026-10-01T10:00:00Z" },
  { id: "c", title: null, url: null, created_at: "2026-09-01T10:00:00Z" },
];

function section() {
  return mount(SharedLinksSection, { props: { origin: "https://app.test" } });
}

const byId = (wrapper: ReturnType<typeof section>, testId: string) =>
  wrapper.findAll(`[data-testid="${testId}"]`);

enableAutoUnmount(afterEach);

describe("SharedLinksSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  test("is a labelled section that shows a loading state until the read settles", async () => {
    let finish!: (value: Response) => void;
    answer(new Promise<Response>((resolve) => (finish = resolve)));
    const wrapper = section();
    await flushPromises();

    const region = wrapper.get('[data-testid="shared-links"]');
    expect(region.element.tagName).toBe("SECTION");
    expect(region.attributes("aria-labelledby")).toBe(wrapper.get("h2").attributes("id"));
    expect(wrapper.get("h2").text()).toBe("Shared links");
    expect(region.attributes("aria-busy")).toBe("true");
    expect(wrapper.get('[data-testid="shared-links-loading"]').text()).toMatch(/Loading/);

    finish({ data: [], error: null });
    await flushPromises();
    expect(region.attributes("aria-busy")).toBe("false");
    expect(wrapper.find('[data-testid="shared-links-loading"]').exists()).toBe(false);
  });

  test("an empty answer shows the empty state", async () => {
    answer({ data: [], error: null });
    const wrapper = section();
    await flushPromises();

    expect(wrapper.get('[data-testid="shared-links-empty"]').text()).toMatch(/Nothing is shared/);
    expect(byId(wrapper, "shared-link")).toHaveLength(0);
  });

  test("lists each shared bookmark with its title, date and public link", async () => {
    answer({ data: rows, error: null });
    const wrapper = section();
    await flushPromises();

    const items = byId(wrapper, "shared-link");
    expect(items).toHaveLength(3);
    expect(items[0]!.get('[data-testid="shared-link-title"]').text()).toBe("First shared");
    // Untitled rows fall back to the URL, then to a placeholder.
    expect(items[1]!.get('[data-testid="shared-link-title"]').text()).toBe("https://example.com/b");
    expect(items[2]!.get('[data-testid="shared-link-title"]').text()).toBe("Untitled");
    expect(items[0]!.get('[data-testid="shared-link-date"]').text()).toMatch(/2026/);

    const link = items[0]!.get('[data-testid="shared-link-url"]');
    expect(link.attributes("href")).toBe("https://app.test/s/a");
    expect(link.text()).toBe("https://app.test/s/a");
    expect(link.attributes("target")).toBe("_blank");
    expect(link.attributes("rel")).toBe("noopener noreferrer");
  });

  test("the public link defaults to this page's origin", async () => {
    answer({ data: [rows[0]], error: null });
    const wrapper = mount(SharedLinksSection);
    await flushPromises();
    expect(wrapper.get('[data-testid="shared-link-url"]').attributes("href")).toBe(
      `${window.location.origin}/s/a`,
    );
  });

  test("copy puts the public link on the clipboard and confirms for a moment", async () => {
    answer({ data: rows, error: null });
    copyText.mockResolvedValue(undefined);
    const wrapper = section();
    await flushPromises();
    vi.useFakeTimers();

    const copy = byId(wrapper, "shared-link")[0]!.get('[data-testid="shared-link-copy"]');
    expect(copy.attributes("aria-label")).toBe("Copy link to First shared");
    await copy.trigger("click");
    await flushPromises();

    expect(copyText).toHaveBeenCalledWith("https://app.test/s/a");
    const copied = (index: number) =>
      byId(wrapper, "shared-link")[index]!.find(".tabler-icon-copy-check").exists();
    expect(copied(0)).toBe(true);
    expect(copied(1)).toBe(false);
    expect(wrapper.get('[data-testid="shared-links-status"]').text()).toBe("Link copied");

    // A second copy restarts the confirmation.
    await vi.advanceTimersByTimeAsync(1500);
    await byId(wrapper, "shared-link")[1]!.get('[data-testid="shared-link-copy"]').trigger("click");
    await flushPromises();
    expect(copied(0)).toBe(false);
    expect(copied(1)).toBe(true);
    await vi.advanceTimersByTimeAsync(1500);
    expect(copied(1)).toBe(true);
    await vi.advanceTimersByTimeAsync(500);
    expect(copied(1)).toBe(false);
    expect(wrapper.get('[data-testid="shared-links-status"]').text()).toBe("");
  });

  test("revoke unshares the row through the store and removes it", async () => {
    answer({ data: rows, error: null });
    let finish!: (value: { error: string | null }) => void;
    setPublic.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    const wrapper = section();
    await flushPromises();

    const revoke = byId(wrapper, "shared-link")[0]!.get('[data-testid="shared-link-revoke"]');
    // The visible "Revoke" plus hidden context, so each button has its own name.
    expect(revoke.text()).toBe("Revoke link to First shared");
    await revoke.trigger("click");
    expect(setPublic).toHaveBeenCalledWith("a", false);
    expect(revoke.attributes("disabled")).toBeDefined();
    expect(revoke.text()).toMatch(/^Revoking/);

    finish({ error: null });
    await flushPromises();
    expect(byId(wrapper, "shared-link").map((i) => i.attributes("data-id"))).toEqual(["b", "c"]);
  });

  test("a failed revoke keeps the row and says so", async () => {
    answer({ data: rows, error: null });
    setPublic.mockResolvedValue({ error: "Couldn't save the change." });
    const wrapper = section();
    await flushPromises();

    await byId(wrapper, "shared-link")[0]!
      .get('[data-testid="shared-link-revoke"]')
      .trigger("click");
    await flushPromises();

    expect(wrapper.get('[data-testid="shared-links-revoke-error"]').text()).toBe(
      "Couldn't save the change.",
    );
    expect(byId(wrapper, "shared-link")).toHaveLength(3);
  });

  test("a failed read shows the error with a retry that reloads", async () => {
    answer({ data: null, error: { message: "boom" } });
    const wrapper = section();
    await flushPromises();

    expect(wrapper.get('[data-testid="shared-links-error"]').text()).toBe(SHARED_LINKS_LOAD_FAILED);
    answer({ data: [rows[0]], error: null });
    await wrapper.get('[data-testid="shared-links-retry"]').trigger("click");
    await flushPromises();

    expect(wrapper.find('[data-testid="shared-links-error"]').exists()).toBe(false);
    expect(byId(wrapper, "shared-link")).toHaveLength(1);
  });
});
