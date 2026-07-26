import type { SupabaseClient } from "@supabase/supabase-js";

const BUCKET = "bookmark-assets";

export function makeThumbnailUploader(supabase: SupabaseClient) {
  return async function uploadThumbnail(thumbnailUrl: string): Promise<string> {
    const res = await fetch(thumbnailUrl);
    const bytes = new Uint8Array(await res.arrayBuffer());
    const contentType = res.headers.get("content-type") ?? "image/jpeg";
    const ext = contentType.split("/")[1] ?? "jpg";
    const path = `youtube/${crypto.randomUUID()}.${ext}`;

    const { error } = await supabase.storage.from(BUCKET).upload(path, bytes, { contentType });
    if (error) throw error;

    const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
    return data.publicUrl;
  };
}
