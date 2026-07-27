export function resolveContent(converted: string, text: string): string {
  const trimmedConverted = converted.trim();
  if (trimmedConverted) return trimmedConverted;
  return text.trim();
}

// Duplicated from ../capture/captureLogic.ts rather than imported — each edge
// function is deployed independently, so cross-function relative imports
// aren't reliable across environments.
export function truncateTitle(text: string, max = 100): string {
  if (text.length <= max) return text;
  const slice = text.slice(0, max);
  const lastSpace = slice.lastIndexOf(" ");
  const cut = lastSpace > 0 ? slice.slice(0, lastSpace) : slice;
  return cut.trim() + "…";
}

// Duplicated from worker/src/reading.ts (WORDS_PER_MINUTE = 200) rather than
// imported — the worker is a separate Node runtime, not reachable from a Deno
// edge function.
const WORDS_PER_MINUTE = 200;

export function wordCount(text: string): number {
  const trimmed = text.trim();
  return trimmed.length === 0 ? 0 : trimmed.split(/\s+/).length;
}

export function readingTimeFromWordCount(words: number): number {
  return Math.max(1, Math.round(words / WORDS_PER_MINUTE));
}
