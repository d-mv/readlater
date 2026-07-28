import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { buildBookmarklet } from "../build";

describe("buildBookmarklet", () => {
  test("substitutes the app origin, then wraps as a javascript: URI", () => {
    const source = "window.open('__APP_ORIGIN__/capture?url=x');";
    const result = buildBookmarklet(source, "https://readlater.mlnkv.net");

    expect(result.startsWith("javascript:")).toBe(true);
    const decoded = decodeURIComponent(result.slice("javascript:".length));
    expect(decoded).toContain("https://readlater.mlnkv.net/capture?url=x");
    expect(decoded).not.toContain("__APP_ORIGIN__");
  });

  test("throws when the app origin is missing", () => {
    expect(() => buildBookmarklet("src", "")).toThrow();
  });

  test("does not blow up reserved URL characters like encodeURIComponent would", () => {
    const source = "window.open('__APP_ORIGIN__/capture');";
    const result = buildBookmarklet(source, "https://readlater.mlnkv.net");

    // encodeURI (unlike encodeURIComponent) leaves ":" and "/" unescaped —
    // that's what keeps URL-shaped strings from tripling in size.
    expect(result).toContain("https://readlater.mlnkv.net/capture");
  });

  test("escapes '#' so a stored bookmark URL can't get truncated at a fragment", () => {
    const result = buildBookmarklet("const c = '#fff';", "https://readlater.mlnkv.net");

    expect(result).not.toContain("#");
    expect(decodeURIComponent(result.slice("javascript:".length))).toContain("#fff");
  });

  test("collapses whitespace outside of string literals but preserves it inside", () => {
    const source = "const  x  =  'a b';\n\nconst y = 1;";
    const decoded = decodeURIComponent(
      buildBookmarklet(source, "https://readlater.mlnkv.net").slice("javascript:".length),
    );

    expect(decoded).toBe("const x='a b';const y=1;");
  });

  test("the real bookmarklet build stays well under the ~2048-char bookmark URL limit", () => {
    const source = readFileSync(join(import.meta.dir, "../source.js"), "utf8");
    const result = buildBookmarklet(source, "https://readlater.mlnkv.net");

    expect(result.length).toBeLessThan(2048);
  });
});
