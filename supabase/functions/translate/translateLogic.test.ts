import { assertEquals } from "jsr:@std/assert";
import { chunkText, deeplApiBase, joinChunks, normalizeTargetLang } from "./translateLogic.ts";

Deno.test("deeplApiBase: uses the free-tier host for keys ending in :fx", () => {
  assertEquals(deeplApiBase("abc123:fx"), "https://api-free.deepl.com");
});

Deno.test("deeplApiBase: uses the pro host for keys without the :fx suffix", () => {
  assertEquals(deeplApiBase("abc123"), "https://api.deepl.com");
});

Deno.test("normalizeTargetLang: uppercases and trims", () => {
  assertEquals(normalizeTargetLang(" fr "), "FR");
});

const bytes = (s: string) => new TextEncoder().encode(s).length;

Deno.test("chunkText: keeps text under the limit as a single chunk", () => {
  const chunks = chunkText("one\n\ntwo", 100);
  assertEquals(chunks.map((c) => c.text), ["one\n\ntwo"]);
});

Deno.test("chunkText: splits at paragraph boundaries without losing text", () => {
  const paragraphs = Array.from({ length: 30 }, (_, i) => `Paragraph ${i} ` + "word ".repeat(20));
  const text = paragraphs.join("\n\n");
  const chunks = chunkText(text, 400);

  assertEquals(chunks.length > 1, true);
  for (const chunk of chunks) assertEquals(bytes(chunk.text) <= 400, true);
  assertEquals(joinChunks(chunks.map((c) => ({ ...c }))), text);
});

Deno.test("chunkText: hard-splits a single paragraph longer than the limit", () => {
  const text = "é".repeat(500); // 2 bytes each in UTF-8
  const chunks = chunkText(text, 300);

  assertEquals(chunks.length > 1, true);
  for (const chunk of chunks) assertEquals(bytes(chunk.text) <= 300, true);
  assertEquals(joinChunks(chunks), text);
});

