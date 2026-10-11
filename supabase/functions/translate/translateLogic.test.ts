import { assertEquals } from "jsr:@std/assert";
import { chunkText, deeplApiBase, joinChunks, MAX_CHUNK_BYTES, normalizeTargetLang } from "./translateLogic.ts";

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

Deno.test("chunkText: chunks a 300 KB single-paragraph text with only \\n breaks in linear time", () => {
  const lines = Array.from({ length: 7500 }, (_, i) => `Line ${i} of extracted PDF text, padded out.`);
  const text = lines.join("\n");
  assertEquals(bytes(text) >= 300_000, true);

  const started = performance.now();
  const chunks = chunkText(text);
  const elapsed = performance.now() - started;

  assertEquals(elapsed < 1000, true, `chunking took ${elapsed}ms`);
  assertEquals(chunks.length > 1, true);
  for (const chunk of chunks) assertEquals(bytes(chunk.text) <= MAX_CHUNK_BYTES, true);
  assertEquals(joinChunks(chunks), text);
  // Cut on line breaks: no chunk starts or ends mid-line.
  for (const chunk of chunks) {
    assertEquals(chunk.text.startsWith("Line "), true);
    assertEquals(chunk.text.endsWith("padded out."), true);
  }
});

Deno.test("chunkText: reassembles a cut paragraph exactly via glue", () => {
  const text = "Intro paragraph.\n\n" +
    "First sentence here. Second one! Third? " + "more words ".repeat(40) + "\nnext line\n" +
    "x".repeat(250) + "\n\nOutro.";
  const chunks = chunkText(text, 120);

  for (const chunk of chunks) assertEquals(bytes(chunk.text) <= 120, true);
  assertEquals(joinChunks(chunks), text);
});

Deno.test("chunkText: prefers sentence ends over arbitrary whitespace", () => {
  const text = "Alpha beta gamma delta. Epsilon zeta eta theta iota kappa.";
  const chunks = chunkText(text, 40);

  assertEquals(chunks.map((c) => c.text), ["Alpha beta gamma delta.", "Epsilon zeta eta theta iota kappa."]);
  assertEquals(joinChunks(chunks), text);
});

Deno.test("chunkText: never splits a multi-byte code point", () => {
  const text = "Привет 👋🏽 мир 🌍 ".repeat(200) + "😀".repeat(300) + "ж".repeat(301);
  const chunks = chunkText(text, 101);

  assertEquals(chunks.length > 1, true);
  for (const chunk of chunks) {
    assertEquals(bytes(chunk.text) <= 101, true);
    // A lone surrogate would become U+FFFD on a UTF-8 round trip.
    assertEquals(new TextDecoder().decode(new TextEncoder().encode(chunk.text)), chunk.text);
  }
  assertEquals(joinChunks(chunks), text);
});

Deno.test("chunkText: doesn't cut words when whitespace is available", () => {
  const words = Array.from({ length: 500 }, (_, i) => `word${i}`);
  const text = words.join(" ");
  const chunks = chunkText(text, 100);

  assertEquals(chunks.length > 1, true);
  const wordSet = new Set(words);
  for (const chunk of chunks) {
    assertEquals(bytes(chunk.text) <= 100, true);
    for (const w of chunk.text.split(" ")) assertEquals(wordSet.has(w), true, `cut word: ${w}`);
  }
  assertEquals(joinChunks(chunks), text);
});

