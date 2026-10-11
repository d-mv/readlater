import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1.0.19";
import { corsHeaders, handleRequest, handleSnippet } from "./index.ts";

function fakeSupabase(opts: {
  user?: { id: string } | null;
  insertResult?: { data?: unknown; error?: { message: string } };
  rateLimit?: { data: unknown; error?: { message: string } | null };
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
  const rpc = (_fn: string, _args: Record<string, unknown>) =>
    Promise.resolve(opts.rateLimit ?? { data: true, error: null });
  return {
    auth: { getUser: () => Promise.resolve({ data: { user: opts.user ?? null } }) },
    from,
    rpc,
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
  assertEquals(supabase.lastInsertedRow?.word_count, 2);
  assertEquals(supabase.lastInsertedRow?.reading_time, 1);
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

Deno.test("handleSnippet: returns a generic 500 (no DB error text) on insert failure", async () => {
  const supabase = fakeSupabase({
    user: { id: "user-1" },
    insertResult: { data: undefined, error: { message: "insert failed" } },
  });
  const res = await handleSnippet(supabase as any, { text: "hello" });
  const body = await res.json();

  assertEquals(res.status, 500);
  assertEquals(body, "internal error");
});

Deno.test("handleSnippet: returns 429 and inserts nothing when the rate limit refuses", async () => {
  const supabase = fakeSupabase({ user: { id: "user-1" }, rateLimit: { data: false, error: null } });
  // deno-lint-ignore no-explicit-any
  const res = await handleSnippet(supabase as any, { text: "hello" });
  assertEquals(res.status, 429);
  assertEquals(supabase.lastInsertedRow, undefined);
});

Deno.test("handleSnippet: unwraps a link around an image like the worker does", async () => {
  const supabase = fakeSupabase({ user: { id: "user-1" } });
  const html = '<p><a href="https://x.test/a.png"><img src="https://x.test/a.png"></a></p>';
  // deno-lint-ignore no-explicit-any
  await handleSnippet(supabase as any, { html, text: "pic" });
  assertEquals(supabase.lastInsertedRow?.content_md, "![](https://x.test/a.png)");
});

Deno.test("handleRequest: malformed JSON is a 400 with CORS headers", async () => {
  const req = new Request("http://localhost/snippet", { method: "POST", body: "not json" });
  // deno-lint-ignore no-explicit-any
  const res = await handleRequest(req, () => fakeSupabase({ user: { id: "user-1" } }) as any);
  assertEquals(res.status, 400);
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), "*");
});

Deno.test("handleRequest: a body over 1 MB is a 413 with CORS headers", async () => {
  const supabase = fakeSupabase({ user: { id: "user-1" } });
  const req = new Request("http://localhost/snippet", {
    method: "POST",
    body: JSON.stringify({ text: "a".repeat(1024 * 1024) }),
  });
  // deno-lint-ignore no-explicit-any
  const res = await handleRequest(req, () => supabase as any);
  assertEquals(res.status, 413);
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), "*");
  assertEquals(supabase.lastInsertedRow, undefined);
});
