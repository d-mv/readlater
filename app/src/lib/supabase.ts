import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!url || !publishableKey) {
  throw new Error("VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY must be set");
}

export const supabase = createClient(url, publishableKey);

export interface Tag {
  id: string;
  name: string;
  color: string;
}

export interface Bookmark {
  id: string;
  url: string | null;
  type: "article" | "youtube" | "note" | "pdf";
  status: "pending" | "processing" | "ready" | "failed";
  title: string | null;
  author: string | null;
  excerpt: string | null;
  content_md: string | null;
  translated_content_md: string | null;
  translated_lang: string | null;
  thumbnail_url: string | null;
  youtube_video_id: string | null;
  content_edited: boolean;
  word_count: number | null;
  reading_time: number | null;
  tags: Tag[];
  is_public: boolean;
  archived: boolean;
  read_at: string | null;
  error_message: string | null;
  created_at: string;
  processed_at: string | null;
  // PDF-only: path of the original file in the bookmark-pdfs storage bucket
  // (null once the user trashes it), whether text extraction succeeded, and
  // the persisted markdown/original view toggle.
  pdf_path: string | null;
  pdf_parsed: boolean;
  view_mode: "markdown" | "original" | null;
  progress?: number | null;
}

export interface DuplicateBookmark {
  existingId: string;
  existingTitle: string | null;
  existingSavedAt: string;
}

// The public-safe subset returned by the get_public_bookmark RPC — no owner
// id, storage path, url, status, or other internal columns.
export interface PublicBookmark {
  id: string;
  type: Bookmark["type"];
  title: string | null;
  author: string | null;
  excerpt: string | null;
  content_md: string | null;
  thumbnail_url: string | null;
  youtube_video_id: string | null;
  word_count: number | null;
  reading_time: number | null;
  created_at: string;
}
