import { assertEquals, assertStringIncludes } from "jsr:@std/assert";
import { corsHeaders, handleSnippet } from "./index.ts";

function fakeSupabase(opts: {
  user?: { id: string } | null;
  insertResult?: { data?: unknown; error?: { message: string } };
}) {
  const single = () =>
    Promise.resolve(opts.insertResult ?? { data: { id: "b1" }, error: null });
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

Deno.test("handleSnippet: converts HTML to Markdown and inserts a ready note", async () => {
  const supabase = fakeSupabase({ user: { id: "user-1" } });
  const res = await handleSnippet(
    // deno-lint-ignore no-explicit-any
    supabase as any,
    { html: "<p><b>bold</b> text</p>", text: "bold text" },
  );
  const body = await res.json();

  assertEquals(res.status, 200);
  assertEquals(body.bookmark.id, "b1");
  assertEquals(supabase.lastInsertedRow?.content_md, "**bold** text");
  assertEquals(supabase.lastInsertedRow?.type, "note");
  assertEquals(supabase.lastInsertedRow?.status, "ready");
  assertEquals(supabase.lastInsertedRow?.url, null);
  assertEquals(supabase.lastInsertedRow?.user_id, "user-1");
});

Deno.test("handleSnippet: falls back to plain text when no HTML is provided", async () => {
  const supabase = fakeSupabase({ user: { id: "user-1" } });
  const res = await handleSnippet(supabase as any, { text: "just plain text" });
  const body = await res.json();

  assertEquals(res.status, 200);
  assertEquals(supabase.lastInsertedRow?.content_md, "just plain text");
  assertEquals(body.bookmark.id, "b1");
});

Deno.test("handleSnippet: falls back to plain text when Turndown produces empty output", async () => {
  const supabase = fakeSupabase({ user: { id: "user-1" } });
  const res = await handleSnippet(supabase as any, { html: "<!-- comment only -->", text: "the text" });
  const body = await res.json();

  assertEquals(res.status, 200);
  assertEquals(supabase.lastInsertedRow?.content_md, "the text");
});

Deno.test("handleSnippet: returns 400 when both html and text are empty", async () => {
  const supabase = fakeSupabase({ user: { id: "user-1" } });
  const res = await handleSnippet(supabase as any, { html: "", text: "" });
  assertEquals(res.status, 400);
});

Deno.test("corsHeaders: allows the apikey header supabase-js attaches to functions.invoke calls", () => {
  assertStringIncludes(corsHeaders["Access-Control-Allow-Headers"], "apikey");
});

Deno.test("handleSnippet: returns 401 when unauthenticated", async () => {
  const supabase = fakeSupabase({ user: null });
  const res = await handleSnippet(supabase as any, { text: "hello" });
  assertEquals(res.status, 401);
});

Deno.test("handleSnippet: returns 500 with the DB error message on insert failure", async () => {
  const supabase = fakeSupabase({
    user: { id: "user-1" },
    insertResult: { data: undefined, error: { message: "insert failed" } },
  });
  const res = await handleSnippet(supabase as any, { text: "hello" });
  const body = await res.json();

  assertEquals(res.status, 500);
  assertEquals(body, "insert failed");
});
