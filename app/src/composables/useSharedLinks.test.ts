import { beforeEach, describe, expect, test, vi } from "vitest";
import { effectScope } from "vue";

const { from, setPublic } = vi.hoisted(() => ({ from: vi.fn(), setPublic: vi.fn() }));
vi.mock("../lib/supabase", () => ({ supabase: { from } }));
vi.mock("../stores/bookmarks", () => ({ useBookmarksStore: () => ({ setPublic }) }));

const { useSharedLinks, SHARED_LINKS_LOAD_FAILED } = await import("./useSharedLinks");

type Response = { data: unknown[] | null; error: { message: string } | null };

// Chainable stub for `select(...).eq("is_public", true).order(...)`.
function sharedQuery(response: Response) {
  const calls: unknown[][] = [];
  const query = {
    eq: (...args: unknown[]) => {
      calls.push(["eq", ...args]);
      return query;
    },
    order: (...args: unknown[]) => {
      calls.push(["order", ...args]);
      return Promise.resolve(response);
    },
  };
  const select = vi.fn((columns: string) => {
    calls.push(["select", columns]);
    return query;
  });
  return { select, calls };
}

const link = (id: string, title: string | null = `Title ${id}`) => ({
  id,
  title,
  url: `https://example.com/${id}`,
  created_at: "2026-11-01T10:00:00Z",
});

function setup() {
  const scope = effectScope();
  const links = scope.run(() => useSharedLinks())!;
  return { links, scope };
}

describe("useSharedLinks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("starts loading, then lists the owner's public bookmarks newest first in one query", async () => {
    const q = sharedQuery({ data: [link("a"), link("b")], error: null });
    from.mockReturnValue({ select: q.select });
    const { links } = setup();

    expect(links.state.value).toEqual({ status: "loading" });
    await links.load();

    expect(from).toHaveBeenCalledExactlyOnceWith("bookmarks");
    expect(q.calls).toEqual([
      ["select", "id, title, url, created_at"],
      ["eq", "is_public", true],
      ["order", "created_at", { ascending: false }],
    ]);
    expect(links.state.value).toEqual({ status: "ready", links: [link("a"), link("b")] });
  });

  test("a failed read is an error state with a readable message, and retrying recovers", async () => {
    from.mockReturnValueOnce({
      select: sharedQuery({ data: null, error: { message: "boom" } }).select,
    });
    const { links } = setup();
    await links.load();
    expect(links.state.value).toEqual({ status: "error", message: SHARED_LINKS_LOAD_FAILED });

    from.mockReturnValueOnce({ select: sharedQuery({ data: [], error: null }).select });
    const pending = links.load();
    expect(links.state.value).toEqual({ status: "loading" });
    await pending;
    expect(links.state.value).toEqual({ status: "ready", links: [] });
  });

  test("a thrown read (offline) is an error state too", async () => {
    from.mockReturnValue({
      select: () => ({ eq: () => ({ order: () => Promise.reject(new Error("offline")) }) }),
    });
    const { links } = setup();
    await links.load();
    expect(links.state.value).toEqual({ status: "error", message: SHARED_LINKS_LOAD_FAILED });
  });

  test("a null data answer reads as no links", async () => {
    from.mockReturnValue({ select: sharedQuery({ data: null, error: null }).select });
    const { links } = setup();
    await links.load();
    expect(links.state.value).toEqual({ status: "ready", links: [] });
  });

  test("revoke unshares through the bookmarks store and drops the row", async () => {
    from.mockReturnValue({
      select: sharedQuery({ data: [link("a"), link("b")], error: null }).select,
    });
    let finish!: (value: { error: string | null }) => void;
    setPublic.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    const { links } = setup();
    await links.load();

    const pending = links.revoke("a");
    expect(setPublic).toHaveBeenCalledWith("a", false);
    expect(links.revoking.value.has("a")).toBe(true);
    finish({ error: null });
    await pending;

    expect(links.revoking.value.has("a")).toBe(false);
    expect(links.revokeError.value).toBeNull();
    expect(links.state.value).toEqual({ status: "ready", links: [link("b")] });
  });

  test("a failed revoke keeps the row and reports the store's error", async () => {
    from.mockReturnValue({ select: sharedQuery({ data: [link("a")], error: null }).select });
    setPublic.mockResolvedValue({ error: "Couldn't save the change." });
    const { links } = setup();
    await links.load();

    await links.revoke("a");
    expect(links.revokeError.value).toBe("Couldn't save the change.");
    expect(links.revoking.value.size).toBe(0);
    expect(links.state.value).toEqual({ status: "ready", links: [link("a")] });

    // The next attempt clears the old message.
    setPublic.mockResolvedValue({ error: null });
    await links.revoke("a");
    expect(links.revokeError.value).toBeNull();
    expect(links.state.value).toEqual({ status: "ready", links: [] });
  });

  test("a second revoke of the same row while one is in flight is ignored", async () => {
    from.mockReturnValue({ select: sharedQuery({ data: [link("a")], error: null }).select });
    setPublic.mockReturnValue(new Promise(() => {}));
    const { links } = setup();
    await links.load();

    void links.revoke("a");
    void links.revoke("a");
    expect(setPublic).toHaveBeenCalledOnce();
  });

  test("a revoke that settles after a reload started leaves the new state alone", async () => {
    from.mockReturnValueOnce({ select: sharedQuery({ data: [link("a")], error: null }).select });
    let finish!: (value: { error: string | null }) => void;
    setPublic.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    const { links } = setup();
    await links.load();

    const pending = links.revoke("a");
    from.mockReturnValueOnce({
      select: () => ({ eq: () => ({ order: () => new Promise(() => {}) }) }),
    });
    void links.load();
    finish({ error: null });
    await pending;
    expect(links.state.value).toEqual({ status: "loading" });
  });

  test("a load that settles after a newer one is dropped", async () => {
    let finishFirst!: (value: Response) => void;
    from.mockReturnValueOnce({
      select: () => ({
        eq: () => ({ order: () => new Promise<Response>((resolve) => (finishFirst = resolve)) }),
      }),
    });
    from.mockReturnValueOnce({ select: sharedQuery({ data: [link("new")], error: null }).select });
    const { links } = setup();

    const first = links.load();
    await links.load();
    finishFirst({ data: [link("old")], error: null });
    await first;
    expect(links.state.value).toEqual({ status: "ready", links: [link("new")] });
  });
});
