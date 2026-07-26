import { describe, expect, test } from "bun:test";
import { stripDuplicateTitleHeading } from "../src/parseArticle";

describe("stripDuplicateTitleHeading", () => {
  test("removes a leading H1 that duplicates the article title", () => {
    const md = "# HTTP\n\nHTTP is a protocol.\n\nMore text.";
    expect(stripDuplicateTitleHeading(md, "HTTP")).toBe("HTTP is a protocol.\n\nMore text.");
  });

  test("is case-insensitive and trims whitespace when comparing", () => {
    const md = "##   http  \n\nBody text.";
    expect(stripDuplicateTitleHeading(md, "HTTP")).toBe("Body text.");
  });

  test("leaves content untouched when the leading heading does not match the title", () => {
    const md = "# Unrelated heading\n\nBody text.";
    expect(stripDuplicateTitleHeading(md, "HTTP")).toBe(md);
  });

  test("leaves content untouched when there is no title to compare against", () => {
    const md = "# HTTP\n\nBody text.";
    expect(stripDuplicateTitleHeading(md, null)).toBe(md);
  });

  test("leaves content untouched when it doesn't start with a heading at all", () => {
    const md = "Just a paragraph, no heading.";
    expect(stripDuplicateTitleHeading(md, "HTTP")).toBe(md);
  });
});
