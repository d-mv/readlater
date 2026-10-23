// Mirrors the DB's generated url_normalized column
// (20261022120000_url_normalized_keeps_path_case.sql) so duplicate checks done
// in the client agree with the unique index enforced in Postgres: the scheme
// and host (everything up to the path) are lowercased — they are
// case-insensitive — while the path and query keep their case, since they
// tell pages apart (short links, video ids). Trailing slashes are stripped.
const ORIGIN = /^[^/?#]*\/\/[^/?#]*/;

export function normalizeUrl(url: string): string {
  const origin = ORIGIN.exec(url)?.[0] ?? "";
  return (origin.toLowerCase() + url.slice(origin.length)).replace(/\/+$/, "");
}
