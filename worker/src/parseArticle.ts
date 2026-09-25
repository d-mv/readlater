import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import TurndownService from "turndown";
import { readingTimeFromWordCount, wordCount } from "./reading";
import { assertPublicUrl, BlockedUrlError, type LookupAll } from "./urlGuard";

export type FetchHtml = (url: string) => Promise<string>;

const MAX_REDIRECTS = 5;

// Plain HTTP fetch of a page, with every hop (the URL and each redirect
// target) checked against the SSRF guard — redirects are followed by hand so
// a public URL can't bounce the worker into a private one.
export function createFetchHtml(
  deps: { fetchImpl?: typeof fetch; lookup?: LookupAll; maxRedirects?: number } = {},
): FetchHtml {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const maxRedirects = deps.maxRedirects ?? MAX_REDIRECTS;

  return async (url) => {
    let current = url;
    for (let hop = 0; hop <= maxRedirects; hop++) {
      await assertPublicUrl(current, deps.lookup);
      const res = await fetchImpl(current, {
        redirect: "manual",
        signal: AbortSignal.timeout(15_000),
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 (compatible; ReadLater/1.0)",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
      });
      const location = res.headers.get("location");
      if (res.status >= 300 && res.status < 400 && location) {
        current = new URL(location, current).toString();
        continue;
      }
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} ${res.statusText}`);
      }
      return res.text();
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
      return (
        node.querySelector("img") !== null ||
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
  let html = "";
  let article = null;

  try {
    html = await fetchHtml(url);
    article = extractArticle(html, url);
  } catch (err) {
    // A URL refused by the SSRF guard must not get a second chance through
    // the browser. Anything else (e.g. 403 Forbidden or a network error)
    // falls through to the renderHtml fallback below.
    if (err instanceof BlockedUrlError) throw err;
  }

  if (!article && renderHtml) {
    try {
      const rendered = await renderHtml(url);
      article = extractArticle(rendered, url);
    } catch {
      // browser rendering also failed
    }
  }

  if (!article) {
    throw new Error(`Readability could not extract article content from ${url}`);
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
