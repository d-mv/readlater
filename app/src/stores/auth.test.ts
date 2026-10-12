import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
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

const { calls, unsubscribeFromChanges, resetBookmarks, resetOfflineCache, clearAll } = vi.hoisted(
  () => {
    const calls: string[] = [];
    const record = (name: string) => vi.fn(() => void calls.push(name));
    return {
      calls,
      unsubscribeFromChanges: record("unsubscribe"),
      resetBookmarks: record("resetBookmarks"),
      resetOfflineCache: record("resetOfflineCache"),
      clearAll: vi.fn(async () => void calls.push("clearAll")),
    };
  },
);
vi.mock("./bookmarks", () => ({
  useBookmarksStore: () => ({ unsubscribeFromChanges, reset: resetBookmarks }),
}));
vi.mock("./offlineCache", () => ({
  useOfflineCacheStore: () => ({ reset: resetOfflineCache }),
}));
vi.mock("../lib/offlineDb", () => ({ clearAll }));

const { AuthRetryableFetchError, AuthApiError } = await import("@supabase/supabase-js");
const { useAuthStore } = await import("./auth");

function storeOfflineUser() {
  localStorage.setItem(
    "rl-auth-user",
    JSON.stringify({ id: "offline-user-1", email: "off@example.com" }),
  );
}

describe("useAuthStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    calls.length = 0;
    localStorage.clear();
    getSession.mockResolvedValue({ data: { session: null } });
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("signOut drops Realtime, the in-memory list and IndexedDB before signing out", async () => {
    storeOfflineUser();
    signOut.mockImplementation(async () => {
      calls.push("signOut");
      return { error: null };
    });

    const store = useAuthStore();
    await store.signOut();

    expect(calls).toEqual([
      "unsubscribe",
      "resetBookmarks",
      "resetOfflineCache",
      "clearAll",
      "signOut",
    ]);
    expect(store.isAuthenticated).toBe(false);
  });

  test("signOut still signs out when clearing IndexedDB fails", async () => {
    clearAll.mockRejectedValueOnce(new Error("quota"));
    signOut.mockResolvedValue({ error: null });

    const store = useAuthStore();
    await store.signOut();

    expect(signOut).toHaveBeenCalledOnce();
    expect(store.isAuthenticated).toBe(false);
  });

  test("online, init with no stored session ends the cached offline login", async () => {
    storeOfflineUser();

    const store = useAuthStore();
    expect(store.isAuthenticated).toBe(true);
    await store.init();

    expect(store.isAuthenticated).toBe(false);
    expect(localStorage.getItem("rl-auth-user")).toBeNull();
  });

  test("online, a refresh token the server rejects ends the cached offline login", async () => {
    storeOfflineUser();
    getSession.mockResolvedValue({
      data: { session: null },
      error: new AuthApiError("Invalid Refresh Token", 400, "refresh_token_not_found"),
    });

    const store = useAuthStore();
    await store.init();

    expect(store.isAuthenticated).toBe(false);
  });

  test("a refresh that couldn't reach the server keeps the cached offline login", async () => {
    storeOfflineUser();
    getSession.mockResolvedValue({
      data: { session: null },
      error: new AuthRetryableFetchError("Failed to fetch", 0),
    });

    const store = useAuthStore();
    await store.init();

    expect(store.isAuthenticated).toBe(true);
    expect(store.userId).toBe("offline-user-1");
  });

  test("offline, no session keeps the cached offline login", async () => {
    storeOfflineUser();
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);

    const store = useAuthStore();
    await store.init();

    expect(store.isAuthenticated).toBe(true);
  });

  test("checkSession loads a session supabase-js still has", async () => {
    getSession.mockResolvedValue({ data: { session: { user: { id: "u1" } } } });

    const store = useAuthStore();
    await expect(store.checkSession()).resolves.toBe(true);
    expect(store.session).not.toBeNull();
  });

  test("checkSession reports a session that is over and ends the login", async () => {
    storeOfflineUser();

    const store = useAuthStore();
    await expect(store.checkSession()).resolves.toBe(false);
    expect(store.isAuthenticated).toBe(false);
  });

  test("sessionExpired ends the login", () => {
    storeOfflineUser();

    const store = useAuthStore();
    store.sessionExpired();

    expect(store.isAuthenticated).toBe(false);
    expect(localStorage.getItem("rl-auth-user")).toBeNull();
  });

  test("starts unauthenticated with no session", () => {
    const store = useAuthStore();
    expect(store.isAuthenticated).toBe(false);
    expect(store.userId).toBeNull();
  });

  test("exposes the in-memory user id once a session loads", async () => {
    getSession.mockResolvedValue({ data: { session: { user: { id: "u1" } } } });

    const store = useAuthStore();
    await store.init();

    expect(store.userId).toBe("u1");
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

  test("init handles getSession throwing without rejecting the promise", async () => {
    localStorage.clear();
    getSession.mockRejectedValue(new Error("Failed to fetch"));

    const store = useAuthStore();
    await expect(store.init()).resolves.toBeUndefined();
    expect(store.isAuthenticated).toBe(false);
  });

  test("remains authenticated offline using stored user when getSession throws or returns null", async () => {
    localStorage.setItem(
      "rl-auth-user",
      JSON.stringify({ id: "offline-user-1", email: "off@example.com" }),
    );
    getSession.mockRejectedValue(new Error("Failed to fetch"));

    const store = useAuthStore();
    await store.init();

    expect(store.isAuthenticated).toBe(true);
    expect(store.userId).toBe("offline-user-1");
  });

  test("signOut clears stored offline user so isAuthenticated becomes false", async () => {
    localStorage.setItem(
      "rl-auth-user",
      JSON.stringify({ id: "offline-user-1", email: "off@example.com" }),
    );
    signOut.mockResolvedValue({ error: null });

    const store = useAuthStore();
    expect(store.isAuthenticated).toBe(true);

    await store.signOut();

    expect(store.isAuthenticated).toBe(false);
    expect(store.userId).toBeNull();
    expect(localStorage.getItem("rl-auth-user")).toBeNull();
  });

  test("a corrupted stored offline login is ignored rather than crashing the store", () => {
    localStorage.setItem("rl-auth-user", "{not json");

    const store = useAuthStore();

    expect(store.isAuthenticated).toBe(false);
    expect(store.userId).toBeNull();
  });

  test("a session found while localStorage refuses writes still signs the user in", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("quota", "QuotaExceededError");
    });
    signInWithPassword.mockResolvedValue({
      data: { session: { user: { id: "u1", email: "a@b.c" } } },
      error: null,
    });

    const store = useAuthStore();
    await store.signIn("a@b.c", "pw");

    expect(store.isAuthenticated).toBe(true);
    expect(store.userId).toBe("u1");
  });

  test("a session without an email caches the offline login with an empty email", async () => {
    getSession.mockResolvedValue({ data: { session: { user: { id: "u1" } } } });

    await useAuthStore().init();

    expect(JSON.parse(localStorage.getItem("rl-auth-user")!)).toEqual({ id: "u1", email: "" });
  });

  test("auth events after init: a new session signs in, SIGNED_OUT signs out, others are ignored", async () => {
    const store = useAuthStore();
    await store.init();
    const [onChange] = onAuthStateChange.mock.calls.at(-1) as unknown as [
      (event: string, session: unknown) => void,
    ];

    onChange("TOKEN_REFRESHED", { user: { id: "u2", email: "x@y.z" } });
    expect(store.userId).toBe("u2");

    onChange("USER_UPDATED", null);
    expect(store.userId).toBe("u2");

    onChange("SIGNED_OUT", null);
    expect(store.isAuthenticated).toBe(false);
  });

  test("checkSession reports false and keeps the cached login when getSession throws", async () => {
    storeOfflineUser();
    getSession.mockRejectedValue(new Error("Failed to fetch"));

    const store = useAuthStore();

    await expect(store.checkSession()).resolves.toBe(false);
    expect(store.isAuthenticated).toBe(true);
  });

  test("signIn without a session (e.g. awaiting email confirmation) stays signed out", async () => {
    signInWithPassword.mockResolvedValue({ data: { session: null }, error: null });

    const store = useAuthStore();

    await expect(store.signIn("a@b.c", "pw")).resolves.toEqual({ error: null });
    expect(store.isAuthenticated).toBe(false);
  });

  test("signOut still clears the local login when the server sign-out throws", async () => {
    storeOfflineUser();
    signOut.mockRejectedValue(new Error("Failed to fetch"));

    const store = useAuthStore();
    await expect(store.signOut()).resolves.toBeUndefined();

    expect(store.isAuthenticated).toBe(false);
  });
});
