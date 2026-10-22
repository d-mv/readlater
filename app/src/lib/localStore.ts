// localStorage for per-device preferences. It throws when the browser blocks
// site data (and in some private modes); a preference that can't be read or
// saved just falls back to its default for this visit instead of breaking
// the component that asked.
export function readLocal(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeLocal(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {}
}
