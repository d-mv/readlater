import { describe, expect, test } from "vitest";
import { isBareUrl, truncateTitle } from "./captureText";

describe("isBareUrl", () => {
  test("accepts a bare http(s) URL", () => {
    expect(isBareUrl("https://example.com/post")).toBe(true);
  });

  test("accepts a bare root domain URL with no path", () => {
    expect(isBareUrl("https://example.com")).toBe(true);
    expect(isBareUrl("http://example.org")).toBe(true);
  });

  test("rejects free-form text containing a URL", () => {
    expect(isBareUrl("check this out: https://example.com/post")).toBe(false);
  });

  test("rejects non-http(s) schemes", () => {
    expect(isBareUrl("javascript:alert(1)")).toBe(false);
  });
});

describe("truncateTitle", () => {
  test("leaves short text untouched", () => {
    expect(truncateTitle("a short note")).toBe("a short note");
  });

  test("truncates long text with an ellipsis", () => {
    const text = "word ".repeat(30).trim();
    expect(truncateTitle(text).endsWith("…")).toBe(true);
  });
});
