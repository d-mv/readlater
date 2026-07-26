import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import TurndownService from "turndown";
import { readingTimeFromWordCount, wordCount } from "./reading";

export type FetchHtml = (url: string) => Promise<string>;

const defaultFetchHtml: FetchHtml = (url) => fetch(url).then((res) => res.text());

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

export async function parseArticle(
  url: string,
  fetchHtml: FetchHtml = defaultFetchHtml,
  renderHtml?: FetchHtml,
): Promise<ParsedArticle> {
  const html = await fetchHtml(url);
  let article = extractArticle(html, url);

  if (!article && renderHtml) {
    const rendered = await renderHtml(url);
    article = extractArticle(rendered, url);
  }

  if (!article) {
    throw new Error(`Readability could not extract article content from ${url}`);
  }

  const rawContentMd = new TurndownService().turndown(article.content ?? "");
  const content_md = stripDuplicateTitleHeading(rawContentMd, article.title ?? null);
  const words = wordCount(content_md);

  return {
    title: article.title ?? null,
    author: article.byline ?? null,
    excerpt: article.excerpt ?? null,
    content_md,
    word_count: words,
    reading_time: readingTimeFromWordCount(words),
  };
}
