import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { buildBookmarklet, writeBookmarklet } from "../build";

afterEach(() => mock.restore());

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

describe("writeBookmarklet", () => {
  test("writes the built source.js to dist.txt in the output directory", () => {
    const dir = mkdtempSync(join(tmpdir(), "bookmarklet-"));
    const logged = spyOn(console, "log").mockImplementation(() => {});
    try {
      const outPath = writeBookmarklet("https://readlater.mlnkv.net", dir);

      expect(outPath).toBe(join(dir, "dist.txt"));
      const source = readFileSync(join(import.meta.dir, "../source.js"), "utf8");
      expect(readFileSync(outPath, "utf8")).toBe(
        buildBookmarklet(source, "https://readlater.mlnkv.net"),
      );
      expect(logged).toHaveBeenCalledWith(`Bookmarklet written to ${outPath}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("refuses to write without an app origin", () => {
    const dir = mkdtempSync(join(tmpdir(), "bookmarklet-"));
    try {
      expect(() => writeBookmarklet("", dir)).toThrow("APP_ORIGIN is required");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("the built bookmarklet", () => {
  test("opens the capture popup for the current page's URL and title", () => {
    const source = readFileSync(join(import.meta.dir, "../source.js"), "utf8");
    const code = decodeURIComponent(
      buildBookmarklet(source, "https://readlater.mlnkv.net").slice("javascript:".length),
    );
    const opened: unknown[][] = [];
    const window = { open: (...args: unknown[]) => void opened.push(args) };
    const location = { href: "https://example.com/post?id=1#top" };
    const document = { title: "A post & more" };

    new Function("window", "location", "document", code)(window, location, document);

    expect(opened).toHaveLength(1);
    const [url, name, features] = opened[0] as [string, string, string];
    const target = new URL(url);
    expect(target.origin + target.pathname).toBe("https://readlater.mlnkv.net/capture");
    expect(target.searchParams.get("url")).toBe(location.href);
    expect(target.searchParams.get("title")).toBe(document.title);
    expect(name).toBe("readlater-capture");
    expect(features).toBe("width=380,height=260");
  });
});
