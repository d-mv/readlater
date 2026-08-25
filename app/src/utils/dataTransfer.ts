import type { Bookmark } from "../lib/supabase";
import { normalizeUrl } from "./normalizeUrl";

export const EXPORT_VERSION = 1;

export interface ExportTag {
  name: string;
  color: string;
}

// Deliberately the same shape needed for a bookmarks insert (minus id/user_id,
// which the DB and the importing account supply) plus a `tags` side channel —
// keeps the store's import step a straight destructure with no remapping.
export interface ExportBookmark {
  url: string | null;
  type: Bookmark["type"];
  status: Bookmark["status"];
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
  is_public: boolean;
  archived: boolean;
  read_at: string | null;
  error_message: string | null;
  created_at: string;
  processed_at: string | null;
  pdf_path: string | null;
  pdf_parsed: boolean;
  view_mode: Bookmark["view_mode"];
  progress: number | null;
  tags: ExportTag[];
}

export interface ExportPayload {
  version: number;
  exported_at: string;
  bookmarks: ExportBookmark[];
}

export interface SkippedRow {
  url: string | null;
  title: string | null;
  reason: string;
}

export function toExportBookmark(bookmark: Bookmark): ExportBookmark {
  return {
    url: bookmark.url,
    type: bookmark.type,
    status: bookmark.status,
    title: bookmark.title,
    author: bookmark.author,
    excerpt: bookmark.excerpt,
    content_md: bookmark.content_md,
    translated_content_md: bookmark.translated_content_md,
    translated_lang: bookmark.translated_lang,
    thumbnail_url: bookmark.thumbnail_url,
    youtube_video_id: bookmark.youtube_video_id,
    content_edited: bookmark.content_edited,
    word_count: bookmark.word_count,
    reading_time: bookmark.reading_time,
    is_public: bookmark.is_public,
    archived: bookmark.archived,
    read_at: bookmark.read_at,
    error_message: bookmark.error_message,
    created_at: bookmark.created_at,
    processed_at: bookmark.processed_at,
    pdf_path: bookmark.pdf_path,
    pdf_parsed: bookmark.pdf_parsed,
    view_mode: bookmark.view_mode,
    progress: bookmark.progress ?? 0,
    tags: bookmark.tags.map((tag) => ({ name: tag.name, color: tag.color })),
  };
}

export function buildExportPayload(bookmarks: Bookmark[]): ExportPayload {
  return {
    version: EXPORT_VERSION,
    exported_at: new Date().toISOString(),
    bookmarks: bookmarks.map(toExportBookmark),
  };
}

export class ImportPayloadError extends Error {}

export function parseExportPayload(jsonText: string): ExportPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new ImportPayloadError("That file isn't valid JSON.");
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new ImportPayloadError("That file doesn't look like a Read Later export.");
  }

  const candidate = parsed as { version?: unknown; bookmarks?: unknown };
  if (!Array.isArray(candidate.bookmarks)) {
    throw new ImportPayloadError("That file doesn't look like a Read Later export.");
  }
  if (candidate.version !== EXPORT_VERSION) {
    throw new ImportPayloadError(`Unsupported export version: ${String(candidate.version)}.`);
  }

  return parsed as ExportPayload;
}

// Mirrors the DB's unique index on url_normalized: only rows with a URL can
// collide (notes/PDFs have url = null, which the index treats as distinct
// every time), so those types always import.
export function partitionForImport(
  bookmarks: ExportBookmark[],
  existingNormalizedUrls: ReadonlySet<string>,
): { toImport: ExportBookmark[]; skipped: SkippedRow[] } {
  const toImport: ExportBookmark[] = [];
  const skipped: SkippedRow[] = [];

  for (const bookmark of bookmarks) {
    if (bookmark.url && existingNormalizedUrls.has(normalizeUrl(bookmark.url))) {
      skipped.push({ url: bookmark.url, title: bookmark.title, reason: "already exists" });
      continue;
    }
    toImport.push(bookmark);
  }

  return { toImport, skipped };
}
