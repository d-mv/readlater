import type { SupabaseClient } from "@supabase/supabase-js";
import { HttpStatusError, UnsupportedContentTypeError } from "./errors";
import {
  ACCEPT_ENCODING,
  MAX_IMAGE_BYTES,
  mediaType,
  RAW_BODY_INIT,
  readBodyCapped,
  USER_AGENT,
} from "./http";
import { assertPublicUrl, type LookupAll } from "./urlGuard";

const BUCKET = "bookmark-assets";

// Raster formats only: the stored object is served publicly from Storage, so
// an SVG (which can carry script) or an arbitrary "image/*" isn't accepted.
const IMAGE_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
};

export function makeThumbnailUploader(
  supabase: SupabaseClient,
  deps: { fetchImpl?: typeof fetch; lookup?: LookupAll } = {},
) {
  const fetchImpl = deps.fetchImpl ?? fetch;

  return async function uploadThumbnail(thumbnailUrl: string): Promise<string> {
    // The thumbnail URL comes from a third-party oEmbed response, so it gets
    // the same SSRF check as an article URL. Redirects are refused rather
    // than followed, since a redirect target would skip the check.
    await assertPublicUrl(thumbnailUrl, deps.lookup);
    const res = await fetchImpl(thumbnailUrl, {
      ...RAW_BODY_INIT,
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
      headers: { "User-Agent": USER_AGENT, "Accept-Encoding": ACCEPT_ENCODING },
    });
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      throw new HttpStatusError(res.status, res.statusText);
    }
    const contentType = mediaType(res);
    const ext = IMAGE_EXTENSIONS[contentType];
    if (!ext) {
      await res.body?.cancel().catch(() => {});
      throw new UnsupportedContentTypeError(contentType || "(none)");
    }
    const bytes = await readBodyCapped(res, MAX_IMAGE_BYTES);
    const path = `youtube/${crypto.randomUUID()}.${ext}`;

    // Path is a fresh UUID per upload and never overwritten, so the object is
    // immutable — cache it for a year instead of the SDK's 1-hour default to
    // avoid re-pulling the same thumbnail bytes from Supabase on every repeat
    // view once the default cache entry expires.
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(path, bytes, { contentType, cacheControl: "31536000" });
    if (error) throw error;

    const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
    return data.publicUrl;
  };
}
