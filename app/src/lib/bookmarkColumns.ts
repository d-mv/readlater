// Column lists for bookmark reads (PostgREST `select`).

// The list view never renders article bodies, so the list query deliberately
// omits the large text columns (content_md, translated_content_md) and the
// generated tsvector. For a personal-scale library that is the difference
// between a few hundred KB and several MB on every list load / filter change.
// The reader pulls the body via fetchOne() when an article is actually opened.
const LIST_COLUMNS = [
  "id",
  "url",
  "type",
  "status",
  "title",
  "author",
  "excerpt",
  "thumbnail_url",
  "youtube_video_id",
  "content_edited",
  "word_count",
  "reading_time",
  "is_public",
  "archived",
  "read_at",
  "error_message",
  "created_at",
  "processed_at",
  "updated_at",
  "pdf_path",
  "pdf_parsed",
  "view_mode",
  "progress",
  // Enough to drive the "translated" list badge without pulling the translation
  // text itself.
  "translated_lang",
].join(", ");
export const LIST_SELECT = `${LIST_COLUMNS}, tags(id, name, color)`;
// Everything the app uses of a row, article bodies included — for the reader
// (fetchOne), the insert paths and the export. Named columns rather than `*`:
// the generated search_vector is as large as the body and would otherwise be
// kept in memory and in the offline copy.
export const DETAIL_SELECT = `${LIST_COLUMNS}, content_md, translated_content_md, tags(id, name, color)`;
