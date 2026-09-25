import { assertEquals } from "jsr:@std/assert";
import { decodeBase64, titleFromFilename } from "./file.ts";

Deno.test("titleFromFilename: strips the extension", () => {
  assertEquals(titleFromFilename("My Notes.md"), "My Notes");
  assertEquals(titleFromFilename("report.v2.docx"), "report.v2");
  assertEquals(titleFromFilename("Annual Report.pdf"), "Annual Report");
});

Deno.test("titleFromFilename: falls back to the full name when only an extension remains", () => {
  assertEquals(titleFromFilename(".md"), ".md");
});

Deno.test("decodeBase64: round-trips bytes", () => {
  assertEquals(new TextDecoder().decode(decodeBase64(btoa("%PDF-1.4"))), "%PDF-1.4");
});
