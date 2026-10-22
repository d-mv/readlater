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

type PageResponse = { data: unknown[] | null; error: { message: string } | null };

// Chainable stub for `select(...).order(...).order(...).range(from, to)`.
// `range` resolves to the page at index from / 1000 (an empty page past the end).
function pagedQuery(pages: PageResponse[]) {
  const range = vi.fn(
    async (from: number, _to: number): Promise<PageResponse> =>
      pages[from / 1000] ?? { data: [], error: null },
  );
  const query = { order: vi.fn(() => query), range };
  return query;
}

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
      const query = pagedQuery([{ data: rows, error: null }]);
      const select = vi.fn(() => query);
      from.mockReturnValue({ select });

      const store = useDataTransferStore();
      const result = await store.exportBookmarks();

      expect(from).toHaveBeenCalledWith("bookmarks");
      expect(select).toHaveBeenCalledWith(expect.stringContaining("tags"));
      expect(query.order).toHaveBeenCalledWith("created_at", { ascending: false });
      expect(query.order).toHaveBeenCalledWith("id");
      expect(query.range).toHaveBeenCalledTimes(1);
      expect(query.range).toHaveBeenCalledWith(0, 999);
      expect(result.error).toBeNull();
      expect(result.payload?.version).toBe(EXPORT_VERSION);
      expect(result.payload?.bookmarks).toHaveLength(1);
    });

    test("surfaces a query error", async () => {
      const query = pagedQuery([{ data: null, error: { message: "network down" } }]);
      from.mockReturnValue({ select: () => query });

      const store = useDataTransferStore();
      const result = await store.exportBookmarks();

      expect(result.payload).toBeNull();
      expect(result.error).toBe("network down");
    });

    test("pages past the 1000-row cap and returns every row in order", async () => {
      const rows = Array.from({ length: 2500 }, (_, i) => ({
        id: `id-${i}`,
        url: `https://ex.com/${i}`,
        type: "article",
        status: "ready",
        title: `Article ${i}`,
        content_md: "body",
        tags: [],
        created_at: "2026-01-01T00:00:00Z",
      }));
      const query = pagedQuery([
        { data: rows.slice(0, 1000), error: null },
        { data: rows.slice(1000, 2000), error: null },
        { data: rows.slice(2000), error: null },
      ]);
      from.mockReturnValue({ select: () => query });

      const store = useDataTransferStore();
      const result = await store.exportBookmarks();

      expect(result.error).toBeNull();
      expect(query.range.mock.calls).toEqual([
        [0, 999],
        [1000, 1999],
        [2000, 2999],
      ]);
      expect(result.payload?.bookmarks).toHaveLength(2500);
      expect(result.payload?.bookmarks.map((b) => b.url)).toEqual(rows.map((r) => r.url));
    });

    test("surfaces an error on a later page instead of a truncated export", async () => {
      const firstPage = Array.from({ length: 1000 }, (_, i) => ({
        id: `id-${i}`,
        url: `https://ex.com/${i}`,
        type: "article",
        status: "ready",
        title: `Article ${i}`,
        content_md: "body",
        tags: [],
        created_at: "2026-01-01T00:00:00Z",
      }));
      const query = pagedQuery([
        { data: firstPage, error: null },
        { data: null, error: { message: "timeout on page 2" } },
      ]);
      from.mockReturnValue({ select: () => query });

      const store = useDataTransferStore();
      const result = await store.exportBookmarks();

      expect(query.range).toHaveBeenCalledTimes(2);
      expect(result.payload).toBeNull();
      expect(result.error).toBe("timeout on page 2");
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

      const existingQuery = pagedQuery([
        { data: [{ url_normalized: "https://arc90.com/x" }], error: null },
      ]);

      const insertSelect = vi.fn().mockResolvedValue({ data: [{ id: "new-1" }], error: null });
      const insert = vi.fn((_rows: unknown[]) => ({ select: insertSelect }));

      const tagUpsert = vi.fn().mockResolvedValue({ data: null, error: null });
      const tagIn = vi
        .fn()
        .mockResolvedValue({ data: [{ id: "tag-1", name: "reading" }], error: null });
      const tagSelect = vi.fn(() => ({ in: tagIn }));

      const bookmarkTagsUpsert = vi.fn().mockResolvedValue({ data: null, error: null });

      from.mockImplementation((table: string) => {
        if (table === "bookmarks") {
          return { select: () => existingQuery, insert };
        }
        if (table === "tags") {
          return { upsert: tagUpsert, select: tagSelect };
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
      // One bulk insert of the non-duplicate rows, no per-row calls.
      expect(insert).toHaveBeenCalledTimes(1);
      expect(insert).toHaveBeenCalledWith([
        expect.objectContaining({ url: "https://new.example/y", user_id: "user-1" }),
      ]);
      expect(insert.mock.calls[0][0][0]).not.toHaveProperty("tags");
      // One bulk tag upsert, one bulk join upsert.
      expect(tagUpsert).toHaveBeenCalledTimes(1);
      // Tags are per user: the owner is on every row and in the conflict target.
      // An existing tag keeps its colour: only new names are inserted, then
      // every name's id is read back.
      expect(tagUpsert).toHaveBeenCalledWith(
        [{ name: "reading", color: "#888888", user_id: "user-1" }],
        { onConflict: "user_id,name", ignoreDuplicates: true },
      );
      expect(tagSelect).toHaveBeenCalledWith("id, name");
      expect(tagIn).toHaveBeenCalledWith("name", ["reading"]);
      expect(result.warning).toBeNull();
      expect(bookmarkTagsUpsert).toHaveBeenCalledTimes(1);
      expect(bookmarkTagsUpsert).toHaveBeenCalledWith([{ bookmark_id: "new-1", tag_id: "tag-1" }], {
        onConflict: "bookmark_id,tag_id",
      });
    });

    test("imports the well-formed rows of a mixed file and reports the malformed ones", async () => {
      const good = {
        url: "https://new.example/y",
        type: "article",
        status: "ready",
        title: "Good",
        content_md: "body",
        created_at: "2026-01-01T00:00:00Z",
        id: "stale-id-from-another-db",
      };
      const noTags = { url: null, type: "note", status: "ready", title: "Note", content_md: "n" };
      const malformed = { url: 7, type: "article", status: "ready", title: "Broken" };

      const existingQuery = pagedQuery([{ data: [], error: null }]);
      const insertSelect = vi
        .fn()
        .mockResolvedValue({ data: [{ id: "new-1" }, { id: "new-2" }], error: null });
      const insert = vi.fn((_rows: unknown[]) => ({ select: insertSelect }));
      from.mockImplementation((table: string) => {
        if (table === "bookmarks") return { select: () => existingQuery, insert };
        throw new Error(`unexpected table ${table}`);
      });

      const store = useDataTransferStore();
      const result = await store.importBookmarks(validPayload([good, noTags, malformed]));

      expect(result.error).toBeNull();
      expect(result.imported).toBe(2);
      expect(result.skipped).toEqual([
        { url: null, title: "Broken", reason: expect.stringMatching(/^invalid row/) },
      ]);
      const inserted = insert.mock.calls[0][0] as Record<string, unknown>[];
      expect(inserted).toHaveLength(2);
      expect(inserted[0]).not.toHaveProperty("id");
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

      const existingQuery = pagedQuery([{ data: [], error: null }]);
      const insertSelect = vi
        .fn()
        .mockResolvedValue({ data: null, error: { message: "constraint violated" } });
      const insert = vi.fn(() => ({ select: insertSelect }));

      from.mockImplementation((table: string) => {
        if (table === "bookmarks") return { select: () => existingQuery, insert };
        throw new Error(`unexpected table ${table}`);
      });

      const store = useDataTransferStore();
      const result = await store.importBookmarks(validPayload([bookmark]));

      expect(result.imported).toBe(0);
      expect(result.skipped).toEqual([
        { url: "https://new.example/y", title: "New", reason: "constraint violated" },
      ]);
    });

    test("sees an existing URL that is only on the second page of the duplicate check", async () => {
      const bookmark = {
        url: "https://arc90.com/x",
        type: "article",
        status: "ready",
        title: "Existing",
        content_md: "body",
        tags: [],
      };
      const firstPage = Array.from({ length: 1000 }, (_, i) => ({
        url_normalized: `https://ex.com/${i}`,
      }));
      const existingQuery = pagedQuery([
        { data: firstPage, error: null },
        { data: [{ url_normalized: "https://arc90.com/x" }], error: null },
      ]);
      const insert = vi.fn();
      from.mockImplementation((table: string) => {
        if (table === "bookmarks") return { select: () => existingQuery, insert };
        throw new Error(`unexpected table ${table}`);
      });

      const store = useDataTransferStore();
      const result = await store.importBookmarks(validPayload([bookmark]));

      expect(existingQuery.order).toHaveBeenCalledWith("id");
      expect(existingQuery.range.mock.calls).toEqual([
        [0, 999],
        [1000, 1999],
      ]);
      expect(result.error).toBeNull();
      expect(result.imported).toBe(0);
      expect(result.skipped).toEqual([
        { url: "https://arc90.com/x", title: "Existing", reason: "already exists" },
      ]);
      expect(insert).not.toHaveBeenCalled();
    });

    test("imports many bookmarks in a fixed number of queries", async () => {
      const mk = (n: number) => ({
        url: `https://ex.com/${n}`,
        type: "article",
        status: "ready",
        title: `Article ${n}`,
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
        tags: [{ name: "t", color: "#888888" }],
      });
      const payloadRows = Array.from({ length: 25 }, (_, i) => mk(i));

      const insert = vi.fn((_rows: unknown[]) => ({
        select: vi.fn().mockResolvedValue({
          data: payloadRows.map((_, i) => ({ id: `id-${i}` })),
          error: null,
        }),
      }));
      const tagUpsert = vi.fn().mockResolvedValue({ data: null, error: null });
      const tagSelect = () => ({
        in: vi.fn().mockResolvedValue({ data: [{ id: "tag-t", name: "t" }], error: null }),
      });
      const bookmarkTagsUpsert = vi.fn().mockResolvedValue({ data: null, error: null });

      from.mockImplementation((table: string) => {
        if (table === "bookmarks") {
          return { select: () => pagedQuery([{ data: [], error: null }]), insert };
        }
        if (table === "tags") return { upsert: tagUpsert, select: tagSelect };
        if (table === "bookmark_tags") return { upsert: bookmarkTagsUpsert };
        throw new Error(`unexpected table ${table}`);
      });

      const store = useDataTransferStore();
      const result = await store.importBookmarks(validPayload(payloadRows));

      expect(result.imported).toBe(25);
      expect(insert).toHaveBeenCalledTimes(1);
      expect(insert.mock.calls[0][0]).toHaveLength(25);
      expect(tagUpsert).toHaveBeenCalledTimes(1);
      expect(bookmarkTagsUpsert).toHaveBeenCalledTimes(1);
      expect(bookmarkTagsUpsert.mock.calls[0][0]).toHaveLength(25);
    });
  });

  describe("edge cases", () => {
    const row = (overrides: Record<string, unknown> = {}) => ({
      url: "https://new.example/y",
      type: "article",
      status: "ready",
      title: "New",
      tags: [],
      ...overrides,
    });
    const payload = (bookmarks: unknown[]) =>
      JSON.stringify({ version: EXPORT_VERSION, exported_at: "now", bookmarks });

    test("a page that comes back without data counts as an empty library", async () => {
      from.mockReturnValue({ select: () => pagedQuery([{ data: null, error: null }]) });

      const result = await useDataTransferStore().exportBookmarks();

      expect(result.error).toBeNull();
      expect(result.payload!.bookmarks).toEqual([]);
    });

    test("an insert that returns fewer ids than rows skips them all as failed", async () => {
      const insertSelect = vi.fn().mockResolvedValue({ data: [{ id: "only-one" }], error: null });
      from.mockImplementation((table: string) => {
        if (table === "bookmarks") {
          return {
            select: () => pagedQuery([{ data: [], error: null }]),
            insert: () => ({ select: insertSelect }),
          };
        }
        throw new Error(`unexpected table ${table}`);
      });

      const result = await useDataTransferStore().importBookmarks(
        payload([
          row({ url: "https://a.example/1", title: "A" }),
          row({ url: "https://b.example/2", title: "B" }),
        ]),
      );

      expect(result.imported).toBe(0);
      expect(result.skipped).toEqual([
        { url: "https://a.example/1", title: "A", reason: "insert failed" },
        { url: "https://b.example/2", title: "B", reason: "insert failed" },
      ]);
    });

    function importWithTagTables(tags: {
      upsert?: { error: { message: string } | null };
      read?: { data: unknown[] | null; error: { message: string } | null };
      links?: { error: { message: string } | null };
    }) {
      const bookmarkTagsUpsert = vi.fn().mockResolvedValue(tags.links ?? { error: null });
      from.mockImplementation((table: string) => {
        if (table === "bookmarks") {
          return {
            select: () => pagedQuery([{ data: [], error: null }]),
            insert: () => ({
              select: vi.fn().mockResolvedValue({ data: [{ id: "new-1" }], error: null }),
            }),
          };
        }
        if (table === "tags") {
          return {
            upsert: vi.fn().mockResolvedValue(tags.upsert ?? { error: null }),
            select: () => ({
              in: vi
                .fn()
                .mockResolvedValue(
                  tags.read ?? { data: [{ id: "t1", name: "news" }], error: null },
                ),
            }),
          };
        }
        if (table === "bookmark_tags") return { upsert: bookmarkTagsUpsert };
        throw new Error(`unexpected table ${table}`);
      });
      return bookmarkTagsUpsert;
    }

    test("a failed tag upsert still imports the bookmarks and says the tags are missing", async () => {
      const links = importWithTagTables({ upsert: { error: { message: "denied" } } });

      const result = await useDataTransferStore().importBookmarks(
        payload([row({ tags: [{ name: "news", color: "#000000" }] })]),
      );

      expect(result).toMatchObject({ imported: 1, skipped: [], error: null });
      expect(result.warning).toBe("The bookmarks were imported, but their tags couldn't be saved.");
      expect(links).not.toHaveBeenCalled();
    });

    test("a failed tag id lookup says the tags are missing", async () => {
      const links = importWithTagTables({ read: { data: null, error: { message: "denied" } } });

      const result = await useDataTransferStore().importBookmarks(
        payload([row({ tags: [{ name: "news", color: "#000000" }] })]),
      );

      expect(result.warning).toBe("The bookmarks were imported, but their tags couldn't be saved.");
      expect(links).not.toHaveBeenCalled();
    });

    test("a tag whose id can't be read back says the tags are missing", async () => {
      const links = importWithTagTables({ read: { data: null, error: null } });

      const result = await useDataTransferStore().importBookmarks(
        payload([row({ tags: [{ name: "news", color: "#000000" }] })]),
      );

      expect(result.warning).toBe("The bookmarks were imported, but their tags couldn't be saved.");
      expect(links).not.toHaveBeenCalled();
    });

    test("a failed tag link write says the tags are missing", async () => {
      importWithTagTables({ links: { error: { message: "denied" } } });

      const result = await useDataTransferStore().importBookmarks(
        payload([row({ tags: [{ name: "news", color: "#000000" }] })]),
      );

      expect(result.imported).toBe(1);
      expect(result.warning).toBe("The bookmarks were imported, but their tags couldn't be saved.");
    });

    test("a failed duplicate check imports nothing instead of risking a failed bulk insert", async () => {
      const insert = vi.fn();
      from.mockImplementation(() => ({
        select: () => pagedQuery([{ data: null, error: { message: "timeout" } }]),
        insert,
      }));

      const result = await useDataTransferStore().importBookmarks(payload([row()]));

      expect(result).toEqual({
        imported: 0,
        skipped: [],
        error: "Couldn't check for bookmarks you already have. Nothing was imported.",
        warning: null,
      });
      expect(insert).not.toHaveBeenCalled();
    });
  });
});
