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
  type: "article" | "youtube" | "note";
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
}

export interface DuplicateBookmark {
  existingId: string;
  existingTitle: string | null;
  existingSavedAt: string;
}
