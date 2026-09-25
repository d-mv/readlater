// Shared by every edge function that inserts a ready-to-read note (capture,
// snippet, file-import) and the text metrics pdf-import also needs.
// `supabase functions deploy` bundles relative imports from _shared/, so one
// definition replaces the per-function copies that had started to diverge
// (capture notes were inserted without word_count/reading_time).

// Mirrors worker/src/reading.ts — the worker is a separate runtime, so this
// one constant is still duplicated across that boundary.
const WORDS_PER_MINUTE = 200;

export function truncateTitle(text: string, max = 100): string {
  if (text.length <= max) return text;
  const slice = text.slice(0, max);
  const lastSpace = slice.lastIndexOf(" ");
  const cut = lastSpace > 0 ? slice.slice(0, lastSpace) : slice; // no space found: hard cut
  return cut.trim() + "…";
}

export function wordCount(text: string): number {
  const trimmed = text.trim();
  return trimmed.length === 0 ? 0 : trimmed.split(/\s+/).length;
}

export function readingTimeFromWordCount(words: number): number {
  return Math.max(1, Math.round(words / WORDS_PER_MINUTE));
}

export interface ReadyNoteRow {
  url: null;
  type: "note";
  status: "ready";
  title: string;
  content_md: string;
  word_count: number;
  reading_time: number;
  user_id: string | undefined;
}

// A note is written ready on insert — there is nothing for the worker to
// fetch — so the row must carry everything the list and reader show.
export function readyNoteRow(input: {
  userId: string | undefined;
  content: string;
  title?: string;
}): ReadyNoteRow {
  const words = wordCount(input.content);
  return {
    url: null,
    type: "note",
    status: "ready",
    title: truncateTitle(input.title ?? input.content),
    content_md: input.content,
    word_count: words,
    reading_time: readingTimeFromWordCount(words),
    user_id: input.userId,
  };
}
