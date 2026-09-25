import { describe, expect, test } from "vitest";
import { isBareUrl, toCaptureOutcome, truncateTitle } from "./captureText";

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

describe("toCaptureOutcome", () => {
  test("maps an error result to an error outcome", () => {
    expect(toCaptureOutcome({ error: "Enter a valid URL." })).toEqual({
      kind: "error",
      message: "Enter a valid URL.",
    });
  });

  test("maps a duplicate result to a duplicate outcome carrying the existing row", () => {
    expect(
      toCaptureOutcome({
        error: null,
        duplicate: true,
        existingId: "b1",
        existingTitle: "Old",
        existingSavedAt: "2026-01-01T00:00:00Z",
      }),
    ).toEqual({ kind: "duplicate", id: "b1", savedAt: "2026-01-01T00:00:00Z" });
  });

  test("maps a successful insert to saved", () => {
    expect(toCaptureOutcome({ error: null })).toEqual({ kind: "saved" });
  });
});
