import { assertEquals } from "jsr:@std/assert";
import { readingTimeFromWordCount, readyNoteRow, truncateTitle, wordCount } from "./noteRow.ts";

Deno.test("truncateTitle: leaves short text untouched", () => {
  assertEquals(truncateTitle("a short note"), "a short note");
});

Deno.test("truncateTitle: cuts at the last space before the limit and adds an ellipsis", () => {
  const text = "word ".repeat(30).trim(); // 149 chars, well past the default 100
  const result = truncateTitle(text);
  assertEquals(result.endsWith("…"), true);
  assertEquals(result.length <= 102, true);
});

Deno.test("truncateTitle: hard-cuts when there's no space before the limit", () => {
  assertEquals(truncateTitle("a".repeat(150), 20), "a".repeat(20) + "…");
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

Deno.test("readyNoteRow: builds a ready note with text metrics and a title from the content", () => {
  assertEquals(readyNoteRow({ userId: "u1", content: "one two three" }), {
    url: null,
    type: "note",
    status: "ready",
    title: "one two three",
    content_md: "one two three",
    word_count: 3,
    reading_time: 1,
    user_id: "u1",
  });
});

Deno.test("readyNoteRow: truncates an explicit title instead of deriving one", () => {
  const row = readyNoteRow({ userId: "u1", content: "body text", title: "t".repeat(150) });
  assertEquals(row.title, "t".repeat(100) + "…");
  assertEquals(row.content_md, "body text");
});
