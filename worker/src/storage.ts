import type { SupabaseClient } from "@supabase/supabase-js";

const BUCKET = "bookmark-assets";

export function makeThumbnailUploader(supabase: SupabaseClient) {
  return async function uploadThumbnail(thumbnailUrl: string): Promise<string> {
    const res = await fetch(thumbnailUrl);
    const bytes = new Uint8Array(await res.arrayBuffer());
    const contentType = res.headers.get("content-type") ?? "image/jpeg";
    const ext = contentType.split("/")[1] ?? "jpg";
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
