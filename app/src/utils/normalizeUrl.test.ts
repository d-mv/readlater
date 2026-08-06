import { describe, expect, test } from "vitest";
import { normalizeUrl } from "./normalizeUrl";

describe("normalizeUrl", () => {
  test("lowercases the URL", () => {
    expect(normalizeUrl("HTTPS://Example.com/Path")).toBe("https://example.com/path");
  });

  test("strips one or more trailing slashes", () => {
    expect(normalizeUrl("https://example.com/path/")).toBe("https://example.com/path");
    expect(normalizeUrl("https://example.com/path///")).toBe("https://example.com/path");
  });

  test("leaves a URL with no trailing slash otherwise unchanged", () => {
    expect(normalizeUrl("https://example.com/path")).toBe("https://example.com/path");
  });
});
