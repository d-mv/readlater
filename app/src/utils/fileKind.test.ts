import { describe, expect, test } from "vitest";
import {
  detectFileKind,
  formatSizeLimit,
  maxBytesForFileKind,
  sizeLimitLabelForFileKind,
} from "./fileKind";

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

describe("formatSizeLimit", () => {
  test("uses MB from 1 MiB up and KB below, in binary units", () => {
    expect(formatSizeLimit(500 * 1024)).toBe("500KB");
    expect(formatSizeLimit(1024 * 1024)).toBe("1MB");
    expect(formatSizeLimit(20 * 1024 * 1024)).toBe("20MB");
  });

  test("keeps one decimal only when the limit isn't a whole number", () => {
    expect(formatSizeLimit(1.5 * 1024 * 1024)).toBe("1.5MB");
    expect(formatSizeLimit(1536)).toBe("1.5KB");
  });
});

describe("sizeLimitLabelForFileKind", () => {
  test("labels each kind's byte limit", () => {
    expect(sizeLimitLabelForFileKind("markdown")).toBe("500KB");
    expect(sizeLimitLabelForFileKind("docx")).toBe("5MB");
    expect(sizeLimitLabelForFileKind("pdf")).toBe("20MB");
  });
});
