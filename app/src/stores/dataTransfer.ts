import { defineStore } from "pinia";
import { supabase, type Bookmark } from "../lib/supabase";
import {
  buildExportPayload,
  parseExportPayload,
  partitionForImport,
  type ExportPayload,
  type SkippedRow,
} from "../utils/dataTransfer";

const BOOKMARK_SELECT = "*, tags(id, name, color)";

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
    const { data, error } = await supabase
      .from("bookmarks")
      .select(BOOKMARK_SELECT)
      .order("created_at", { ascending: false });
    if (error) return { payload: null, error: error.message };
    return { payload: buildExportPayload((data ?? []) as Bookmark[]), error: null };
  }

  async function importBookmarks(jsonText: string): Promise<ImportResult> {
    let payload: ExportPayload;
    try {
      payload = parseExportPayload(jsonText);
    } catch (err) {
      const message = err instanceof Error ? err.message : "That file couldn't be read.";
      return { imported: 0, skipped: [], error: message };
    }

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { imported: 0, skipped: [], error: "You must be signed in." };

    // Loaded once up front rather than per-row: this is a personal-library-scale,
    // one-shot operation, so an O(1)-query in-memory Set beats N duplicate queries.
    const { data: existingRows } = await supabase.from("bookmarks").select("url_normalized");
    const existingNormalizedUrls = new Set(
      (existingRows ?? [])
        .map((row: { url_normalized: string | null }) => row.url_normalized)
        .filter((value: string | null): value is string => value !== null),
    );

    const { toImport, skipped } = partitionForImport(payload.bookmarks, existingNormalizedUrls);

    let imported = 0;
    for (const bookmark of toImport) {
      const { tags, ...fields } = bookmark;
      const { data: inserted, error } = await supabase
        .from("bookmarks")
        .insert({ ...fields, user_id: user.id })
        .select("id")
        .single();

      if (error || !inserted) {
        skipped.push({
          url: bookmark.url,
          title: bookmark.title,
          reason: error?.message ?? "insert failed",
        });
        continue;
      }

      for (const tag of tags) {
        const { data: tagRow } = await supabase
          .from("tags")
          .upsert(
            { name: tag.name, color: tag.color },
            { onConflict: "name", ignoreDuplicates: false },
          )
          .select("id")
          .single();
        if (!tagRow) continue;

        await supabase
          .from("bookmark_tags")
          .upsert(
            { bookmark_id: inserted.id, tag_id: tagRow.id },
            { onConflict: "bookmark_id,tag_id" },
          );
      }

      imported++;
    }

    return { imported, skipped, error: null };
  }

  return { exportBookmarks, importBookmarks };
});
