import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import TurndownService from "turndown";
import {
  HttpStatusError,
  isTransientError,
  ResponseTooLargeError,
  UnsupportedContentTypeError,
} from "./errors";
import { MAX_HTML_BYTES, mediaType, readBodyCapped, USER_AGENT } from "./http";
import { readingTimeFromWordCount, wordCount } from "./reading";
import { assertPublicUrl, BlockedUrlError, type LookupAll } from "./urlGuard";

export type FetchHtml = (url: string) => Promise<string>;

const MAX_REDIRECTS = 5;
const FETCH_TIMEOUT_MS = 15_000;
const HTML_TYPES = new Set(["text/html", "application/xhtml+xml"]);

// Plain HTTP fetch of a page, with every hop (the URL and each redirect
// target) checked against the SSRF guard — redirects are followed by hand so
// a public URL can't bounce the worker into a private one.
export function createFetchHtml(
  deps: { fetchImpl?: typeof fetch; lookup?: LookupAll; maxRedirects?: number } = {},
): FetchHtml {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const maxRedirects = deps.maxRedirects ?? MAX_REDIRECTS;

  return async (url) => {
    // One budget for the whole redirect chain and body, not 15s per hop.
    const signal = AbortSignal.timeout(FETCH_TIMEOUT_MS);
    let current = url;
    for (let hop = 0; hop <= maxRedirects; hop++) {
      await assertPublicUrl(current, deps.lookup);
      const res = await fetchImpl(current, {
        redirect: "manual",
        signal,
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
      });
      const location = res.headers.get("location");
      if (res.status >= 300 && res.status < 400 && location) {
        await res.body?.cancel().catch(() => {});
        current = new URL(location, current).toString();
        continue;
      }
      if (!res.ok) {
        await res.body?.cancel().catch(() => {});
        throw new HttpStatusError(res.status, res.statusText);
      }
      // A missing Content-Type is let through (Readability will just find
      // nothing in a non-HTML body); a declared non-HTML one is refused before
      // its body is read.
      const type = mediaType(res);
      if (type && !HTML_TYPES.has(type)) {
        await res.body?.cancel().catch(() => {});
        throw new UnsupportedContentTypeError(type);
      }
      return new TextDecoder().decode(await readBodyCapped(res, MAX_HTML_BYTES));
    }
    throw new Error(`Too many redirects fetching ${url}`);
  };
}

const defaultFetchHtml = createFetchHtml();

export function stripDuplicateTitleHeading(markdown: string, title: string | null): string {
  if (!title) return markdown;

  const headingMatch = markdown.match(/^#{1,6}\s+(.+?)\s*\n+/);
  const headingText = headingMatch?.[1];
  if (!headingText || headingText.trim().toLowerCase() !== title.trim().toLowerCase()) {
    return markdown;
  }

  return markdown.slice(headingMatch[0].length).trimStart();
}

export interface ParsedArticle {
  title: string | null;
  author: string | null;
  excerpt: string | null;
  content_md: string;
  word_count: number;
  reading_time: number;
}

const MIN_EXTRACTED_LENGTH = 200;

function extractArticle(html: string, url: string) {
  const dom = new JSDOM(html, { url });
  const article = new Readability(dom.window.document).parse();
  const isSubstantial = (article?.textContent ?? "").trim().length >= MIN_EXTRACTED_LENGTH;
  return isSubstantial ? article : null;
}

export function createTurndownService(): TurndownService {
  const turndown = new TurndownService();

  turndown.addRule("cleanLinkedImagesAndBlocks", {
    filter: (node) => {
      if (node.nodeName !== "A") return false;
      // Turndown's DOM (domino) answers a querySelector miss with undefined,
      // not null, so compare loosely.
      return (
        node.querySelector("img") != null ||
        Array.from(node.children).some((child) =>
          ["FIGURE", "DIV", "P", "SECTION"].includes(child.nodeName),
        )
      );
    },
    replacement: (content, node) => {
      const href = (node as HTMLElement).getAttribute("href") || "";
      const title = (node as HTMLElement).getAttribute("title") || "";
      const titleAttr = title ? ` "${title}"` : "";

      const cleanContent = content.trim().replace(/\n{2,}/g, "\n");

      const imgs = (node as HTMLElement).querySelectorAll("img");
      const img = imgs[0];
      const textContent = (node as HTMLElement).textContent?.trim() || "";
      const imgAlt = imgs.length === 1 && img ? img.getAttribute("alt") || "" : "";

      if (imgs.length === 1 && img && href) {
        const src = img.getAttribute("src") || "";
        if (src && href.trim() === src.trim() && textContent === imgAlt) {
          return `\n\n![${imgAlt}](${src}${titleAttr})\n\n`;
        }
      }

      if (!cleanContent) return "";
      return `[${cleanContent}](${href}${titleAttr})`;
    },
  });

  return turndown;
}

export async function parseArticle(
  url: string,
  fetchHtml: FetchHtml = defaultFetchHtml,
  renderHtml?: FetchHtml,
): Promise<ParsedArticle> {
  let article = null;
  let fetchError: unknown = null;
  let renderError: unknown = null;

  try {
    article = extractArticle(await fetchHtml(url), url);
  } catch (err) {
    // A URL refused by the SSRF guard, a non-HTML resource or an oversized
    // page gets no second chance through the browser — rendering would hit
    // the same wall at a much higher cost. Anything else (e.g. 403 Forbidden
    // or a network error) falls through to the renderHtml fallback below.
    if (
      err instanceof BlockedUrlError ||
      err instanceof UnsupportedContentTypeError ||
      err instanceof ResponseTooLargeError
    ) {
      throw err;
    }
    fetchError = err;
  }

  if (!article && renderHtml) {
    try {
      article = extractArticle(await renderHtml(url), url);
    } catch (err) {
      renderError = err;
    }
  }

  if (!article) {
    // If either attempt failed for a reason that may clear up (an open
    // breaker, a timeout, a 5xx), surface that so the bookmark is retried
    // later instead of failed for good.
    const transient = [renderError, fetchError].find(isTransientError);
    if (transient) throw transient;
    const reason = fetchError instanceof Error ? ` (${fetchError.message})` : "";
    throw new Error(`Readability could not extract article content from ${url}${reason}`);
  }

  const rawContentMd = createTurndownService().turndown(article.content ?? "");
  const content_md = stripDuplicateTitleHeading(rawContentMd, article.title ?? null);
  const words = wordCount(content_md);

  return {
    title: article.title ? article.title.replace(/\u0000/g, "") : null,
    author: article.byline ? article.byline.replace(/\u0000/g, "") : null,
    excerpt: article.excerpt ? article.excerpt.replace(/\u0000/g, "") : null,
    content_md: content_md.replace(/\u0000/g, ""),
    word_count: words,
    reading_time: readingTimeFromWordCount(words),
  };
}
