import { beforeEach, describe, expect, test, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

const { signInWithPassword, signOut, getSession, onAuthStateChange } = vi.hoisted(() => ({
  signInWithPassword: vi.fn(),
  signOut: vi.fn(),
  getSession: vi.fn(),
  onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
}));

vi.mock("../lib/supabase", () => ({
  supabase: {
    auth: { signInWithPassword, signOut, getSession, onAuthStateChange },
  },
}));

const { useAuthStore } = await import("./auth");

describe("useAuthStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    getSession.mockResolvedValue({ data: { session: null } });
  });

  test("starts unauthenticated with no session", () => {
    const store = useAuthStore();
    expect(store.isAuthenticated).toBe(false);
  });

  test("init loads the existing session, if any", async () => {
    const fakeSession = { user: { id: "u1" } };
    getSession.mockResolvedValue({ data: { session: fakeSession } });

    const store = useAuthStore();
    await store.init();

    expect(store.isAuthenticated).toBe(true);
  });

  test("signIn success sets the session and returns no error", async () => {
    const fakeSession = { user: { id: "u1" } };
    signInWithPassword.mockResolvedValue({ data: { session: fakeSession }, error: null });

    const store = useAuthStore();
    const result = await store.signIn("me@example.com", "hunter2");

    expect(result.error).toBeNull();
    expect(store.isAuthenticated).toBe(true);
  });

  test("signIn failure surfaces the error message and stays unauthenticated", async () => {
    signInWithPassword.mockResolvedValue({
      data: { session: null },
      error: { message: "Invalid login credentials" },
    });

    const store = useAuthStore();
    const result = await store.signIn("me@example.com", "wrong");

    expect(result.error).toBe("Invalid login credentials");
    expect(store.isAuthenticated).toBe(false);
  });

  test("init only calls getSession once even when called concurrently, sharing one promise", async () => {
    const fakeSession = { user: { id: "u1" } };
    getSession.mockResolvedValue({ data: { session: fakeSession } });

    const store = useAuthStore();
    await Promise.all([store.init(), store.init(), store.init()]);

    expect(getSession).toHaveBeenCalledTimes(1);
    expect(onAuthStateChange).toHaveBeenCalledTimes(1);
    expect(store.isAuthenticated).toBe(true);
  });

  test("signOut clears the session", async () => {
    signInWithPassword.mockResolvedValue({
      data: { session: { user: { id: "u1" } } },
      error: null,
    });
    signOut.mockResolvedValue({ error: null });

    const store = useAuthStore();
    await store.signIn("me@example.com", "hunter2");
    await store.signOut();

    expect(store.isAuthenticated).toBe(false);
  });
});
