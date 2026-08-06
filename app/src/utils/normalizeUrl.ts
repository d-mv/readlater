// Mirrors the DB's generated url_normalized column (bookmarks_url_normalization
// migration) so duplicate checks done in the client agree with the unique
// index enforced in Postgres.
export function normalizeUrl(url: string): string {
  return url.toLowerCase().replace(/\/+$/, "");
}
