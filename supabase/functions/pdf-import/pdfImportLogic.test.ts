import { assertEquals, assertMatch } from "jsr:@std/assert";
import {
  decodeBase64,
  isPdfFilename,
  normalizeExtractedText,
  pdfObjectPath,
  titleFromFilename,
} from "./pdfImportLogic.ts";

Deno.test("isPdfFilename: accepts .pdf, case-insensitively", () => {
  assertEquals(isPdfFilename("report.pdf"), true);
  assertEquals(isPdfFilename("REPORT.PDF"), true);
});

Deno.test("isPdfFilename: rejects other extensions", () => {
  assertEquals(isPdfFilename("report.docx"), false);
  assertEquals(isPdfFilename("noext"), false);
});

Deno.test("pdfObjectPath: scopes the object under the user's id and a .pdf suffix", () => {
  const path = pdfObjectPath("user-1");
  assertMatch(path, /^user-1\/[0-9a-f-]{36}\.pdf$/);
});

Deno.test("titleFromFilename: strips the extension", () => {
  assertEquals(titleFromFilename("Annual Report.pdf"), "Annual Report");
});

Deno.test("normalizeExtractedText: collapses runs of blank lines", () => {
  assertEquals(normalizeExtractedText("page one\n\n\n\npage two"), "page one\n\npage two");
});

Deno.test("normalizeExtractedText: trims trailing whitespace on lines and the whole text", () => {
  assertEquals(normalizeExtractedText("  hello   \n  world  \n\n"), "hello\n  world");
});

Deno.test("decodeBase64: round-trips bytes", () => {
  const bytes = decodeBase64(btoa("%PDF-1.4"));
  assertEquals(new TextDecoder().decode(bytes), "%PDF-1.4");
});
