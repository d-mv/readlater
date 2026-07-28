import { describe, expect, test } from "bun:test";
import { parseArticle } from "../src/parseArticle";

const FIXTURE_HTML = `
<!doctype html>
<html>
<head><title>A short history of the readability algorithm</title></head>
<body>
  <nav><a href="/">Home</a><a href="/about">About</a></nav>
  <article>
    <h1>A short history of the readability algorithm</h1>
    <p class="byline">By the Arc90 team</p>
    <p>In 2009, a small product studio named Arc90 published a bookmarklet that stripped away
    ads, navigation, and clutter from any article, leaving only the text worth reading. It was
    a small utility that solved a problem nearly everyone who read on the web at the time had
    run into: pages cluttered with sidebars, pop-ups, and unrelated links.</p>
    <p>The heuristics behind it, mostly scoring paragraphs by link density and text length,
    turned out to generalize far better than anyone expected across the messy, inconsistent
    HTML of the real web. Engineers were surprised at how well a handful of simple rules held
    up against such a chaotic corpus of markup, written by hand over more than a decade by
    people with wildly different conventions.</p>
    <p>Mozilla later adopted the same approach as the engine behind Firefox's built-in reader
    mode, where a version of it still runs today, more than a decade after the original
    bookmarklet was published, still stripping the same clutter from the same messy web.</p>
  </article>
  <footer>Copyright someone</footer>
</body>
</html>
`;

describe("parseArticle", () => {
  test("extracts title, byline, markdown content, and computed reading stats via injected fetch", async () => {
    const result = await parseArticle("https://arc90.com/readability", async () => FIXTURE_HTML);

    expect(result.title).toBe("A short history of the readability algorithm");
    expect(result.author).toContain("Arc90");
    expect(result.content_md).toContain("Arc90 published a bookmarklet");
    expect(result.content_md).not.toContain("Home");
    expect(result.content_md.startsWith("# A short history of the readability algorithm")).toBe(
      false,
    );
    expect(result.word_count).toBeGreaterThan(50);
    expect(result.reading_time).toBeGreaterThanOrEqual(1);
  });

  test("throws when the page has no extractable article content", async () => {
    const emptyHtml = "<html><body><nav>Home</nav></body></html>";
    await expect(
      parseArticle("https://example.com/empty", async () => emptyHtml),
    ).rejects.toThrow();
  });

  test("falls back to renderHtml when the plain fetch yields no extractable content", async () => {
    const shellHtml = '<html><body><div id="app"></div></body></html>';

    const result = await parseArticle(
      "https://www.perplexity.ai/search/example",
      async () => shellHtml,
      async () => FIXTURE_HTML,
    );

    expect(result.title).toBe("A short history of the readability algorithm");
    expect(result.content_md).toContain("Arc90 published a bookmarklet");
  });

  test("throws when both the plain fetch and the render fallback yield no extractable content", async () => {
    const emptyHtml = "<html><body><nav>Home</nav></body></html>";

    await expect(
      parseArticle(
        "https://example.com/empty",
        async () => emptyHtml,
        async () => emptyHtml,
      ),
    ).rejects.toThrow();
  });

  test("does not invoke renderHtml when the plain fetch already yields enough content", async () => {
    let renderCalled = false;

    await parseArticle(
      "https://arc90.com/readability",
      async () => FIXTURE_HTML,
      async () => {
        renderCalled = true;
        return FIXTURE_HTML;
      },
    );

    expect(renderCalled).toBe(false);
  });
});
