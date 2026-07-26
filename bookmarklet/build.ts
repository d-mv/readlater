import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export function buildBookmarklet(source: string, endpoint: string, key: string): string {
  if (!endpoint) throw new Error("CAPTURE_ENDPOINT is required");
  if (!key) throw new Error("CAPTURE_KEY is required");

  const substituted = source
    .replaceAll("__CAPTURE_ENDPOINT__", endpoint)
    .replaceAll("__CAPTURE_KEY__", key);

  return `javascript:${encodeURIComponent(substituted)}`;
}

if (import.meta.main) {
  const endpoint = process.env.CAPTURE_ENDPOINT ?? "";
  const key = process.env.CAPTURE_KEY ?? "";
  const source = readFileSync(join(import.meta.dir, "source.js"), "utf8");

  const bookmarklet = buildBookmarklet(source, endpoint, key);
  const outPath = join(import.meta.dir, "dist.txt");
  writeFileSync(outPath, bookmarklet);
  console.log(`Bookmarklet written to ${outPath}`);
}
