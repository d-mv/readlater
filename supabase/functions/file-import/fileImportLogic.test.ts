import { assertEquals } from "jsr:@std/assert";
import {
  decodeBase64,
  detectKind,
  MAX_DOCX_BYTES,
  MAX_MARKDOWN_BYTES,
  maxBytesFor,
  titleFromFilename,
} from "./fileImportLogic.ts";

Deno.test("detectKind: recognizes markdown extensions", () => {
  assertEquals(detectKind("notes.md"), "markdown");
  assertEquals(detectKind("NOTES.MARKDOWN"), "markdown");
});

Deno.test("detectKind: recognizes docx extension", () => {
  assertEquals(detectKind("report.docx"), "docx");
});

Deno.test("detectKind: rejects unsupported extensions", () => {
  assertEquals(detectKind("legacy.doc"), null);
  assertEquals(detectKind("image.png"), null);
  assertEquals(detectKind("noext"), null);
});

Deno.test("maxBytesFor: returns the right limit per kind", () => {
  assertEquals(maxBytesFor("markdown"), MAX_MARKDOWN_BYTES);
  assertEquals(maxBytesFor("docx"), MAX_DOCX_BYTES);
});

Deno.test("titleFromFilename: strips the extension", () => {
  assertEquals(titleFromFilename("My Notes.md"), "My Notes");
  assertEquals(titleFromFilename("report.v2.docx"), "report.v2");
});

Deno.test("decodeBase64: round-trips UTF-8 text", () => {
  const bytes = decodeBase64(btoa("hello world"));
  assertEquals(new TextDecoder().decode(bytes), "hello world");
});
