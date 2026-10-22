// Thread entry for extractInWorker (extract.ts).
import { type ExtractReply, extractArticle } from "./extract";

declare const self: Worker;

self.onmessage = (event: MessageEvent<{ html: string; url: string }>) => {
  let reply: ExtractReply;
  try {
    reply = { ok: true, article: extractArticle(event.data.html, event.data.url) };
  } catch (err) {
    reply = { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
  self.postMessage(reply);
};
