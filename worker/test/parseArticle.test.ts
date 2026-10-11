import { describe, expect, test } from "bun:test";
import { createFetchHtml, parseArticle } from "../src/parseArticle";
import { BlockedUrlError } from "../src/urlGuard";
import { CircuitBreakerOpenError } from "../src/circuitBreaker";
import { HttpStatusError, ResponseTooLargeError, UnsupportedContentTypeError } from "../src/errors";
import { MAX_HTML_BYTES } from "../src/http";

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

  test("cleans up linked images in block elements like figure or div without leaving markdown link rudiments", async () => {
    const htmlWithLinkedImage = `
<!doctype html>
<html>
<head><title>Article with linked image</title></head>
<body>
  <article>
    <h1>Article with linked image</h1>
    <p>This is a paragraph before the image that adds enough character count to pass the minimum extracted length check of 200 characters in Readability. Adding more descriptive words here to ensure it reaches two hundred characters easily.</p>
    <a href="https://example.com/image.png"><figure><img src="https://example.com/image.png" alt="Diagram"></figure></a>
    <p>This is a paragraph after the image that adds further content to the article to make sure everything parses nicely.</p>
  </article>
</body>
</html>
`;
    const result = await parseArticle(
      "https://example.com/linked-img",
      async () => htmlWithLinkedImage,
    );
    expect(result.content_md).toContain("![Diagram](https://example.com/image.png)");
    expect(result.content_md).not.toContain("[\n");
    expect(result.content_md).not.toContain("\n]");
  });

  test("falls back to renderHtml when fetchHtml throws (e.g. 403 Forbidden)", async () => {
    const result = await parseArticle(
      "https://example.com/blocked",
      async () => {
        throw new Error("HTTP 403 Forbidden");
      },
      async () => FIXTURE_HTML,
    );

    expect(result.title).toBe("A short history of the readability algorithm");
    expect(result.content_md).toContain("Arc90 published a bookmarklet");
  });

  test("strips null bytes from article output", async () => {
    const htmlWithNulls = FIXTURE_HTML.replace("Arc90", "Arc\u000090");
    const result = await parseArticle("https://example.com/nulls", async () => htmlWithNulls);

    expect(result.author).not.toContain("\u0000");
    expect(result.content_md).not.toContain("\u0000");
  });

  test("does not fall back to the browser for a URL blocked as private", async () => {
    let rendered = 0;
    await expect(
      parseArticle(
        "http://169.254.169.254/",
        async () => {
          throw new BlockedUrlError("private address");
        },
        async () => {
          rendered += 1;
          return FIXTURE_HTML;
        },
      ),
    ).rejects.toBeInstanceOf(BlockedUrlError);
    expect(rendered).toBe(0);
  });

  test.each([
    ["a non-HTML resource", new UnsupportedContentTypeError("application/pdf")],
    ["an oversized page", new ResponseTooLargeError(MAX_HTML_BYTES)],
  ])("does not fall back to the browser for %s", async (_label, error) => {
    let rendered = 0;
    await expect(
      parseArticle(
        "https://example.com/file",
        async () => {
          throw error;
        },
        async () => {
          rendered += 1;
          return FIXTURE_HTML;
        },
      ),
    ).rejects.toBe(error);
    expect(rendered).toBe(0);
  });

  test("surfaces an open browser breaker (transient) instead of a generic extraction failure", async () => {
    const open = new CircuitBreakerOpenError("playwright-browser", 10_000);
    await expect(
      parseArticle(
        "https://example.com/spa",
        async () => '<html><body><div id="app"></div></body></html>',
        async () => {
          throw open;
        },
      ),
    ).rejects.toBe(open);
  });

  test("surfaces a 5xx from the plain fetch when the fallback can't help either", async () => {
    await expect(
      parseArticle(
        "https://example.com/down",
        async () => {
          throw new HttpStatusError(503, "Service Unavailable");
        },
        async () => "<html><body><nav>Home</nav></body></html>",
      ),
    ).rejects.toBeInstanceOf(HttpStatusError);
  });

  test("a 404 with nothing extractable fails with the status in the message", async () => {
    await expect(
      parseArticle(
        "https://example.com/gone",
        async () => {
          throw new HttpStatusError(404, "Not Found");
        },
        async () => "<html><body><nav>Home</nav></body></html>",
      ),
    ).rejects.toThrow(/could not extract.*HTTP 404 Not Found/);
  });
});

describe("createFetchHtml", () => {
  const publicDns = async () => ["93.184.216.34"];

  test("rejects a non-HTML content type without reading the body", async () => {
    const fetchImpl = (async () =>
      new Response("%PDF-1.7", {
        headers: { "content-type": "application/pdf" },
      })) as unknown as typeof fetch;

    await expect(
      createFetchHtml({ fetchImpl, lookup: publicDns })("https://example.com/paper.pdf"),
    ).rejects.toBeInstanceOf(UnsupportedContentTypeError);
  });

  test("accepts HTML with a charset parameter, and a response with no content type", async () => {
    const withCharset = (async () =>
      new Response("<html>a</html>", {
        headers: { "content-type": "text/html; charset=utf-8" },
      })) as unknown as typeof fetch;
    const untyped = (async () =>
      new Response(new Blob(["<html>b</html>"]).stream())) as unknown as typeof fetch;

    expect(
      await createFetchHtml({ fetchImpl: withCharset, lookup: publicDns })("https://example.com/"),
    ).toBe("<html>a</html>");
    expect(
      await createFetchHtml({ fetchImpl: untyped, lookup: publicDns })("https://example.com/"),
    ).toBe("<html>b</html>");
  });

  test("rejects a body that streams past the size cap", async () => {
    let pulled = 0;
    const chunk = new Uint8Array(1024 * 1024);
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        controller.enqueue(chunk);
      },
    });
    const fetchImpl = (async () =>
      new Response(endless, {
        headers: { "content-type": "text/html" },
      })) as unknown as typeof fetch;

    await expect(
      createFetchHtml({ fetchImpl, lookup: publicDns })("https://example.com/huge"),
    ).rejects.toBeInstanceOf(ResponseTooLargeError);
    // Stopped right after crossing 5 MB rather than reading forever.
    expect(pulled).toBeLessThanOrEqual(7);
  });

  test("rejects a declared Content-Length over the cap up front", async () => {
    const fetchImpl = (async () =>
      new Response("<html></html>", {
        headers: { "content-type": "text/html", "content-length": String(MAX_HTML_BYTES + 1) },
      })) as unknown as typeof fetch;

    await expect(
      createFetchHtml({ fetchImpl, lookup: publicDns })("https://example.com/huge"),
    ).rejects.toBeInstanceOf(ResponseTooLargeError);
  });

  test("throws an HttpStatusError carrying the status for a non-2xx response", async () => {
    const fetchImpl = (async () =>
      new Response("busy", {
        status: 503,
        statusText: "Service Unavailable",
      })) as unknown as typeof fetch;

    const err = await createFetchHtml({ fetchImpl, lookup: publicDns })(
      "https://example.com/",
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpStatusError);
    expect((err as HttpStatusError).status).toBe(503);
  });

  test("follows a redirect to another public URL", async () => {
    const requested: string[] = [];
    const fetchImpl = (async (url: string) => {
      requested.push(url);
      if (url === "https://example.com/a") {
        return new Response(null, { status: 301, headers: { location: "/b" } });
      }
      return new Response("<html>ok</html>", { status: 200 });
    }) as unknown as typeof fetch;

    const html = await createFetchHtml({ fetchImpl, lookup: publicDns })("https://example.com/a");

    expect(html).toBe("<html>ok</html>");
    expect(requested).toEqual(["https://example.com/a", "https://example.com/b"]);
  });

  test("refuses to follow a redirect into a private address", async () => {
    const requested: string[] = [];
    const fetchImpl = (async (url: string) => {
      requested.push(url);
      return new Response(null, {
        status: 302,
        headers: { location: "http://169.254.169.254/latest/meta-data/" },
      });
    }) as unknown as typeof fetch;

    await expect(
      createFetchHtml({ fetchImpl, lookup: publicDns })("https://example.com/a"),
    ).rejects.toBeInstanceOf(BlockedUrlError);
    expect(requested).toEqual(["https://example.com/a"]);
  });

  test("never requests a URL whose host resolves to a private address", async () => {
    let requests = 0;
    const fetchImpl = (async () => {
      requests += 1;
      return new Response("x");
    }) as unknown as typeof fetch;

    await expect(
      createFetchHtml({ fetchImpl, lookup: async () => ["127.0.0.1"] })("http://localhost/"),
    ).rejects.toBeInstanceOf(BlockedUrlError);
    expect(requests).toBe(0);
  });

  test("gives up after too many redirects", async () => {
    const fetchImpl = (async () =>
      new Response(null, {
        status: 302,
        headers: { location: "https://example.com/loop" },
      })) as unknown as typeof fetch;

    await expect(
      createFetchHtml({ fetchImpl, lookup: publicDns, maxRedirects: 3 })("https://example.com/"),
    ).rejects.toThrow(/redirects/);
  });
});
