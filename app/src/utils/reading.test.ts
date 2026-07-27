import { describe, expect, test } from "vitest";
import { readingTimeFromWordCount, wordCount } from "./reading";

describe("wordCount", () => {
  test("counts whitespace-separated words", () => {
    expect(wordCount("bold text here")).toBe(3);
  });

  test("empty string has zero words", () => {
    expect(wordCount("   ")).toBe(0);
  });
});

describe("readingTimeFromWordCount", () => {
  test("rounds to the nearest minute at 200wpm", () => {
    expect(readingTimeFromWordCount(400)).toBe(2);
  });

  test("never rounds down to zero", () => {
    expect(readingTimeFromWordCount(1)).toBe(1);
  });
});
