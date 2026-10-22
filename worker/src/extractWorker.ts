// Thread entry for extractInWorker (extract.ts).
import { type ExtractReply, extractArticle } from "./extract";
import type { FetchedPage } from "./parseArticle";

declare const self: Worker;

self.onmessage = (event: MessageEvent<FetchedPage>) => {
  let reply: ExtractReply;
  try {
    reply = { ok: true, article: extractArticle(event.data) };
  } catch (err) {
    reply = { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
  self.postMessage(reply);
};
