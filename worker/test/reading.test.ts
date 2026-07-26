import { describe, expect, test } from "bun:test";
import { readingTimeFromWordCount, readingTimeFromDurationSeconds, wordCount } from "../src/reading";

describe("wordCount", () => {
  test("counts space-separated words", () => {
    expect(wordCount("the quick brown fox")).toBe(4);
  });

  test("collapses repeated whitespace/newlines", () => {
    expect(wordCount("hello\n\n   world")).toBe(2);
  });

  test("returns 0 for empty content", () => {
    expect(wordCount("")).toBe(0);
    expect(wordCount("   \n  ")).toBe(0);
  });
});

describe("readingTimeFromWordCount", () => {
  test("rounds to the nearest minute at 200wpm", () => {
    expect(readingTimeFromWordCount(400)).toBe(2);
    expect(readingTimeFromWordCount(220)).toBe(1);
  });

  test("floors at 1 minute for short content", () => {
    expect(readingTimeFromWordCount(0)).toBe(1);
    expect(readingTimeFromWordCount(10)).toBe(1);
  });
});

describe("readingTimeFromDurationSeconds", () => {
  test("rounds video duration to the nearest minute", () => {
    expect(readingTimeFromDurationSeconds(600)).toBe(10);
    expect(readingTimeFromDurationSeconds(90)).toBe(2);
  });

  test("floors at 1 minute for very short videos", () => {
    expect(readingTimeFromDurationSeconds(5)).toBe(1);
  });
});
