import { describe, expect, test } from "bun:test";
import {
  createFetchHtml,
  type FetchedPage,
  htmlContentType,
  parseArticle,
} from "../src/parseArticle";
import { BlockedUrlError } from "../src/urlGuard";
import { CircuitBreakerOpenError } from "../src/circuitBreaker";
import {
  ExtractionTimeoutError,
  HttpStatusError,
  ResponseTooLargeError,
  UnsupportedContentTypeError,
} from "../src/errors";
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

/** A page as a fetcher hands it over: already-decoded text by default. */
const page = (html: string, url = "https://example.com/"): FetchedPage => ({
  body: html,
  contentType: "text/html",
  url,
});

/** A fetched body as text (createFetchHtml hands over raw bytes). */
const text = (fetched: FetchedPage) =>
  typeof fetched.body === "string" ? fetched.body : new TextDecoder().decode(fetched.body);

describe("parseArticle", () => {
  test("extracts title, byline, markdown content, and computed reading stats via injected fetch", async () => {
    const result = await parseArticle("https://arc90.com/readability", async () =>
      page(FIXTURE_HTML),
    );

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
      parseArticle("https://example.com/empty", async () => page(emptyHtml)),
    ).rejects.toThrow();
  });

  test("falls back to renderHtml when the plain fetch yields no extractable content", async () => {
    const shellHtml = '<html><body><div id="app"></div></body></html>';

    const result = await parseArticle(
      "https://www.perplexity.ai/search/example",
      async () => page(shellHtml),
      async () => page(FIXTURE_HTML),
    );

    expect(result.title).toBe("A short history of the readability algorithm");
    expect(result.content_md).toContain("Arc90 published a bookmarklet");
  });

  test("throws when both the plain fetch and the render fallback yield no extractable content", async () => {
    const emptyHtml = "<html><body><nav>Home</nav></body></html>";

    await expect(
      parseArticle(
        "https://example.com/empty",
        async () => page(emptyHtml),
        async () => page(emptyHtml),
      ),
    ).rejects.toThrow();
  });

  test("does not invoke renderHtml when the plain fetch already yields enough content", async () => {
    let renderCalled = false;

    await parseArticle(
      "https://arc90.com/readability",
      async () => page(FIXTURE_HTML),
      async () => {
        renderCalled = true;
        return page(FIXTURE_HTML);
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
    const result = await parseArticle("https://example.com/linked-img", async () =>
      page(htmlWithLinkedImage),
    );
    expect(result.content_md).toContain("![Diagram](https://example.com/image.png)");
    expect(result.content_md).not.toContain("[![");
    expect(result.content_md).not.toContain("[\n");
    expect(result.content_md).not.toContain("\n]");
  });

  test("turns a link wrapping block elements into a plain markdown link, keeping its title", async () => {
    const html = `
<!doctype html>
<html>
<head><title>Article with a linked card</title></head>
<body>
  <article>
    <h1>Article with a linked card</h1>
    <p>This is a paragraph before the card that adds enough character count to pass the minimum extracted length check of 200 characters in Readability. Adding more descriptive words here to ensure it reaches two hundred characters easily.</p>
    <a href="https://example.com/next" title="Next part"><div><p>Read the next part</p><p>of the series</p></div></a>
    <p>This is a paragraph after the card that adds further content to the article to make sure everything parses nicely.</p>
  </article>
</body>
</html>
`;
    const result = await parseArticle("https://example.com/card", async () => page(html));

    expect(result.content_md).toContain(
      '[Read the next part\nof the series](https://example.com/next "Next part")',
    );
  });

  test("keeps the text of an anchor without an href instead of an empty link", async () => {
    const html = FIXTURE_HTML.replace(
      '<p class="byline">',
      '<p>See <a name="ref">the reference</a> below.</p><p class="byline">',
    );
    const result = await parseArticle("https://example.com/anchor", async () => page(html));

    expect(result.content_md).toContain("See the reference below.");
    expect(result.content_md).not.toContain("]()");
  });

  test("unwraps an image that only links to its own file", async () => {
    const html = `
<!doctype html>
<html>
<head><title>Article with a self-linked image</title></head>
<body>
  <article>
    <h1>Article with a self-linked image</h1>
    <p>This is a paragraph before the image that adds enough character count to pass the minimum extracted length check of 200 characters in Readability. Adding more descriptive words here to ensure it reaches two hundred characters easily.</p>
    <p><a href="https://example.com/photo.jpg" title="Full size"><img src="https://example.com/photo.jpg" alt=""></a></p>
    <p>This is a paragraph after the image that adds further content to the article to make sure everything parses nicely.</p>
  </article>
</body>
</html>
`;
    const result = await parseArticle("https://example.com/self-linked", async () => page(html));

    expect(result.content_md).toContain('![](https://example.com/photo.jpg "Full size")');
    expect(result.content_md).not.toContain("[![");
  });

  test("unwraps a self-linked image that has alt text", async () => {
    const html = FIXTURE_HTML.replace(
      '<p class="byline">',
      '<p><a href="https://example.com/chart.png"><img src="https://example.com/chart.png" alt="Chart"></a></p><p class="byline">',
    );
    const result = await parseArticle("https://example.com/alt-linked", async () => page(html));

    expect(result.content_md).toContain("![Chart](https://example.com/chart.png)");
    expect(result.content_md).not.toContain("[![");
  });

  test("keeps the link when it holds text besides its own image", async () => {
    const html = FIXTURE_HTML.replace(
      '<p class="byline">',
      '<p><a href="https://example.com/chart.png"><img src="https://example.com/chart.png" alt="Chart"> full size</a></p><p class="byline">',
    );
    const result = await parseArticle("https://example.com/captioned", async () => page(html));

    expect(result.content_md).toContain(
      "[![Chart](https://example.com/chart.png) full size](https://example.com/chart.png)",
    );
  });

  test("leaves ordinary text links to Turndown, which escapes their destination and title", async () => {
    const html = `
<!doctype html>
<html>
<head><title>Article with a tricky link</title></head>
<body>
  <article>
    <h1>Article with a tricky link</h1>
    <p>This is a paragraph that adds enough character count to pass the minimum extracted length check of 200 characters in Readability, with <a href="https://example.com/a)b" title='Say "hi"'>a tricky link</a> in the middle of it. More words follow to be safe.</p>
    <p>This is a paragraph after the link that adds further content to the article to make sure everything parses nicely.</p>
  </article>
</body>
</html>
`;
    const result = await parseArticle("https://example.com/tricky", async () => page(html));

    expect(result.content_md).toContain(
      '[a tricky link](https://example.com/a\\)b "Say \\"hi\\"")',
    );
  });

  test("falls back to renderHtml when fetchHtml throws (e.g. 403 Forbidden)", async () => {
    const result = await parseArticle(
      "https://example.com/blocked",
      async () => {
        throw new Error("HTTP 403 Forbidden");
      },
      async () => page(FIXTURE_HTML),
    );

    expect(result.title).toBe("A short history of the readability algorithm");
    expect(result.content_md).toContain("Arc90 published a bookmarklet");
  });

  test("strips null bytes from article output", async () => {
    const htmlWithNulls = FIXTURE_HTML.replace("Arc90", "Arc\u000090");
    const result = await parseArticle("https://example.com/nulls", async () => page(htmlWithNulls));

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
          return page(FIXTURE_HTML);
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
          return page(FIXTURE_HTML);
        },
      ),
    ).rejects.toBe(error);
    expect(rendered).toBe(0);
  });

  test("does not render a page whose extraction timed out — the browser would hit the same wall", async () => {
    let rendered = 0;
    const timeout = new ExtractionTimeoutError(20_000);
    await expect(
      parseArticle(
        "https://example.com/huge",
        async () => page(FIXTURE_HTML),
        async () => {
          rendered += 1;
          return page(FIXTURE_HTML);
        },
        async () => {
          throw timeout;
        },
      ),
    ).rejects.toBe(timeout);
    expect(rendered).toBe(0);
  });

  test("surfaces an open browser breaker (transient) instead of a generic extraction failure", async () => {
    const open = new CircuitBreakerOpenError("playwright-browser", 10_000);
    await expect(
      parseArticle(
        "https://example.com/spa",
        async () => page('<html><body><div id="app"></div></body></html>'),
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
        async () => page("<html><body><nav>Home</nav></body></html>"),
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
        async () => page("<html><body><nav>Home</nav></body></html>"),
      ),
    ).rejects.toThrow(/could not extract.*HTTP 404 Not Found/);
  });
});

describe("parseArticle: decoding and URLs", () => {
  const body = (title: string, paragraph: string, extraHead = "") =>
    `<!doctype html><html><head>${extraHead}<title>${title}</title></head><body><article><h1>${title}</h1><p>${paragraph.repeat(6)}</p><p><img src="/media/pic.jpg" alt="Pic"> <a href="next.html">next</a></p></article></body></html>`;

  test("decodes a windows-1251 page by its Content-Type charset", async () => {
    // "Привет, мир. " in windows-1251, which Bun's TextDecoder can't decode.
    const cp1251 = [0xcf, 0xf0, 0xe8, 0xe2, 0xe5, 0xf2, 0x2c, 0x20, 0xec, 0xe8, 0xf0, 0x2e, 0x20];
    const [before, after] = body("T", "@@").split("@@".repeat(6));
    const enc = new TextEncoder();
    const bytes = new Uint8Array([
      ...enc.encode(before),
      ...Array.from({ length: 30 }, () => cp1251).flat(),
      ...enc.encode(after),
    ]);

    const result = await parseArticle("https://example.ru/", async () => ({
      body: bytes,
      contentType: "text/html; charset=windows-1251",
      url: "https://example.ru/",
    }));

    expect(result.content_md).toContain("Привет, мир.");
    expect(result.content_md).not.toContain("\uFFFD");
  });

  test("resolves relative links and images against the final URL, not the saved one", async () => {
    const html = body("Redirected", "Long enough paragraph text for Readability to keep it. ");

    const result = await parseArticle("https://t.co/abc", async () =>
      page(html, "https://blog.example/posts/one/"),
    );

    expect(result.content_md).toContain("https://blog.example/media/pic.jpg");
    expect(result.content_md).toContain("https://blog.example/posts/one/next.html");
    expect(result.content_md).not.toContain("t.co");
  });
});

describe("htmlContentType", () => {
  const bytes = (html: string) => new TextEncoder().encode(html);

  test("keeps a declared charset", () => {
    expect(htmlContentType("text/html; charset=Shift_JIS", bytes("<p>x</p>"))).toBe(
      "text/html; charset=Shift_JIS",
    );
  });

  test("leaves a <meta charset> for JSDOM to find", () => {
    expect(htmlContentType("text/html", bytes('<meta charset="koi8-r"><p>x</p>'))).toBe(
      "text/html",
    );
    expect(
      htmlContentType(
        null,
        bytes('<meta http-equiv="Content-Type" content="text/html; charset=iso-8859-2">'),
      ),
    ).toBe("text/html");
  });

  test("defaults an undeclared page to UTF-8", () => {
    expect(htmlContentType("text/html", bytes("<p>x</p>"))).toBe("text/html; charset=utf-8");
    expect(htmlContentType(null, bytes("<p>x</p>"))).toBe("text/html; charset=utf-8");
  });
});

describe("createFetchHtml", () => {
  const publicDns = async () => ["93.184.216.34"];

  test("hands over the raw bytes, the Content-Type to decode them by and the final URL", async () => {
    const fetchImpl = (async (url: string) =>
      url === "https://t.co/x"
        ? new Response(null, { status: 301, headers: { location: "https://blog.example/post" } })
        : new Response("<html>é</html>", {
            headers: { "content-type": "text/html; charset=utf-8" },
          })) as unknown as typeof fetch;

    const fetched = await createFetchHtml({ fetchImpl, lookup: publicDns })("https://t.co/x");

    expect(fetched.body).toBeInstanceOf(Uint8Array);
    expect(text(fetched)).toBe("<html>é</html>");
    expect(fetched.contentType).toBe("text/html; charset=utf-8");
    expect(fetched.url).toBe("https://blog.example/post");
  });

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
      text(
        await createFetchHtml({ fetchImpl: withCharset, lookup: publicDns })(
          "https://example.com/",
        ),
      ),
    ).toBe("<html>a</html>");
    expect(
      text(
        await createFetchHtml({ fetchImpl: untyped, lookup: publicDns })("https://example.com/"),
      ),
    ).toBe("<html>b</html>");
  });

  test("asks for the raw body (no automatic decompression) and offers only gzip/deflate", async () => {
    const calls: RequestInit[] = [];
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      calls.push(init);
      return new Response(Bun.gzipSync(new TextEncoder().encode("<html>z</html>")), {
        headers: { "content-type": "text/html", "content-encoding": "gzip" },
      });
    }) as unknown as typeof fetch;

    expect(
      text(await createFetchHtml({ fetchImpl, lookup: publicDns })("https://example.com/")),
    ).toBe("<html>z</html>");
    expect(calls[0]).toMatchObject({
      decompress: false,
      headers: { "Accept-Encoding": "gzip, deflate" },
    });
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

    const html = text(
      await createFetchHtml({ fetchImpl, lookup: publicDns })("https://example.com/a"),
    );

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

  describe("discards an unused body even when cancelling it fails", () => {
    /** A body whose cancel() rejects, like a connection that already broke. */
    const body = () =>
      new ReadableStream<Uint8Array>({
        cancel() {
          throw new Error("cancel failed");
        },
      });

    test("on a redirect", async () => {
      const fetchImpl = (async (url: string) =>
        url.endsWith("/a")
          ? new Response(body(), { status: 302, headers: { location: "/b" } })
          : new Response("<html>ok</html>")) as unknown as typeof fetch;

      expect(
        text(await createFetchHtml({ fetchImpl, lookup: publicDns })("https://example.com/a")),
      ).toBe("<html>ok</html>");
    });

    test("on a non-2xx response", async () => {
      const fetchImpl = (async () =>
        new Response(body(), { status: 500 })) as unknown as typeof fetch;

      await expect(
        createFetchHtml({ fetchImpl, lookup: publicDns })("https://example.com/"),
      ).rejects.toBeInstanceOf(HttpStatusError);
    });

    test("on a non-HTML response", async () => {
      const fetchImpl = (async () =>
        new Response(body(), {
          headers: { "content-type": "image/png" },
        })) as unknown as typeof fetch;

      await expect(
        createFetchHtml({ fetchImpl, lookup: publicDns })("https://example.com/"),
      ).rejects.toBeInstanceOf(UnsupportedContentTypeError);
    });
  });
});
