import { beforeEach, describe, expect, test, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { flushPromises } from "@vue/test-utils";

const { getSession, onAuthStateChange } = vi.hoisted(() => ({
  getSession: vi.fn(),
  onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
}));

vi.mock("../lib/supabase", () => ({
  supabase: { auth: { getSession, onAuthStateChange } },
}));

const { default: router } = await import("./index");

describe("router auth guard", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    getSession.mockResolvedValue({ data: { session: null } });
  });

  test("redirects an unauthenticated visitor from the list route to login", async () => {
    await router.push("/");
    expect(router.currentRoute.value.name).toBe("login");
  });

  test("lets an unauthenticated visitor reach a public share route", async () => {
    await router.push("/s/abc-123");
    expect(router.currentRoute.value.name).toBe("public");
  });

  test("lets an unauthenticated visitor reach the login route", async () => {
    await router.push("/login");
    expect(router.currentRoute.value.name).toBe("login");
  });

  test("does not redirect an authenticated visitor away from the list route", async () => {
    getSession.mockResolvedValue({ data: { session: { user: { id: "u1" } } } });

    await router.push("/");
    expect(router.currentRoute.value.name).toBe("list");
  });

  // Regression test for a real bug hit via the bookmarklet: window.open()
  // for /capture is a fresh page load, so on the very first navigation the
  // session hasn't loaded from storage yet. The guard must resolve auth
  // state itself (awaiting the same memoized auth.init() main.ts calls)
  // rather than read whatever isAuthenticated happens to be at that instant
  // — otherwise it misreads a real, still-loading session as "logged out",
  // redirects to login, and (once the session does load a moment later)
  // bounces straight on to the plain list — silently dropping the
  // bookmarklet's url/title query params along the way.
  test("resolves the session itself before deciding, landing on a protected deep link rather than bouncing to the list", async () => {
    getSession.mockResolvedValue({ data: { session: { user: { id: "u1" } } } });

    await router.push("/capture?url=https://example.com&title=Example");

    expect(router.currentRoute.value.name).toBe("capture");
    expect(router.currentRoute.value.query.url).toBe("https://example.com");
    expect(router.currentRoute.value.query.title).toBe("Example");
  });

  test("a login that ends mid-visit leaves the protected page for login", async () => {
    getSession.mockResolvedValue({ data: { session: { user: { id: "u1" } } } });
    await router.push("/settings");
    expect(router.currentRoute.value.name).toBe("settings");

    const [onChange] = onAuthStateChange.mock.calls.at(-1) as unknown as [
      (event: string, session: null) => void,
    ];
    onChange("SIGNED_OUT", null);
    await flushPromises();

    expect(router.currentRoute.value.name).toBe("login");
  });

  test("sends a signed-in visitor away from login to the list", async () => {
    getSession.mockResolvedValue({ data: { session: { user: { id: "u1" } } } });
    await router.push("/s/abc-123");

    await router.push("/login");
    expect(router.currentRoute.value.name).toBe("list");
  });

  test("resolves the reader and share-target pages for a signed-in visitor", async () => {
    getSession.mockResolvedValue({ data: { session: { user: { id: "u1" } } } });

    await router.push("/b/abc-123");
    expect(router.currentRoute.value.name).toBe("reader");
    expect(router.currentRoute.value.matched[0]!.components!.default).toBeDefined();

    await router.push("/share-target");
    expect(router.currentRoute.value.name).toBe("share-target");
    expect(router.currentRoute.value.matched[0]!.components!.default).toBeDefined();
  });

  test("a login that ends while reading a public share stays on that page", async () => {
    getSession.mockResolvedValue({ data: { session: { user: { id: "u1" } } } });
    await router.push("/s/shared-1");

    const [onChange] = onAuthStateChange.mock.calls.at(-1) as unknown as [
      (event: string, session: null) => void,
    ];
    onChange("SIGNED_OUT", null);
    await flushPromises();

    expect(router.currentRoute.value.name).toBe("public");
  });
});
