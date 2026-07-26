import { beforeEach, describe, expect, test, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

vi.mock("../lib/supabase", () => ({
  supabase: { auth: { getSession: vi.fn(), onAuthStateChange: vi.fn() } },
}));

const { useAuthStore } = await import("../stores/auth");
const { default: router } = await import("./index");

describe("router auth guard", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
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
    const auth = useAuthStore();
    // @ts-expect-error assigning a minimal fake session for the guard's null-check
    auth.session = { user: { id: "u1" } };

    await router.push("/");
    expect(router.currentRoute.value.name).toBe("list");
  });
});
