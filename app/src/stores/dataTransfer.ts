import { defineStore } from "pinia";
import { supabase, type Bookmark } from "../lib/supabase";
import { useAuthStore } from "./auth";
import {
  buildExportPayload,
  parseExportPayload,
  partitionForImport,
  type ExportPayload,
  type ParsedImport,
  type SkippedRow,
} from "../utils/dataTransfer";

const BOOKMARK_SELECT = "*, tags(id, name, color)";

// PostgREST caps every response at `max_rows` (1000, see supabase/config.toml),
// so whole-library reads must be paged or they silently truncate.
const PAGE_SIZE = 1000;

interface PageResult<T> {
  data: T[] | null;
  error: { message: string } | null;
}

// Fetches consecutive `.range()` pages until one comes back short. The query
// must have a stable, unique ordering so pages neither overlap nor skip rows.
// Stops at the first error and returns it along with the rows read so far.
async function fetchAllPages<T>(
  fetchPage: (from: number, to: number) => PromiseLike<PageResult<T>>,
): Promise<PageResult<T>> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await fetchPage(from, from + PAGE_SIZE - 1);
    if (error) return { data: rows, error };
    const page = data ?? [];
    rows.push(...page);
    if (page.length < PAGE_SIZE) return { data: rows, error: null };
  }
}

export interface ExportResult {
  payload: ExportPayload | null;
  error: string | null;
}

export interface ImportResult {
  imported: number;
  skipped: SkippedRow[];
  error: string | null;
}

export const useDataTransferStore = defineStore("dataTransfer", () => {
  async function exportBookmarks(): Promise<ExportResult> {
    const { data, error } = await fetchAllPages<Bookmark>((from, to) =>
      supabase
        .from("bookmarks")
        .select(BOOKMARK_SELECT)
        .order("created_at", { ascending: false })
        .order("id")
        .range(from, to),
    );
    if (error) return { payload: null, error: error.message };
    return { payload: buildExportPayload((data ?? []) as Bookmark[]), error: null };
  }

  async function importBookmarks(jsonText: string): Promise<ImportResult> {
    let payload: ParsedImport;
    try {
      payload = parseExportPayload(jsonText);
    } catch (err) {
      const message = err instanceof Error ? err.message : "That file couldn't be read.";
      return { imported: 0, skipped: [], error: message };
    }

    const userId = useAuthStore().userId;
    if (!userId) return { imported: 0, skipped: [], error: "You must be signed in." };

    // Loaded once up front rather than per-row: this is a personal-library-scale,
    // one-shot operation, so an O(1)-query in-memory Set beats N duplicate queries.
    const { data: existingRows } = await fetchAllPages<{ url_normalized: string | null }>(
      (from, to) => supabase.from("bookmarks").select("url_normalized").order("id").range(from, to),
    );
    const existingNormalizedUrls = new Set(
      (existingRows ?? [])
        .map((row) => row.url_normalized)
        .filter((value: string | null): value is string => value !== null),
    );

    const { toImport, skipped: duplicates } = partitionForImport(
      payload.bookmarks,
      existingNormalizedUrls,
    );
    const skipped = [...payload.invalid, ...duplicates];
    if (toImport.length === 0) return { imported: 0, skipped, error: null };

    // 1. One bulk insert. `.select("id")` returns the new ids in insertion
    //    order, so inserted[i] lines up with toImport[i].
    const rows = toImport.map(({ tags: _tags, ...fields }) => ({ ...fields, user_id: userId }));
    const { data: inserted, error: insertError } = await supabase
      .from("bookmarks")
      .insert(rows)
      .select("id");

    if (insertError || !inserted || inserted.length !== toImport.length) {
      for (const bookmark of toImport) {
        skipped.push({
          url: bookmark.url,
          title: bookmark.title,
          reason: insertError?.message ?? "insert failed",
        });
      }
      return { imported: 0, skipped, error: null };
    }

    // 2. One bulk upsert of every distinct tag, then map name -> id. Tags are
    //    per user (unique on user_id, name), so each row carries the owner.
    const tagsByName = new Map<string, { name: string; color: string; user_id: string }>();
    for (const bookmark of toImport) {
      for (const tag of bookmark.tags) tagsByName.set(tag.name, { ...tag, user_id: userId });
    }
    const tagIdByName = new Map<string, string>();
    if (tagsByName.size > 0) {
      const { data: tagRows } = await supabase
        .from("tags")
        .upsert([...tagsByName.values()], { onConflict: "user_id,name", ignoreDuplicates: false })
        .select("id, name");
      for (const row of (tagRows ?? []) as { id: string; name: string }[]) {
        tagIdByName.set(row.name, row.id);
      }
    }

    // 3. One bulk upsert of all bookmark_tags join rows.
    const pairs: { bookmark_id: string; tag_id: string }[] = [];
    toImport.forEach((bookmark, index) => {
      const bookmarkId = (inserted[index] as { id: string }).id;
      for (const tag of bookmark.tags) {
        const tagId = tagIdByName.get(tag.name);
        if (tagId) pairs.push({ bookmark_id: bookmarkId, tag_id: tagId });
      }
    });
    if (pairs.length > 0) {
      await supabase.from("bookmark_tags").upsert(pairs, { onConflict: "bookmark_id,tag_id" });
    }

    return { imported: toImport.length, skipped, error: null };
  }

  return { exportBookmarks, importBookmarks };
});
