import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!url || !publishableKey) {
  throw new Error("VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY must be set");
}

// Where supabase-js keeps the session in localStorage. Set explicitly (to the
// value supabase-js would derive itself, so sessions stored before this stay
// valid) because the auth store's signOut() removes it by hand: supabase-js
// skips its own cleanup when the token refresh it tries first can't reach
// the server.
export const AUTH_STORAGE_KEY = `sb-${new URL(url).hostname.split(".")[0]}-auth-token`;

export const supabase = createClient(url, publishableKey, {
  auth: { storageKey: AUTH_STORAGE_KEY },
});

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
  // Bumped by the database on every change (incl. tag attach/detach); drives
  // the list's delta sync.
  updated_at: string;
  // PDF-only: path of the original file in the bookmark-pdfs storage bucket
  // (null once the user trashes it), whether text extraction succeeded, and
  // the persisted markdown/original view toggle.
  pdf_path: string | null;
  pdf_parsed: boolean;
  view_mode: "markdown" | "original" | null;
  progress?: number | null;
}

interface DuplicateBookmark {
  existingId: string;
  existingTitle: string | null;
  existingSavedAt: string;
}

// Result of saving a URL: an error, a duplicate (always carrying the existing
// row, whether it was found locally or via the unique index), or success.
export type AddBookmarkResult =
  | { error: string; duplicate?: undefined }
  | ({ error: null; duplicate: true } & DuplicateBookmark)
  | { error: null; duplicate?: undefined };

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
