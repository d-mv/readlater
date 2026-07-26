import { assertEquals } from "jsr:@std/assert";
import { detectType } from "./detectType.ts";

Deno.test("detects youtube.com/watch URLs", () => {
  assertEquals(detectType("https://www.youtube.com/watch?v=abc123"), "youtube");
});

Deno.test("detects youtu.be short URLs", () => {
  assertEquals(detectType("https://youtu.be/abc123"), "youtube");
});

Deno.test("falls back to article for everything else", () => {
  assertEquals(detectType("https://arc90.com/some-post"), "article");
});

Deno.test("does not false-positive on unrelated domains containing 'youtube'", () => {
  assertEquals(detectType("https://notyoutube.example.com/watch?v=abc"), "article");
});

Deno.test("does not false-positive on a domain that embeds 'youtube.com/watch' as a substring", () => {
  assertEquals(detectType("https://www.notyoutube.com/watch?v=abc"), "article");
});

Deno.test("detects youtube.com on subdomains like m.youtube.com", () => {
  assertEquals(detectType("https://m.youtube.com/watch?v=abc123"), "youtube");
});
