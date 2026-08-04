import { assertEquals, assertStringIncludes } from "jsr:@std/assert";
import { corsHeaders, handlePdfImport } from "./index.ts";

function fakeSupabase(opts: {
  user?: { id: string } | null;
  insertResult?: { data?: unknown; error?: { message: string } };
  uploadError?: { message: string };
}) {
  let lastInsertedRow: Record<string, unknown> | undefined;
  let lastUploadPath: string | undefined;
  const removed: string[] = [];

  const single = () => Promise.resolve(opts.insertResult ?? { data: { id: "b1" }, error: null });
  const select = (_cols: string) => ({ single });
  const insert = (row: Record<string, unknown>) => {
    lastInsertedRow = row;
    return { select };
  };
  const from = (_table: string) => ({ insert });

  const storageFrom = (_bucket: string) => ({
    upload: (path: string, _bytes: Uint8Array, _opts: unknown) => {
      lastUploadPath = path;
      return Promise.resolve({ error: opts.uploadError ?? null });
    },
    remove: (paths: string[]) => {
      removed.push(...paths);
      return Promise.resolve({ error: null });
    },
  });

  return {
    auth: { getUser: () => Promise.resolve({ data: { user: opts.user ?? null } }) },
    from,
    storage: { from: storageFrom },
    get lastInsertedRow() {
      return lastInsertedRow;
    },
    get lastUploadPath() {
      return lastUploadPath;
    },
    get removed() {
      return removed;
    },
  };
}

function b64(text: string): string {
  return btoa(text);
}

Deno.test("handlePdfImport: stores the original and saves extracted text as markdown", async () => {
  const supabase = fakeSupabase({ user: { id: "user-1" } });
  const res = await handlePdfImport(
    // deno-lint-ignore no-explicit-any
    supabase as any,
    { filename: "Annual Report.pdf", contentBase64: b64("%PDF-1.4 stand-in bytes") },
    () => Promise.resolve("Extracted heading\n\nBody paragraph."),
  );
  const body = await res.json();

  assertEquals(res.status, 200);
  assertEquals(supabase.lastInsertedRow?.type, "pdf");
  assertEquals(supabase.lastInsertedRow?.status, "ready");
  assertEquals(supabase.lastInsertedRow?.pdf_parsed, true);
  assertEquals(supabase.lastInsertedRow?.content_md, "Extracted heading\n\nBody paragraph.");
  assertEquals(supabase.lastInsertedRow?.title, "Annual Report");
  assertEquals(supabase.lastInsertedRow?.pdf_path, supabase.lastUploadPath);
  assertMatchUserPrefix(supabase.lastUploadPath, "user-1");
  assertEquals(body.bookmark.id, "b1");
});

function assertMatchUserPrefix(path: string | undefined, userId: string) {
  assertStringIncludes(path ?? "", `${userId}/`);
}

Deno.test("handlePdfImport: falls back to pdf_parsed=false when extraction yields no text", async () => {
  const supabase = fakeSupabase({ user: { id: "user-1" } });
  const res = await handlePdfImport(
    // deno-lint-ignore no-explicit-any
    supabase as any,
    { filename: "scanned.pdf", contentBase64: b64("bytes") },
    () => Promise.resolve(""),
  );
  const body = await res.json();

  assertEquals(res.status, 200);
  assertEquals(supabase.lastInsertedRow?.pdf_parsed, false);
  assertEquals(supabase.lastInsertedRow?.content_md, null);
  assertEquals(body.bookmark.id, "b1");
});

Deno.test("handlePdfImport: falls back to pdf_parsed=false when extraction throws", async () => {
  const supabase = fakeSupabase({ user: { id: "user-1" } });
  const res = await handlePdfImport(
    // deno-lint-ignore no-explicit-any
    supabase as any,
    { filename: "corrupt.pdf", contentBase64: b64("bytes") },
    () => Promise.reject(new Error("bad pdf structure")),
  );
  const body = await res.json();

  assertEquals(res.status, 200);
  assertEquals(supabase.lastInsertedRow?.pdf_parsed, false);
  assertEquals(body.bookmark.id, "b1");
});

Deno.test("handlePdfImport: rejects non-.pdf filenames", async () => {
  const supabase = fakeSupabase({ user: { id: "user-1" } });
  const res = await handlePdfImport(
    // deno-lint-ignore no-explicit-any
    supabase as any,
    { filename: "notes.md", contentBase64: b64("x") },
    () => Promise.resolve("text"),
  );
  assertEquals(res.status, 400);
});

Deno.test("handlePdfImport: rejects files over the 20MB limit", async () => {
  const supabase = fakeSupabase({ user: { id: "user-1" } });
  const big = "a".repeat(20 * 1024 * 1024 + 1);
  const res = await handlePdfImport(
    // deno-lint-ignore no-explicit-any
    supabase as any,
    { filename: "big.pdf", contentBase64: b64(big) },
    () => Promise.resolve("shouldn't be reached"),
  );
  assertEquals(res.status, 400);
});

Deno.test("handlePdfImport: returns 500 when storage upload fails", async () => {
  const supabase = fakeSupabase({ user: { id: "user-1" }, uploadError: { message: "storage down" } });
  const res = await handlePdfImport(
    // deno-lint-ignore no-explicit-any
    supabase as any,
    { filename: "report.pdf", contentBase64: b64("bytes") },
    () => Promise.resolve("text"),
  );
  const body = await res.json();
  assertEquals(res.status, 500);
  assertEquals(body, "storage down");
});

Deno.test("handlePdfImport: cleans up the uploaded object when the insert fails", async () => {
  const supabase = fakeSupabase({
    user: { id: "user-1" },
    insertResult: { data: undefined, error: { message: "insert failed" } },
  });
  const res = await handlePdfImport(
    // deno-lint-ignore no-explicit-any
    supabase as any,
    { filename: "report.pdf", contentBase64: b64("bytes") },
    () => Promise.resolve("text"),
  );
  const body = await res.json();

  assertEquals(res.status, 500);
  assertEquals(body, "insert failed");
  assertEquals(supabase.removed, [supabase.lastUploadPath]);
});

Deno.test("handlePdfImport: returns 401 when unauthenticated", async () => {
  const supabase = fakeSupabase({ user: null });
  const res = await handlePdfImport(
    // deno-lint-ignore no-explicit-any
    supabase as any,
    { filename: "report.pdf", contentBase64: b64("bytes") },
    () => Promise.resolve("text"),
  );
  assertEquals(res.status, 401);
});

Deno.test("corsHeaders: allows the apikey header supabase-js attaches to functions.invoke calls", () => {
  assertStringIncludes(corsHeaders["Access-Control-Allow-Headers"], "apikey");
});
