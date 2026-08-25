import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import TurndownService from "turndown";
import { readingTimeFromWordCount, wordCount } from "./reading";

export type FetchHtml = (url: string) => Promise<string>;

const defaultFetchHtml: FetchHtml = async (url) => {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(15_000),
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 (compatible; ReadLater/1.0)",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText}`);
  }
  return res.text();
};

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
  } catch {
    // If plain fetch failed (e.g. 403 Forbidden or network error),
    // try renderHtml fallback below before giving up.
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
