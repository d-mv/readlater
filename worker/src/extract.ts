import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import { ExtractionTimeoutError } from "./errors";

/** The parts of a Readability result the worker uses; plain data, so it can
 * cross the thread boundary. */
export interface ExtractedArticle {
  title: string | null;
  byline: string | null;
  excerpt: string | null;
  content: string | null;
  textContent: string | null;
}

const MIN_EXTRACTED_LENGTH = 200;

// Real pages take about a second even at several MB (a 3 MB Wikipedia
// article: 1.3 s). Some markup makes Readability superlinear — thousands of
// tiny nested blocks took 18 s at 0.6 MB and minutes at 2 MB — so the limit
// sits far above normal and well inside the 45 s bookmark budget.
export const EXTRACT_TIMEOUT_MS = 20_000;

/** Readability on the current thread. Synchronous: it blocks the caller for
 * as long as it runs, so the worker only calls it through extractInWorker. */
export function extractArticle(html: string, url: string): ExtractedArticle | null {
  const dom = new JSDOM(html, { url });
  const article = new Readability(dom.window.document).parse();
  if (!article || (article.textContent ?? "").trim().length < MIN_EXTRACTED_LENGTH) return null;
  return {
    title: article.title ?? null,
    byline: article.byline ?? null,
    excerpt: article.excerpt ?? null,
    content: article.content ?? null,
    textContent: article.textContent ?? null,
  };
}

export type ExtractReply =
  | { ok: true; article: ExtractedArticle | null }
  | { ok: false; message: string };

/** extractArticle on a separate thread that is terminated once it runs past
 * `timeoutMs`, so a pathological page can't freeze the poll loop, its
 * timeouts, the heartbeat or the SIGTERM drain. */
export function extractInWorker(
  html: string,
  url: string,
  {
    timeoutMs = EXTRACT_TIMEOUT_MS,
    entry = new URL("./extractWorker.ts", import.meta.url).href,
  }: { timeoutMs?: number; entry?: string } = {},
): Promise<ExtractedArticle | null> {
  const worker = new Worker(entry);
  let timer: ReturnType<typeof setTimeout> | undefined;
  return new Promise<ExtractedArticle | null>((resolve, reject) => {
    timer = setTimeout(() => reject(new ExtractionTimeoutError(timeoutMs)), timeoutMs);
    worker.onmessage = (event: MessageEvent<ExtractReply>) => {
      const reply = event.data;
      if (reply.ok) resolve(reply.article);
      else reject(new Error(reply.message));
    };
    worker.onerror = (event) => reject(new Error(event.message));
    worker.postMessage({ html, url });
  }).finally(() => {
    clearTimeout(timer);
    worker.terminate();
  });
}
