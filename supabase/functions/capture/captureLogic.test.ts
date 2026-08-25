import { assertEquals } from "jsr:@std/assert";
import { hasAllowedScheme, isBareUrl, normalizeUrl, truncateTitle } from "./captureLogic.ts";

Deno.test("hasAllowedScheme: accepts https", () => {
  assertEquals(hasAllowedScheme("https://example.com/post"), true);
});

Deno.test("hasAllowedScheme: accepts http", () => {
  assertEquals(hasAllowedScheme("http://example.com/post"), true);
});

Deno.test("hasAllowedScheme: rejects javascript:", () => {
  assertEquals(hasAllowedScheme("javascript:alert(1)"), false);
});

Deno.test("hasAllowedScheme: rejects an unparseable string", () => {
  assertEquals(hasAllowedScheme("not a url"), false);
});

Deno.test("isBareUrl: accepts an http URL with nothing else in the string", () => {
  assertEquals(isBareUrl("https://example.com/post"), true);
});

Deno.test("isBareUrl: accepts a bare root domain URL with no path", () => {
  assertEquals(isBareUrl("https://example.com"), true);
  assertEquals(isBareUrl("http://example.org"), true);
});

Deno.test("isBareUrl: accepts a plain http (not https) URL", () => {
  assertEquals(isBareUrl("http://example.com/post"), true);
});

Deno.test("isBareUrl: rejects free-form text that happens to contain a URL", () => {
  assertEquals(isBareUrl("check this out: https://example.com/post"), false);
});

Deno.test("isBareUrl: rejects plain text with no scheme", () => {
  assertEquals(isBareUrl("just a note to myself"), false);
});

Deno.test("isBareUrl: rejects javascript: scheme", () => {
  assertEquals(isBareUrl("javascript:alert(1)"), false);
});

Deno.test("isBareUrl: rejects data: scheme", () => {
  assertEquals(isBareUrl("data:text/plain,hello"), false);
});

Deno.test("isBareUrl: rejects file: scheme", () => {
  assertEquals(isBareUrl("file:///etc/passwd"), false);
});

Deno.test("isBareUrl: trims surrounding whitespace before checking", () => {
  assertEquals(isBareUrl("  https://example.com/post  "), true);
});

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
  const text = "a".repeat(150);
  const result = truncateTitle(text, 20);
  assertEquals(result, "a".repeat(20) + "…");
});

Deno.test("normalizeUrl: lowercases the whole string", () => {
  assertEquals(normalizeUrl("HTTPS://Example.com/Post"), "https://example.com/post");
});

Deno.test("normalizeUrl: strips one trailing slash", () => {
  assertEquals(normalizeUrl("https://example.com/post/"), "https://example.com/post");
});

Deno.test("normalizeUrl: strips multiple trailing slashes", () => {
  assertEquals(normalizeUrl("https://example.com/post///"), "https://example.com/post");
});

Deno.test("normalizeUrl: leaves a bare host with no path untouched beyond the slash", () => {
  assertEquals(normalizeUrl("https://example.com/"), "https://example.com");
});
