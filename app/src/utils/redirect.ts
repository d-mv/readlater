// Where a sign-in may send the user back to: a path inside this app (query
// included), never another origin. `//host` and `/\host` are read by
// browsers as other origins, so they are refused like full URLs; /login is
// refused so a sign-in can't loop back to itself.
export function safeRedirect(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (!/^\/(?![/\\])/.test(value)) return null;
  if (/^\/login(?:[?#/]|$)/.test(value)) return null;
  return value;
}
