import { afterEach, describe, expect, test, vi } from "vitest";

const { createClient } = vi.hoisted(() => ({
  createClient: vi.fn((url: string, key: string, _options: unknown) => ({ url, key })),
}));
vi.mock("@supabase/supabase-js", () => ({ createClient }));

describe("supabase client", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  test("creates the client from the configured URL and publishable key", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://project.supabase.co");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");

    const { supabase, AUTH_STORAGE_KEY } = await import("./supabase");

    // The key supabase-js derives by default, so stored sessions stay valid.
    expect(AUTH_STORAGE_KEY).toBe("sb-project-auth-token");
    expect(createClient).toHaveBeenCalledWith(
      "https://project.supabase.co",
      "sb_publishable_test",
      {
        auth: { storageKey: "sb-project-auth-token" },
      },
    );
    expect(supabase).toEqual({ url: "https://project.supabase.co", key: "sb_publishable_test" });
  });

  test("fails fast when the URL is missing", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");

    await expect(import("./supabase")).rejects.toThrow(/must be set/);
  });

  test("fails fast when the publishable key is missing", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://project.supabase.co");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "");

    await expect(import("./supabase")).rejects.toThrow(/must be set/);
  });
});
