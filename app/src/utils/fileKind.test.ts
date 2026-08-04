import { describe, expect, test } from "vitest";
import { detectFileKind, maxBytesForFileKind } from "./fileKind";

describe("detectFileKind", () => {
  test("recognizes markdown extensions", () => {
    expect(detectFileKind("notes.md")).toBe("markdown");
    expect(detectFileKind("NOTES.MARKDOWN")).toBe("markdown");
  });

  test("recognizes docx", () => {
    expect(detectFileKind("report.docx")).toBe("docx");
  });

  test("recognizes pdf", () => {
    expect(detectFileKind("report.PDF")).toBe("pdf");
  });

  test("rejects unsupported extensions", () => {
    expect(detectFileKind("legacy.doc")).toBeNull();
    expect(detectFileKind("image.png")).toBeNull();
  });
});

describe("maxBytesForFileKind", () => {
  test("returns the per-kind byte limit", () => {
    expect(maxBytesForFileKind("markdown")).toBe(500 * 1024);
    expect(maxBytesForFileKind("docx")).toBe(5 * 1024 * 1024);
    expect(maxBytesForFileKind("pdf")).toBe(20 * 1024 * 1024);
  });
});
