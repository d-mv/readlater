import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1.0.19";
import { corsHeaders, handleRequest, handlerFromEnv, handleSnippet } from "./index.ts";
import { quietly, stubFetch, withEnv } from "../_shared/testing.ts";

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
  const res = await handleSnippet(asClient(supabase), { text: "just plain text" });
  const body = await res.json();

  assertEquals(res.status, 200);
  assertEquals(supabase.lastInsertedRow?.content_md, "just plain text");
  assertEquals(body.bookmark.id, "b1");
});

Deno.test("handleSnippet: falls back to plain text when Turndown produces empty output", async () => {
  const supabase = fakeSupabase({ user: { id: "user-1" } });
  const res = await handleSnippet(asClient(supabase), { html: "<!-- comment only -->", text: "the text" });

  assertEquals(res.status, 200);
  assertEquals(supabase.lastInsertedRow?.content_md, "the text");
});

Deno.test("handleSnippet: returns 400 when both html and text are empty", async () => {
  const supabase = fakeSupabase({ user: { id: "user-1" } });
  const res = await handleSnippet(asClient(supabase), { html: "", text: "" });
  assertEquals(res.status, 400);
});

Deno.test("corsHeaders: allows the apikey header supabase-js attaches to functions.invoke calls", () => {
  assertStringIncludes(corsHeaders["Access-Control-Allow-Headers"], "apikey");
});

Deno.test("handleSnippet: returns 401 when unauthenticated", async () => {
  const supabase = fakeSupabase({ user: null });
  const res = await handleSnippet(asClient(supabase), { text: "hello" });
  assertEquals(res.status, 401);
});

Deno.test("handleSnippet: returns a generic 500 (no DB error text) on insert failure", async () => {
  const supabase = fakeSupabase({
    user: { id: "user-1" },
    insertResult: { data: undefined, error: { message: "insert failed" } },
  });
  const res = await handleSnippet(asClient(supabase), { text: "hello" });
  const body = await res.json();

  assertEquals(res.status, 500);
  assertEquals(body, "internal error");
});

Deno.test("handleSnippet: returns 429 and inserts nothing when the rate limit refuses", async () => {
  const supabase = fakeSupabase({ user: { id: "user-1" }, rateLimit: { data: false, error: null } });
  const res = await handleSnippet(asClient(supabase), { text: "hello" });
  assertEquals(res.status, 429);
  assertEquals(supabase.lastInsertedRow, undefined);
});

Deno.test("handleSnippet: unwraps a link around an image like the worker does", async () => {
  const supabase = fakeSupabase({ user: { id: "user-1" } });
  const html = '<p><a href="https://x.test/a.png"><img src="https://x.test/a.png"></a></p>';
  await handleSnippet(asClient(supabase), { html, text: "pic" });
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

// deno-lint-ignore no-explicit-any
const asClient = (s: unknown) => s as any;

Deno.test("handleSnippet: non-string html/text count as empty", async () => {
  const supabase = fakeSupabase({ user: { id: "user-1" } });
  const res = await handleSnippet(asClient(supabase), { html: { tag: "p" }, text: 42 });
  assertEquals(res.status, 400);
  assertEquals(await res.json(), "snippet is empty");
  assertEquals(supabase.lastInsertedRow, undefined);
});

Deno.test("handleSnippet: whitespace-only html and text is a 400 before rate limiting", async () => {
  let rpcCalls = 0;
  const supabase = fakeSupabase({ user: { id: "user-1" } });
  const rpc = supabase.rpc;
  supabase.rpc = (fn, args) => {
    rpcCalls++;
    return rpc(fn, args);
  };
  const res = await handleSnippet(asClient(supabase), { html: "  ", text: "\n" });
  assertEquals(res.status, 400);
  assertEquals(rpcCalls, 0);
});

Deno.test("handleSnippet: html that converts to nothing with no text is a 400", async () => {
  const supabase = fakeSupabase({ user: { id: "user-1" } });
  const res = await handleSnippet(asClient(supabase), { html: "<!-- comment only -->" });
  assertEquals(res.status, 400);
  assertEquals(await res.json(), "snippet is empty");
  assertEquals(supabase.lastInsertedRow, undefined);
});

Deno.test("handleSnippet: a failed rate-limit RPC is a 500, not a pass", async () => {
  const supabase = fakeSupabase({ user: { id: "user-1" }, rateLimit: { data: null, error: { message: "rpc down" } } });
  const res = await quietly(() => handleSnippet(asClient(supabase), { text: "keep this" }));
  assertEquals(res.status, 500);
  assertEquals(supabase.lastInsertedRow, undefined);
});

Deno.test("handleRequest: CORS preflight is answered without touching Supabase", async () => {
  let clients = 0;
  const res = await handleRequest(new Request("http://localhost/snippet", { method: "OPTIONS" }), () => {
    clients++;
    return asClient(fakeSupabase({}));
  });
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("Access-Control-Allow-Headers"), corsHeaders["Access-Control-Allow-Headers"]);
  assertEquals(clients, 0);
});

Deno.test("handleRequest: methods other than POST are a 404 with CORS headers", async () => {
  const res = await handleRequest(
    new Request("http://localhost/snippet", { method: "GET" }),
    () => asClient(fakeSupabase({})),
  );
  assertEquals(res.status, 404);
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), "*");
});

Deno.test("handleRequest: a valid POST saves the snippet as the caller, forwarding their Authorization", async () => {
  const supabase = fakeSupabase({ user: { id: "user-1" } });
  const seen: string[] = [];
  const makeClient = (authorization: string) => {
    seen.push(authorization);
    return asClient(supabase);
  };
  const body = JSON.stringify({ text: "keep this" });
  const withAuth = new Request("http://localhost/snippet", {
    method: "POST",
    headers: { Authorization: "Bearer user-jwt" },
    body,
  });
  assertEquals((await handleRequest(withAuth, makeClient)).status, 200);
  assertEquals(supabase.lastInsertedRow?.content_md, "keep this");
  await handleRequest(new Request("http://localhost/snippet", { method: "POST", body }), makeClient);
  assertEquals(seen, ["Bearer user-jwt", ""]);
});

Deno.test(
  "handlerFromEnv: authenticates the caller's own JWT against Supabase Auth",
  withEnv({ SUPABASE_URL: "http://supabase.test", SUPABASE_ANON_KEY: "anon-key" }, async () => {
    const net = stubFetch({ "/auth/v1/user": () => Response.json({ message: "invalid JWT" }, { status: 401 }) });
    try {
      const req = new Request("http://localhost/snippet", {
        method: "POST",
        headers: { Authorization: "Bearer user-jwt" },
        body: JSON.stringify({ text: "keep this" }),
      });
      const res = await handlerFromEnv()(req);
      assertEquals(res.status, 401);
      assertEquals(net.calls.map((c) => `${c.method} ${c.path}`), ["GET /auth/v1/user"]);
      assertEquals(net.calls[0].headers.get("Authorization"), "Bearer user-jwt");
      assertEquals(net.calls[0].headers.get("apikey"), "anon-key");
    } finally {
      net.restore();
    }
  }),
);
