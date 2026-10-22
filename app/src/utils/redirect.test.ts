import { describe, expect, test } from "vitest";
import { safeRedirect } from "./redirect";

describe("safeRedirect", () => {
  test("keeps a path inside the app, query included", () => {
    expect(safeRedirect("/capture?url=https%3A%2F%2Fex.com&title=T")).toBe(
      "/capture?url=https%3A%2F%2Fex.com&title=T",
    );
    expect(safeRedirect("/b/123")).toBe("/b/123");
  });

  test.each([
    ["another origin", "https://evil.example/"],
    ["a protocol-relative URL", "//evil.example/"],
    ["a backslash trick", "/\\evil.example/"],
    ["a relative path", "capture"],
    ["the login page itself", "/login?redirect=/"],
    ["nothing", undefined],
    ["a repeated query param", ["/a", "/b"]],
  ])("refuses %s", (_label, value) => {
    expect(safeRedirect(value)).toBeNull();
  });
});
