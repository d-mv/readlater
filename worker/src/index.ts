import { createClient } from "@supabase/supabase-js";
import { parseArticle } from "./parseArticle";
import { parseYoutube } from "./parseYoutube";
import { fetchMeta } from "./youtubeMeta";
import { makeThumbnailUploader } from "./storage";
import { renderWithBrowser } from "./browserRender";

const POLL_INTERVAL_MS = 15_000;
const BATCH_SIZE = 5;
const ERROR_MESSAGE_MAX_LENGTH = 500;

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!);
const uploadThumbnail = makeThumbnailUploader(supabase);

interface Bookmark {
  id: string;
  url: string;
  type: "article" | "youtube";
}

async function processBookmark(bookmark: Bookmark) {
  await supabase.from("bookmarks").update({ status: "processing" }).eq("id", bookmark.id);

  try {
    const result =
      bookmark.type === "youtube"
        ? await parseYoutube(bookmark.url, { fetchMeta, uploadThumbnail })
        : await parseArticle(bookmark.url, undefined, renderWithBrowser);

    await supabase
      .from("bookmarks")
      .update({ ...result, status: "ready", processed_at: new Date().toISOString() })
      .eq("id", bookmark.id);
  } catch (err) {
    await supabase
      .from("bookmarks")
      .update({
        status: "failed",
        error_message: String(err).slice(0, ERROR_MESSAGE_MAX_LENGTH),
      })
      .eq("id", bookmark.id);
  }
}

async function pollOnce() {
  const { data: pending } = await supabase
    .from("bookmarks")
    .select("id, url, type")
    .eq("status", "pending")
    .limit(BATCH_SIZE);

  for (const bookmark of pending ?? []) {
    await processBookmark(bookmark);
  }
}

setInterval(() => {
  pollOnce().catch((err) => console.error("poll cycle failed", err));
}, POLL_INTERVAL_MS);

console.log(`worker started, polling every ${POLL_INTERVAL_MS / 1000}s`);
