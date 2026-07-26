const ALLOWED_SCHEMES = new Set(["http:", "https:"]);

// Mirrors supabase/functions/capture/captureLogic.ts — same rules, duplicated
// rather than shared since one runs under Deno and the other under Vite/browser.
export function isBareUrl(s: string): boolean {
  const t = s.trim();
  try {
    const parsed = new URL(t);
    return t === parsed.toString() && ALLOWED_SCHEMES.has(parsed.protocol);
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
