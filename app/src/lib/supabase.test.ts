import { afterEach, describe, expect, test, vi } from "vitest";

const { createClient } = vi.hoisted(() => ({
  createClient: vi.fn((url: string, key: string) => ({ url, key })),
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

    const { supabase } = await import("./supabase");

    expect(createClient).toHaveBeenCalledWith("https://project.supabase.co", "sb_publishable_test");
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
