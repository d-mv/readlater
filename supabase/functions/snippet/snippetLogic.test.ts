import { assertEquals } from "jsr:@std/assert";
import { readingTimeFromWordCount, resolveContent, truncateTitle, wordCount } from "./snippetLogic.ts";

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

Deno.test("wordCount: counts whitespace-separated words", () => {
  assertEquals(wordCount("bold text here"), 3);
});

Deno.test("wordCount: empty string has zero words", () => {
  assertEquals(wordCount("   "), 0);
});

Deno.test("readingTimeFromWordCount: rounds to the nearest minute at 200wpm", () => {
  assertEquals(readingTimeFromWordCount(400), 2);
});

Deno.test("readingTimeFromWordCount: never rounds down to zero", () => {
  assertEquals(readingTimeFromWordCount(1), 1);
});
