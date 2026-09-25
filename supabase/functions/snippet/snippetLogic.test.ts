import { assertEquals } from "jsr:@std/assert";
import { resolveContent } from "./snippetLogic.ts";

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
