import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1.0.19";
import { corsHeaders, handleFileImport, handleRequest, handlerFromEnv } from "./index.ts";
import { quietly, stubFetch, withEnv } from "../_shared/testing.ts";

function fakeSupabase(opts: {
  user?: { id: string } | null;
  insertResult?: { data?: unknown; error?: { message: string } };
  rateLimit?: { data: unknown; error?: { message: string } | null };
}) {
  const single = () => Promise.resolve(opts.insertResult ?? { data: { id: "b1" }, error: null });
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

Deno.test("handleFileImport: returns a generic 500 (no DB error text) on insert failure", async () => {
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
  assertEquals(body, "internal error");
});

Deno.test("handleFileImport: returns 429 and inserts nothing when the rate limit refuses", async () => {
  const supabase = fakeSupabase({ user: { id: "user-1" }, rateLimit: { data: false, error: null } });
  const res = await handleFileImport(
    // deno-lint-ignore no-explicit-any
    supabase as any,
    { filename: "notes.md", contentBase64: b64("hi") },
  );
  assertEquals(res.status, 429);
  assertEquals(supabase.lastInsertedRow, undefined);
});

Deno.test("handleRequest: malformed JSON is a 400 with CORS headers", async () => {
  const req = new Request("http://localhost/file-import", { method: "POST", body: "[1,2" });
  // deno-lint-ignore no-explicit-any
  const res = await handleRequest(req, () => fakeSupabase({ user: { id: "user-1" } }) as any);
  assertEquals(res.status, 400);
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), "*");
});

Deno.test("handleRequest: a body over 10 MB is a 413 with CORS headers", async () => {
  const supabase = fakeSupabase({ user: { id: "user-1" } });
  const req = new Request("http://localhost/file-import", {
    method: "POST",
    body: JSON.stringify({ filename: "big.md", contentBase64: "a".repeat(10 * 1024 * 1024) }),
  });
  // deno-lint-ignore no-explicit-any
  const res = await handleRequest(req, () => supabase as any);
  assertEquals(res.status, 413);
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), "*");
  assertEquals(supabase.lastInsertedRow, undefined);
});

Deno.test("corsHeaders: allows the apikey header supabase-js attaches to functions.invoke calls", () => {
  assertStringIncludes(corsHeaders["Access-Control-Allow-Headers"], "apikey");
});

// deno-lint-ignore no-explicit-any
const asClient = (s: unknown) => s as any;

// A minimal real .docx (a Heading 1 "Report" and a paragraph with a bold
// run), built with Python's zipfile: exercises the default mammoth +
// Turndown converter rather than an injected stand-in.
const DOCX_BASE64 = [
  "UEsDBBQAAAAIADddTF3MVIwQ4AAAAJwBAAATAAAAW0NvbnRlbnRfVHlwZXNdLnhtbH2Qy07DMBBFf8XyFsUTukAIJekCyhJYlA+w",
  "7Eli4Zc8bil/z6QtXaDC0r6PM7rd+hC82GMhl2Ivb1UrBUaTrItTL9+3z829XA/d9isjCbZG6uVca34AIDNj0KRSxsjKmErQlZ9l",
  "gqzNh54QVm17BybFirE2demQQ/eEo975KjYH/j5hC3qS4vFkXFi91Dl7Z3RlHfbR/qI0Z4Li5NFDs8t0wwYJVwmL8jfgnHvlHYqz",
  "KN50qS86sAs+U7Fgk9kFTqr/a67cmcbRGbzkl7ZckkEiHjh4dVGCdvHnfjjOPXwDUEsDBBQAAAAIADddTF02V97cogAAABgBAAAL",
  "AAAAX3JlbHMvLnJlbHONzzsOwjAMBuCrRN6pCwNCqGkXhNQVlQNEiZtGNA8l4XV7MjBQxMBo+/dnuekedmY3isl4x2Fd1cDISa+M",
  "0xzOw3G1g65tTjSLXBJpMiGxsuIShynnsEdMciIrUuUDuTIZfbQilzJqDEJehCbc1PUW46cBS5P1ikPs1RrY8Az0j+3H0Ug6eHm1",
  "5PKPE1+JIouoKXO4+6hQvdtVYQHbBhcvti9QSwMEFAAAAAgAN11MXYny0FHZAAAAhQEAABEAAAB3b3JkL2RvY3VtZW50LnhtbHWQ",
  "TW7DIBCFr4LY1zhdVBUyZBd1GTXtATBME0v8aZjYye1r7CZVpXTzRsN8vHnQbS/BsxGwDCkqvmlaziDa5IZ4VPzzY/f0yre6m6RL",
  "9hwgEpv5WOSk+IkoSyGKPUEwpUkZ4jz7ShgMzS0exZTQZUwWSpntghfPbfsighkir5Z9ctda8yJ7XMqBrh7YJEfjFX8DU4NsuNCd",
  "uDOLkH6HnJDqOS1TXJm744rVvLJkY0HxjFAAR+B67+cQ7M/dm6w7+nXjT0e6T949wv/xZwQXah5kE7dni98v1d9QSwECFAMUAAAA",
  "CAA3XUxdzFSMEOAAAACcAQAAEwAAAAAAAAAAAAAAgAEAAAAAW0NvbnRlbnRfVHlwZXNdLnhtbFBLAQIUAxQAAAAIADddTF02V97c",
  "ogAAABgBAAALAAAAAAAAAAAAAACAAREBAABfcmVscy8ucmVsc1BLAQIUAxQAAAAIADddTF2J8tBR2QAAAIUBAAARAAAAAAAAAAAA",
  "AACAAdwBAAB3b3JkL2RvY3VtZW50LnhtbFBLBQYAAAAAAwADALkAAADkAgAAAAA=",
].join("");

Deno.test("handleFileImport: converts a real .docx with the default converter", async () => {
  const supabase = fakeSupabase({ user: { id: "user-1" } });
  const res = await handleFileImport(asClient(supabase), { filename: "report.docx", contentBase64: DOCX_BASE64 });
  assertEquals(res.status, 200);
  assertEquals(supabase.lastInsertedRow?.content_md, "Report\n======\n\nPlain **bold** text.");
  assertEquals(supabase.lastInsertedRow?.title, "report");
});

Deno.test("handleFileImport: a missing or non-string filename or content is a 400", async () => {
  const supabase = fakeSupabase({ user: { id: "user-1" } });
  const inputs = [
    {},
    { filename: "notes.md" },
    { contentBase64: b64("hi") },
    { filename: 7, contentBase64: b64("hi") },
    { filename: "notes.md", contentBase64: ["hi"] },
  ];
  for (const input of inputs) {
    const res = await handleFileImport(asClient(supabase), input);
    assertEquals(res.status, 400);
    assertEquals(await res.json(), "file is empty");
  }
  assertEquals(supabase.lastInsertedRow, undefined);
});

Deno.test("handleFileImport: content that isn't valid base64 is a 400", async () => {
  const supabase = fakeSupabase({ user: { id: "user-1" } });
  const res = await handleFileImport(asClient(supabase), { filename: "notes.md", contentBase64: "not base64!" });
  assertEquals(res.status, 400);
  assertEquals(await res.json(), "file could not be decoded");
});

Deno.test("handleFileImport: a failed rate-limit RPC is a 500, not a pass", async () => {
  const supabase = fakeSupabase({ user: { id: "user-1" }, rateLimit: { data: null, error: { message: "rpc down" } } });
  const res = await quietly(() =>
    handleFileImport(asClient(supabase), { filename: "notes.md", contentBase64: b64("hi") })
  );
  assertEquals(res.status, 500);
  assertEquals(supabase.lastInsertedRow, undefined);
});

Deno.test("handleFileImport: a file with only whitespace (or a docx converting to nothing) is a 400", async () => {
  const supabase = fakeSupabase({ user: { id: "user-1" } });
  const md = await handleFileImport(asClient(supabase), { filename: "blank.md", contentBase64: b64(" \n\t\n") });
  assertEquals(md.status, 400);
  assertEquals(await md.json(), "file is empty");

  const docx = await handleFileImport(
    asClient(supabase),
    { filename: "blank.docx", contentBase64: b64("stand-in") },
    () => Promise.resolve("\n\n"),
  );
  assertEquals(docx.status, 400);
  assertEquals(supabase.lastInsertedRow, undefined);
});

Deno.test("handleRequest: CORS preflight is answered without touching Supabase", async () => {
  let clients = 0;
  const req = new Request("http://localhost/file-import", { method: "OPTIONS" });
  const res = await handleRequest(req, () => {
    clients++;
    return asClient(fakeSupabase({}));
  });
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("Access-Control-Allow-Headers"), corsHeaders["Access-Control-Allow-Headers"]);
  assertEquals(clients, 0);
});

Deno.test("handleRequest: methods other than POST are a 404 with CORS headers", async () => {
  const res = await handleRequest(
    new Request("http://localhost/file-import", { method: "GET" }),
    () => asClient(fakeSupabase({})),
  );
  assertEquals(res.status, 404);
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), "*");
});

Deno.test("handleRequest: a valid POST imports as the caller, forwarding their Authorization", async () => {
  const supabase = fakeSupabase({ user: { id: "user-1" } });
  const seen: string[] = [];
  const body = JSON.stringify({ filename: "notes.md", contentBase64: b64("hello") });
  const makeClient = (authorization: string) => {
    seen.push(authorization);
    return asClient(supabase);
  };

  const withAuth = new Request("http://localhost/file-import", {
    method: "POST",
    headers: { Authorization: "Bearer user-jwt" },
    body,
  });
  assertEquals((await handleRequest(withAuth, makeClient)).status, 200);
  assertEquals(supabase.lastInsertedRow?.content_md, "hello");

  const withoutAuth = new Request("http://localhost/file-import", { method: "POST", body });
  await handleRequest(withoutAuth, makeClient);
  assertEquals(seen, ["Bearer user-jwt", ""]);
});

const deployedEnv = { SUPABASE_URL: "http://supabase.test", SUPABASE_ANON_KEY: "anon-key" };

Deno.test(
  "handlerFromEnv: authenticates the caller's own JWT against Supabase Auth",
  withEnv(deployedEnv, async () => {
    const net = stubFetch({ "/auth/v1/user": () => Response.json({ message: "invalid JWT" }, { status: 401 }) });
    try {
      const req = new Request("http://localhost/file-import", {
        method: "POST",
        headers: { Authorization: "Bearer user-jwt" },
        body: JSON.stringify({ filename: "notes.md", contentBase64: b64("hello") }),
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
