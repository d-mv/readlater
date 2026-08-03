import { assertEquals } from "jsr:@std/assert";
import { deeplApiBase, normalizeTargetLang } from "./translateLogic.ts";

Deno.test("deeplApiBase: uses the free-tier host for keys ending in :fx", () => {
  assertEquals(deeplApiBase("abc123:fx"), "https://api-free.deepl.com");
});

Deno.test("deeplApiBase: uses the pro host for keys without the :fx suffix", () => {
  assertEquals(deeplApiBase("abc123"), "https://api.deepl.com");
});

Deno.test("normalizeTargetLang: uppercases and trims", () => {
  assertEquals(normalizeTargetLang(" fr "), "FR");
});
