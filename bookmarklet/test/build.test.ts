import { describe, expect, test } from "bun:test";
import { buildBookmarklet } from "../build";

describe("buildBookmarklet", () => {
  test("substitutes endpoint and key, then wraps as a javascript: URI", () => {
    const source = 'fetch("__CAPTURE_ENDPOINT__", { key: "__CAPTURE_KEY__" });';
    const result = buildBookmarklet(source, "https://x.supabase.co/functions/v1/capture", "s3cr3t");

    expect(result.startsWith("javascript:")).toBe(true);
    const decoded = decodeURIComponent(result.slice("javascript:".length));
    expect(decoded).toContain("https://x.supabase.co/functions/v1/capture");
    expect(decoded).toContain("s3cr3t");
    expect(decoded).not.toContain("__CAPTURE_ENDPOINT__");
    expect(decoded).not.toContain("__CAPTURE_KEY__");
  });

  test("throws when the endpoint is missing", () => {
    expect(() => buildBookmarklet("src", "", "key")).toThrow();
  });

  test("throws when the key is missing", () => {
    expect(() => buildBookmarklet("src", "https://x.supabase.co", "")).toThrow();
  });
});
