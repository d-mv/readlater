import { beforeEach, describe, expect, test, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { EXPORT_VERSION } from "../utils/dataTransfer";

const { from, authState } = vi.hoisted(() => ({
  from: vi.fn(),
  authState: { userId: "user-1" as string | null },
}));
vi.mock("../lib/supabase", () => ({
  supabase: { from },
}));
vi.mock("./auth", () => ({ useAuthStore: () => authState }));

const { useDataTransferStore } = await import("./dataTransfer");

describe("useDataTransferStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    authState.userId = "user-1";
  });

  describe("exportBookmarks", () => {
    test("queries every bookmark (with tags) ordered by created_at and wraps it in a payload", async () => {
      const rows = [
        {
          id: "1",
          url: "https://arc90.com/x",
          type: "article",
          status: "ready",
          title: "Title",
          author: null,
          excerpt: null,
          content_md: "content",
          translated_content_md: null,
          translated_lang: null,
          thumbnail_url: null,
          youtube_video_id: null,
          content_edited: false,
          word_count: 100,
          reading_time: 5,
          tags: [],
          is_public: false,
          archived: false,
          read_at: null,
          error_message: null,
          created_at: "2026-01-01T00:00:00Z",
          processed_at: "2026-01-01T00:01:00Z",
          pdf_path: null,
          pdf_parsed: false,
          view_mode: null,
        },
      ];
      const order = vi.fn().mockResolvedValue({ data: rows, error: null });
      const select = vi.fn(() => ({ order }));
      from.mockReturnValue({ select });

      const store = useDataTransferStore();
      const result = await store.exportBookmarks();

      expect(from).toHaveBeenCalledWith("bookmarks");
      expect(select).toHaveBeenCalledWith(expect.stringContaining("tags"));
      expect(result.error).toBeNull();
      expect(result.payload?.version).toBe(EXPORT_VERSION);
      expect(result.payload?.bookmarks).toHaveLength(1);
    });

    test("surfaces a query error", async () => {
      const order = vi.fn().mockResolvedValue({ data: null, error: { message: "network down" } });
      from.mockReturnValue({ select: () => ({ order }) });

      const store = useDataTransferStore();
      const result = await store.exportBookmarks();

      expect(result.payload).toBeNull();
      expect(result.error).toBe("network down");
    });
  });

  describe("importBookmarks", () => {
    function validPayload(bookmarks: unknown[] = []) {
      return JSON.stringify({ version: EXPORT_VERSION, exported_at: "now", bookmarks });
    }

    test("rejects a malformed file without touching supabase", async () => {
      const store = useDataTransferStore();
      const result = await store.importBookmarks("not json");

      expect(result.error).toContain("valid JSON");
      expect(result.imported).toBe(0);
      expect(from).not.toHaveBeenCalled();
    });

    test("requires an authenticated user", async () => {
      authState.userId = null;

      const store = useDataTransferStore();
      const result = await store.importBookmarks(validPayload());

      expect(result.error).toBe("You must be signed in.");
    });

    test("skips rows whose URL already exists and inserts the rest with tags", async () => {
      const bookmark = {
        url: "https://new.example/y",
        type: "article",
        status: "ready",
        title: "New",
        author: null,
        excerpt: null,
        content_md: "body",
        translated_content_md: null,
        translated_lang: null,
        thumbnail_url: null,
        youtube_video_id: null,
        content_edited: false,
        word_count: 10,
        reading_time: 1,
        is_public: false,
        archived: false,
        read_at: null,
        error_message: null,
        created_at: "2026-01-01T00:00:00Z",
        processed_at: "2026-01-01T00:01:00Z",
        pdf_path: null,
        pdf_parsed: false,
        view_mode: null,
        tags: [{ name: "reading", color: "#888888" }],
      };
      const duplicate = { ...bookmark, url: "https://arc90.com/x", title: "Existing", tags: [] };

      const existingSelect = vi.fn().mockResolvedValue({
        data: [{ url_normalized: "https://arc90.com/x" }],
        error: null,
      });

      const insertedSingle = vi.fn().mockResolvedValue({ data: { id: "new-1" }, error: null });
      const insertSelect = vi.fn(() => ({ single: insertedSingle }));
      const insert = vi.fn(() => ({ select: insertSelect }));

      const tagSingle = vi.fn().mockResolvedValue({ data: { id: "tag-1" }, error: null });
      const tagSelect = vi.fn(() => ({ single: tagSingle }));
      const tagUpsert = vi.fn(() => ({ select: tagSelect }));

      const bookmarkTagsUpsert = vi.fn().mockResolvedValue({ data: null, error: null });

      from.mockImplementation((table: string) => {
        if (table === "bookmarks") {
          return { select: () => existingSelect(), insert };
        }
        if (table === "tags") {
          return { upsert: tagUpsert };
        }
        if (table === "bookmark_tags") {
          return { upsert: bookmarkTagsUpsert };
        }
        throw new Error(`unexpected table ${table}`);
      });

      const store = useDataTransferStore();
      const result = await store.importBookmarks(validPayload([duplicate, bookmark]));

      expect(result.imported).toBe(1);
      expect(result.skipped).toEqual([
        { url: "https://arc90.com/x", title: "Existing", reason: "already exists" },
      ]);
      expect(insert).toHaveBeenCalledWith(
        expect.objectContaining({ url: "https://new.example/y", user_id: "user-1" }),
      );
      expect(insert).not.toHaveBeenCalledWith(expect.objectContaining({ tags: expect.anything() }));
      expect(tagUpsert).toHaveBeenCalledWith(
        { name: "reading", color: "#888888" },
        { onConflict: "name", ignoreDuplicates: false },
      );
      expect(bookmarkTagsUpsert).toHaveBeenCalledWith(
        { bookmark_id: "new-1", tag_id: "tag-1" },
        { onConflict: "bookmark_id,tag_id" },
      );
    });

    test("reports an insert failure as a skipped row instead of throwing", async () => {
      const bookmark = {
        url: "https://new.example/y",
        type: "article",
        status: "ready",
        title: "New",
        author: null,
        excerpt: null,
        content_md: "body",
        translated_content_md: null,
        translated_lang: null,
        thumbnail_url: null,
        youtube_video_id: null,
        content_edited: false,
        word_count: 10,
        reading_time: 1,
        is_public: false,
        archived: false,
        read_at: null,
        error_message: null,
        created_at: "2026-01-01T00:00:00Z",
        processed_at: "2026-01-01T00:01:00Z",
        pdf_path: null,
        pdf_parsed: false,
        view_mode: null,
        tags: [],
      };

      const existingSelect = vi.fn().mockResolvedValue({ data: [], error: null });
      const insertedSingle = vi
        .fn()
        .mockResolvedValue({ data: null, error: { message: "constraint violated" } });
      const insert = vi.fn(() => ({ select: () => ({ single: insertedSingle }) }));

      from.mockImplementation((table: string) => {
        if (table === "bookmarks") return { select: () => existingSelect(), insert };
        throw new Error(`unexpected table ${table}`);
      });

      const store = useDataTransferStore();
      const result = await store.importBookmarks(validPayload([bookmark]));

      expect(result.imported).toBe(0);
      expect(result.skipped).toEqual([
        { url: "https://new.example/y", title: "New", reason: "constraint violated" },
      ]);
    });
  });
});
