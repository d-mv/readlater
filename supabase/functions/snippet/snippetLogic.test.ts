import { assertEquals } from "jsr:@std/assert";
import { resolveContent, truncateTitle } from "./snippetLogic.ts";

Deno.test("resolveContent: prefers the converted markdown when non-empty", () => {
  assertEquals(resolveContent("**bold**", "bold"), "**bold**");
});

Deno.test("resolveContent: falls back to plain text when converted is empty", () => {
  assertEquals(resolveContent("", "plain text"), "plain text");
});

Deno.test("resolveContent: falls back to plain text when converted is only whitespace", () => {
  assertEquals(resolveContent("   \n  ", "plain text"), "plain text");
});

Deno.test("resolveContent: trims the fallback text", () => {
  assertEquals(resolveContent("", "  plain text  "), "plain text");
});

Deno.test("resolveContent: empty converted and empty text yields empty string", () => {
  assertEquals(resolveContent("", ""), "");
});

Deno.test("truncateTitle: leaves short text untouched", () => {
  assertEquals(truncateTitle("a short note"), "a short note");
});

Deno.test("truncateTitle: cuts at the last space before the limit and adds an ellipsis", () => {
  const text = "word ".repeat(30).trim();
  const result = truncateTitle(text);
  assertEquals(result.endsWith("…"), true);
  assertEquals(result.length <= 102, true);
});
