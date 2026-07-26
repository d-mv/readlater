import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!url || !publishableKey) {
  throw new Error("VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY must be set");
}

export const supabase = createClient(url, publishableKey);

export interface Bookmark {
  id: string;
  url: string;
  type: "article" | "youtube";
  status: "pending" | "processing" | "ready" | "failed";
  title: string | null;
  author: string | null;
  excerpt: string | null;
  content_md: string | null;
  thumbnail_url: string | null;
  word_count: number | null;
  reading_time: number | null;
  tags: string[];
  archived: boolean;
  read_at: string | null;
  error_message: string | null;
  created_at: string;
  processed_at: string | null;
}
