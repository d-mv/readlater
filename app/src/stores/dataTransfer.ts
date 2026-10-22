import { defineStore } from "pinia";
import { supabase, type Bookmark } from "../lib/supabase";
import { useAuthStore } from "./auth";
import {
  buildExportPayload,
  parseExportPayload,
  partitionForImport,
  type ExportPayload,
  type ImportPayloadError,
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
): Promise<{ data: T[]; error: { message: string } | null }> {
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
  // Nothing was imported.
  error: string | null;
  // The bookmarks were imported, but something about them wasn't.
  warning: string | null;
}

const TAGS_NOT_SAVED = "The bookmarks were imported, but their tags couldn't be saved.";

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
    return { payload: buildExportPayload(data), error: null };
  }

  async function importBookmarks(jsonText: string): Promise<ImportResult> {
    let payload: ParsedImport;
    try {
      payload = parseExportPayload(jsonText);
    } catch (err) {
      // parseExportPayload only throws ImportPayloadError (bad rows are
      // reported in payload.invalid, not thrown).
      return {
        imported: 0,
        skipped: [],
        error: (err as ImportPayloadError).message,
        warning: null,
      };
    }

    const userId = useAuthStore().userId;
    if (!userId) {
      return { imported: 0, skipped: [], error: "You must be signed in.", warning: null };
    }

    // Loaded once up front rather than per-row: this is a personal-library-scale,
    // one-shot operation, so an O(1)-query in-memory Set beats N duplicate queries.
    const { data: existingRows, error: existingError } = await fetchAllPages<{
      url_normalized: string | null;
    }>((from, to) =>
      supabase.from("bookmarks").select("url_normalized").order("id").range(from, to),
    );
    // A partial set would let a duplicate through, and one duplicate fails
    // the whole bulk insert.
    if (existingError) {
      return {
        imported: 0,
        skipped: [],
        error: "Couldn't check for bookmarks you already have. Nothing was imported.",
        warning: null,
      };
    }
    const existingNormalizedUrls = new Set(
      existingRows
        .map((row) => row.url_normalized)
        .filter((value: string | null): value is string => value !== null),
    );

    const { toImport, skipped: duplicates } = partitionForImport(
      payload.bookmarks,
      existingNormalizedUrls,
    );
    const skipped = [...payload.invalid, ...duplicates];
    if (toImport.length === 0) return { imported: 0, skipped, error: null, warning: null };

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
      return { imported: 0, skipped, error: null, warning: null };
    }
    const imported = toImport.length;

    // 2. Insert the tags this user doesn't have yet — an existing tag keeps
    //    its colour — then read every name's id. Tags are per user (unique on
    //    user_id, name), so each row carries the owner.
    const tagsByName = new Map<string, { name: string; color: string; user_id: string }>();
    for (const bookmark of toImport) {
      for (const tag of bookmark.tags) tagsByName.set(tag.name, { ...tag, user_id: userId });
    }
    if (tagsByName.size === 0) return { imported, skipped, error: null, warning: null };
    const tagsFailed = { imported, skipped, error: null, warning: TAGS_NOT_SAVED };
    const { error: upsertError } = await supabase
      .from("tags")
      .upsert([...tagsByName.values()], { onConflict: "user_id,name", ignoreDuplicates: true });
    if (upsertError) return tagsFailed;
    const { data: tagRows, error: readError } = await supabase
      .from("tags")
      .select("id, name")
      .in("name", [...tagsByName.keys()]);
    if (readError) return tagsFailed;
    const tagIdByName = new Map(
      ((tagRows ?? []) as { id: string; name: string }[]).map((row) => [row.name, row.id]),
    );
    if (tagIdByName.size !== tagsByName.size) return tagsFailed;

    // 3. One bulk upsert of all bookmark_tags join rows.
    const pairs = toImport.flatMap((bookmark, index) =>
      bookmark.tags.map((tag) => ({
        bookmark_id: (inserted[index] as { id: string }).id,
        tag_id: tagIdByName.get(tag.name)!,
      })),
    );
    const { error: linkError } = await supabase
      .from("bookmark_tags")
      .upsert(pairs, { onConflict: "bookmark_id,tag_id" });
    if (linkError) return tagsFailed;

    return { imported, skipped, error: null, warning: null };
  }

  return { exportBookmarks, importBookmarks };
});
