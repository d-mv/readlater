import type { AddBookmarkResult } from "../lib/supabase";

const ALLOWED_SCHEMES = new Set(["http:", "https:"]);

// Mirrors supabase/functions/capture/captureLogic.ts — same rules, duplicated
// rather than shared since one runs under Deno and the other under Vite/browser.
export function isBareUrl(s: string): boolean {
  const t = s.trim();
  try {
    const parsed = new URL(t);
    if (!ALLOWED_SCHEMES.has(parsed.protocol)) return false;
    return t === parsed.toString() || `${t}/` === parsed.toString();
  } catch {
    return false;
  }
}

export function truncateTitle(text: string, max = 100): string {
  if (text.length <= max) return text;
  const slice = text.slice(0, max);
  const lastSpace = slice.lastIndexOf(" ");
  const cut = lastSpace > 0 ? slice.slice(0, lastSpace) : slice;
  return cut.trim() + "…";
}

// What a capture screen (bookmarklet popup, share target) shows after trying
// to save a URL. A duplicate always carries the row it duplicates, so the
// "save again" prompt can refresh it — never a silent "Saved".
export type CaptureOutcome =
  | { kind: "working" }
  | { kind: "saved" }
  | { kind: "error"; message: string }
  | { kind: "duplicate"; id: string; savedAt: string };

export function toCaptureOutcome(result: AddBookmarkResult): CaptureOutcome {
  if (result.error !== null) return { kind: "error", message: result.error };
  if (result.duplicate) {
    return { kind: "duplicate", id: result.existingId, savedAt: result.existingSavedAt };
  }
  return { kind: "saved" };
}
