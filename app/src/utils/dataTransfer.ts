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

export interface ParsedImport {
  bookmarks: ExportBookmark[];
  // Rows that don't match the export shape — reported, never inserted.
  invalid: SkippedRow[];
}

const BOOKMARK_TYPES: readonly Bookmark["type"][] = ["article", "youtube", "note", "pdf"];
const BOOKMARK_STATUSES: readonly Bookmark["status"][] = [
  "pending",
  "processing",
  "ready",
  "failed",
];
const VIEW_MODES: readonly NonNullable<Bookmark["view_mode"]>[] = ["markdown", "original"];

const NULLABLE_STRING_FIELDS = [
  "title",
  "author",
  "excerpt",
  "content_md",
  "translated_content_md",
  "translated_lang",
  "thumbnail_url",
  "youtube_video_id",
  "read_at",
  "error_message",
  "processed_at",
  "pdf_path",
] as const;
const NULLABLE_NUMBER_FIELDS = ["word_count", "reading_time"] as const;
const BOOLEAN_FIELDS = ["content_edited", "is_public", "archived", "pdf_parsed"] as const;

class InvalidRow extends Error {}

function nullableString(row: Record<string, unknown>, key: string): string | null {
  const value = row[key];
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw new InvalidRow(`${key} must be text`);
  return value;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], key: string): T {
  if (typeof value === "string" && (allowed as readonly string[]).includes(value))
    return value as T;
  throw new InvalidRow(`unknown ${key}`);
}

function parseTags(value: unknown): ExportTag[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new InvalidRow("tags must be a list");
  return value.map((tag) => {
    const name = (tag as { name?: unknown } | null)?.name;
    const color = (tag as { color?: unknown } | null)?.color;
    if (typeof name !== "string" || name.trim() === "") throw new InvalidRow("tag without a name");
    return { name, color: typeof color === "string" ? color : "#888888" };
  });
}

// Rebuilds one row from the fields the export actually defines, so unknown
// keys (id, user_id, url_normalized, …) never reach the insert, missing
// optional fields get the DB's defaults, and a wrong-typed value rejects just
// that row instead of the whole batch.
function parseExportBookmark(raw: unknown): ExportBookmark {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new InvalidRow("not an object");
  }
  const row = raw as Record<string, unknown>;

  const type = oneOf(row.type, BOOKMARK_TYPES, "type");
  const url = nullableString(row, "url");
  if (url === null && type !== "note" && type !== "pdf") throw new InvalidRow("missing url");

  const strings = Object.fromEntries(
    NULLABLE_STRING_FIELDS.map((key) => [key, nullableString(row, key)]),
  ) as Record<(typeof NULLABLE_STRING_FIELDS)[number], string | null>;

  const numbers = Object.fromEntries(
    NULLABLE_NUMBER_FIELDS.map((key) => {
      const value = row[key];
      if (value === undefined || value === null) return [key, null];
      if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new InvalidRow(`${key} must be a number`);
      }
      return [key, value];
    }),
  ) as Record<(typeof NULLABLE_NUMBER_FIELDS)[number], number | null>;

  const booleans = Object.fromEntries(
    BOOLEAN_FIELDS.map((key) => {
      const value = row[key];
      if (value === undefined || value === null) return [key, false];
      if (typeof value !== "boolean") throw new InvalidRow(`${key} must be true/false`);
      return [key, value];
    }),
  ) as Record<(typeof BOOLEAN_FIELDS)[number], boolean>;

  const progress = row.progress ?? 0;
  if (typeof progress !== "number" || !Number.isFinite(progress)) {
    throw new InvalidRow("progress must be a number");
  }

  return {
    url,
    type,
    status: oneOf(row.status, BOOKMARK_STATUSES, "status"),
    ...strings,
    ...numbers,
    ...booleans,
    view_mode: row.view_mode == null ? null : oneOf(row.view_mode, VIEW_MODES, "view_mode"),
    progress,
    created_at: nullableString(row, "created_at") ?? new Date().toISOString(),
    tags: parseTags(row.tags),
  };
}

export function parseExportPayload(jsonText: string): ParsedImport {
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

  const bookmarks: ExportBookmark[] = [];
  const invalid: SkippedRow[] = [];
  for (const raw of candidate.bookmarks) {
    try {
      bookmarks.push(parseExportBookmark(raw));
    } catch (err) {
      if (!(err instanceof InvalidRow)) throw err;
      const row = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
      invalid.push({
        url: typeof row.url === "string" ? row.url : null,
        title: typeof row.title === "string" ? row.title : null,
        reason: `invalid row: ${err.message}`,
      });
    }
  }
  return { bookmarks, invalid };
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
