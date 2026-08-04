import { assertEquals, assertStringIncludes } from "jsr:@std/assert";
import { corsHeaders, handleFileImport } from "./index.ts";

function fakeSupabase(opts: {
  user?: { id: string } | null;
  insertResult?: { data?: unknown; error?: { message: string } };
}) {
  const single = () => Promise.resolve(opts.insertResult ?? { data: { id: "b1" }, error: null });
  const select = (_cols: string) => ({ single });
  const insert = (row: Record<string, unknown>) => {
    lastInsertedRow = row;
    return { select };
  };
  let lastInsertedRow: Record<string, unknown> | undefined;
  const from = (_table: string) => ({ insert });
  return {
    auth: { getUser: () => Promise.resolve({ data: { user: opts.user ?? null } }) },
    from,
    get lastInsertedRow() {
      return lastInsertedRow;
    },
  };
}

function b64(text: string): string {
  return btoa(text);
}

Deno.test("handleFileImport: reads a markdown file straight through", async () => {
  const supabase = fakeSupabase({ user: { id: "user-1" } });
  const res = await handleFileImport(
    // deno-lint-ignore no-explicit-any
    supabase as any,
    { filename: "notes.md", contentBase64: b64("# Title\n\nbody text") },
  );
  const body = await res.json();

  assertEquals(res.status, 200);
  assertEquals(supabase.lastInsertedRow?.content_md, "# Title\n\nbody text");
  assertEquals(supabase.lastInsertedRow?.type, "note");
  assertEquals(supabase.lastInsertedRow?.status, "ready");
  assertEquals(supabase.lastInsertedRow?.title, "notes");
  assertEquals(supabase.lastInsertedRow?.user_id, "user-1");
  assertEquals(body.bookmark.id, "b1");
});

Deno.test("handleFileImport: converts a docx file via the injected converter", async () => {
  const supabase = fakeSupabase({ user: { id: "user-1" } });
  const res = await handleFileImport(
    // deno-lint-ignore no-explicit-any
    supabase as any,
    { filename: "report.docx", contentBase64: b64("ignored binary stand-in") },
    () => Promise.resolve("# Report\n\nconverted markdown"),
  );
  const body = await res.json();

  assertEquals(res.status, 200);
  assertEquals(supabase.lastInsertedRow?.content_md, "# Report\n\nconverted markdown");
  assertEquals(supabase.lastInsertedRow?.title, "report");
  assertEquals(body.bookmark.id, "b1");
});

Deno.test("handleFileImport: rejects unsupported extensions", async () => {
  const supabase = fakeSupabase({ user: { id: "user-1" } });
  const res = await handleFileImport(
    // deno-lint-ignore no-explicit-any
    supabase as any,
    { filename: "legacy.doc", contentBase64: b64("x") },
  );
  assertEquals(res.status, 400);
});

Deno.test("handleFileImport: rejects markdown files over the 500KB limit", async () => {
  const supabase = fakeSupabase({ user: { id: "user-1" } });
  const big = "a".repeat(500 * 1024 + 1);
  const res = await handleFileImport(
    // deno-lint-ignore no-explicit-any
    supabase as any,
    { filename: "big.md", contentBase64: b64(big) },
  );
  assertEquals(res.status, 400);
});

Deno.test("handleFileImport: rejects docx files over the 5MB limit", async () => {
  const supabase = fakeSupabase({ user: { id: "user-1" } });
  const big = "a".repeat(5 * 1024 * 1024 + 1);
  const res = await handleFileImport(
    // deno-lint-ignore no-explicit-any
    supabase as any,
    { filename: "big.docx", contentBase64: b64(big) },
    () => Promise.resolve("shouldn't be reached"),
  );
  assertEquals(res.status, 400);
});

Deno.test("handleFileImport: returns 400 when the docx converter throws", async () => {
  const supabase = fakeSupabase({ user: { id: "user-1" } });
  const res = await handleFileImport(
    // deno-lint-ignore no-explicit-any
    supabase as any,
    { filename: "corrupt.docx", contentBase64: b64("not really a docx") },
    () => Promise.reject(new Error("bad zip")),
  );
  assertEquals(res.status, 400);
});

Deno.test("handleFileImport: returns 401 when unauthenticated", async () => {
  const supabase = fakeSupabase({ user: null });
  const res = await handleFileImport(
    // deno-lint-ignore no-explicit-any
    supabase as any,
    { filename: "notes.md", contentBase64: b64("hi") },
  );
  assertEquals(res.status, 401);
});

Deno.test("handleFileImport: returns 500 with the DB error message on insert failure", async () => {
  const supabase = fakeSupabase({
    user: { id: "user-1" },
    insertResult: { data: undefined, error: { message: "insert failed" } },
  });
  const res = await handleFileImport(
    // deno-lint-ignore no-explicit-any
    supabase as any,
    { filename: "notes.md", contentBase64: b64("hi") },
  );
  const body = await res.json();

  assertEquals(res.status, 500);
  assertEquals(body, "insert failed");
});

Deno.test("corsHeaders: allows the apikey header supabase-js attaches to functions.invoke calls", () => {
  assertStringIncludes(corsHeaders["Access-Control-Allow-Headers"], "apikey");
});
