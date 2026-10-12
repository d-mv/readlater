import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1.0.19";
import { corsHeaders, handlePdfImport, handleRequest, handlerFromEnv } from "./index.ts";
import { quietly, stubFetch, withEnv } from "../_shared/testing.ts";

function fakeSupabase(opts: {
  user?: { id: string } | null;
  insertResult?: { data?: unknown; error?: { message: string } };
  uploadError?: { message: string };
  removeError?: { message: string };
  rateLimit?: { data: unknown; error?: { message: string } | null };
  events?: string[];
}) {
  const events = opts.events ?? [];
  let lastInsertedRow: Record<string, unknown> | undefined;
  let lastUploadPath: string | undefined;
  const removed: string[] = [];

  const single = () => Promise.resolve(opts.insertResult ?? { data: { id: "b1" }, error: null });
  const select = (_cols: string) => ({ single });
  const insert = (row: Record<string, unknown>) => {
    events.push("insert");
    lastInsertedRow = row;
    return { select };
  };
  const from = (_table: string) => ({ insert });

  let lastUploadOptions: unknown;
  let lastUploadBytes: Uint8Array | undefined;
  const storageFrom = (_bucket: string) => ({
    upload: (path: string, bytes: Uint8Array, uploadOptions: unknown) => {
      lastUploadBytes = bytes;
      events.push("upload");
      lastUploadPath = path;
      lastUploadOptions = uploadOptions;
      return Promise.resolve({ error: opts.uploadError ?? null });
    },
    remove: (paths: string[]) => {
      events.push("remove");
      removed.push(...paths);
      return Promise.resolve({ error: opts.removeError ?? null });
    },
  });

  const rpc = (_fn: string, _args: Record<string, unknown>) => {
    events.push("rate-limit");
    return Promise.resolve(opts.rateLimit ?? { data: true, error: null });
  };

  return {
    auth: { getUser: () => Promise.resolve({ data: { user: opts.user ?? null } }) },
    from,
    rpc,
    storage: { from: storageFrom },
    events,
    get lastInsertedRow() {
      return lastInsertedRow;
    },
    get lastUploadPath() {
      return lastUploadPath;
    },
    get lastUploadBytes() {
      return lastUploadBytes;
    },
    get lastUploadOptions() {
      return lastUploadOptions;
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
  // Path is a fresh UUID per upload and never overwritten, so it's safe (and
  // cheaper on repeat "view original" opens) to cache it long-term.
  assertEquals(
    (supabase.lastUploadOptions as { cacheControl?: string } | undefined)?.cacheControl,
    "31536000",
  );
  assertEquals(body.bookmark.id, "b1");
});

function assertMatchUserPrefix(path: string | undefined, userId: string) {
  assertStringIncludes(path ?? "", `${userId}/`);
}

Deno.test("handlePdfImport: rate-limits, extracts, then uploads, then inserts — in that order", async () => {
  const events: string[] = [];
  const supabase = fakeSupabase({ user: { id: "user-1" }, events });
  await handlePdfImport(
    // deno-lint-ignore no-explicit-any
    supabase as any,
    { filename: "report.pdf", contentBase64: b64("bytes") },
    () => {
      events.push("extract");
      return Promise.resolve("text");
    },
  );
  assertEquals(events, ["rate-limit", "extract", "upload", "insert"]);
});

Deno.test("handlePdfImport: an extraction that never settles leaves nothing in Storage", async () => {
  const events: string[] = [];
  const supabase = fakeSupabase({ user: { id: "user-1" }, events });
  let release!: () => void;
  const pending = handlePdfImport(
    // deno-lint-ignore no-explicit-any
    supabase as any,
    { filename: "report.pdf", contentBase64: b64("bytes") },
    () =>
      new Promise((resolve) => {
        events.push("extract");
        release = () => resolve("");
      }),
  );
  await new Promise((r) => setTimeout(r, 0));
  // Simulates the function being killed mid-extraction: no upload has happened.
  assertEquals(events, ["rate-limit", "extract"]);
  release();
  await pending;
});

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

Deno.test("handlePdfImport: a storage upload failure is a generic 500 and inserts nothing", async () => {
  const supabase = fakeSupabase({ user: { id: "user-1" }, uploadError: { message: "storage down" } });
  const res = await handlePdfImport(
    // deno-lint-ignore no-explicit-any
    supabase as any,
    { filename: "report.pdf", contentBase64: b64("bytes") },
    () => Promise.resolve("text"),
  );
  const body = await res.json();
  assertEquals(res.status, 500);
  assertEquals(body, "internal error");
  assertEquals(supabase.lastInsertedRow, undefined);
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
  assertEquals(body, "internal error");
  assertEquals(supabase.removed, [supabase.lastUploadPath]);
  assertEquals(supabase.events, ["rate-limit", "upload", "insert", "remove"]);
});

Deno.test("handlePdfImport: still answers a generic 500 when cleanup also fails", async () => {
  const supabase = fakeSupabase({
    user: { id: "user-1" },
    insertResult: { data: undefined, error: { message: "insert failed" } },
    removeError: { message: "storage down" },
  });
  const res = await handlePdfImport(
    // deno-lint-ignore no-explicit-any
    supabase as any,
    { filename: "report.pdf", contentBase64: b64("bytes") },
    () => Promise.resolve("text"),
  );
  assertEquals(res.status, 500);
  assertEquals(await res.json(), "internal error");
});

Deno.test("handlePdfImport: returns 429 and touches nothing when the rate limit refuses", async () => {
  const supabase = fakeSupabase({ user: { id: "user-1" }, rateLimit: { data: false, error: null } });
  const res = await handlePdfImport(
    // deno-lint-ignore no-explicit-any
    supabase as any,
    { filename: "report.pdf", contentBase64: b64("bytes") },
    () => Promise.resolve("text"),
  );
  assertEquals(res.status, 429);
  assertEquals(supabase.events, ["rate-limit"]);
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

Deno.test("handleRequest: malformed JSON is a 400 with CORS headers", async () => {
  const req = new Request("http://localhost/pdf-import", { method: "POST", body: "" });
  // deno-lint-ignore no-explicit-any
  const res = await handleRequest(req, () => fakeSupabase({ user: { id: "user-1" } }) as any);
  assertEquals(res.status, 400);
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), "*");
});

Deno.test("handleRequest: a declared body over 28 MB is a 413 before anything is read", async () => {
  const supabase = fakeSupabase({ user: { id: "user-1" } });
  const req = new Request("http://localhost/pdf-import", {
    method: "POST",
    headers: { "content-length": String(29 * 1024 * 1024) },
    body: "{}",
  });
  // deno-lint-ignore no-explicit-any
  const res = await handleRequest(req, () => supabase as any);
  assertEquals(res.status, 413);
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), "*");
  assertEquals(supabase.events, []);
});

// deno-lint-ignore no-explicit-any
const asClient = (s: unknown) => s as any;

// A minimal real one-page PDF (Helvetica, the text "Hello from a PDF"):
// exercises the default unpdf extractor rather than an injected stand-in.
const PDF_BASE64 = [
  "JVBERi0xLjQKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCjIgMCBvYmoKPDwgL1R5cGUg",
  "L1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAg",
  "UiAvTWVkaWFCb3ggWzAgMCA2MTIgNzkyXSAvQ29udGVudHMgNCAwIFIgL1Jlc291cmNlcyA8PCAvRm9udCA8PCAvRjEgNSAwIFIg",
  "Pj4gPj4gPj4KZW5kb2JqCjQgMCBvYmoKPDwgL0xlbmd0aCA0NyA+PgpzdHJlYW0KQlQgL0YxIDEyIFRmIDcyIDcyMCBUZCAoSGVs",
  "bG8gZnJvbSBhIFBERikgVGogRVQKZW5kc3RyZWFtCmVuZG9iago1IDAgb2JqCjw8IC9UeXBlIC9Gb250IC9TdWJ0eXBlIC9UeXBl",
  "MSAvQmFzZUZvbnQgL0hlbHZldGljYSA+PgplbmRvYmoKeHJlZgowIDYKMDAwMDAwMDAwMCA2NTUzNSBmIAowMDAwMDAwMDA5IDAw",
  "MDAwIG4gCjAwMDAwMDAwNTggMDAwMDAgbiAKMDAwMDAwMDExNSAwMDAwMCBuIAowMDAwMDAwMjQxIDAwMDAwIG4gCjAwMDAwMDAz",
  "MzggMDAwMDAgbiAKdHJhaWxlcgo8PCAvU2l6ZSA2IC9Sb290IDEgMCBSID4+CnN0YXJ0eHJlZgo0MDgKJSVFT0YK",
].join("");

Deno.test("handlePdfImport: extracts a real PDF's text and uploads the original bytes intact", async () => {
  const supabase = fakeSupabase({ user: { id: "user-1" } });
  const res = await handlePdfImport(asClient(supabase), { filename: "hello.pdf", contentBase64: PDF_BASE64 });
  assertEquals(res.status, 200);
  assertEquals(supabase.lastInsertedRow?.content_md, "Hello from a PDF");
  assertEquals(supabase.lastInsertedRow?.pdf_parsed, true);
  assertEquals(supabase.lastInsertedRow?.word_count, 4);
  // pdf.js may detach the buffer it parses; the upload must still get every byte.
  assertEquals(supabase.lastUploadBytes, Uint8Array.from(atob(PDF_BASE64), (c) => c.charCodeAt(0)));
});

Deno.test("handlePdfImport: a missing or non-string filename or content is a 400", async () => {
  const supabase = fakeSupabase({ user: { id: "user-1" } });
  const inputs = [
    {},
    { filename: "a.pdf" },
    { contentBase64: b64("x") },
    { filename: null, contentBase64: b64("x") },
    { filename: "a.pdf", contentBase64: 1 },
  ];
  for (const input of inputs) {
    const res = await handlePdfImport(asClient(supabase), input);
    assertEquals(res.status, 400);
    assertEquals(await res.json(), "file is empty");
  }
  assertEquals(supabase.events, []);
});

Deno.test("handlePdfImport: content that isn't valid base64 is a 400", async () => {
  const supabase = fakeSupabase({ user: { id: "user-1" } });
  const res = await handlePdfImport(asClient(supabase), { filename: "a.pdf", contentBase64: "%%%" });
  assertEquals(res.status, 400);
  assertEquals(await res.json(), "file could not be decoded");
  assertEquals(supabase.events, []);
});

Deno.test("handlePdfImport: a failed rate-limit RPC is a 500 and touches nothing", async () => {
  const supabase = fakeSupabase({ user: { id: "user-1" }, rateLimit: { data: null, error: { message: "rpc down" } } });
  const res = await quietly(() =>
    handlePdfImport(asClient(supabase), { filename: "a.pdf", contentBase64: b64("x") }, () => Promise.resolve("t"))
  );
  assertEquals(res.status, 500);
  assertEquals(supabase.events, ["rate-limit"]);
});

Deno.test("handleRequest: CORS preflight is answered without touching Supabase", async () => {
  let clients = 0;
  const res = await handleRequest(new Request("http://localhost/pdf-import", { method: "OPTIONS" }), () => {
    clients++;
    return asClient(fakeSupabase({}));
  });
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("Access-Control-Allow-Methods"), "POST, OPTIONS");
  assertEquals(clients, 0);
});

Deno.test("handleRequest: methods other than POST are a 404 with CORS headers", async () => {
  const res = await handleRequest(
    new Request("http://localhost/pdf-import", { method: "PUT", body: "{}" }),
    () => asClient(fakeSupabase({})),
  );
  assertEquals(res.status, 404);
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), "*");
});

Deno.test("handleRequest: a valid POST imports as the caller, forwarding their Authorization", async () => {
  const seen: string[] = [];
  const makeClient = (authorization: string) => {
    seen.push(authorization);
    return asClient(fakeSupabase({ user: null }));
  };
  const body = JSON.stringify({ filename: "a.pdf", contentBase64: b64("x") });
  const withAuth = new Request("http://localhost/pdf-import", {
    method: "POST",
    headers: { Authorization: "Bearer user-jwt" },
    body,
  });
  assertEquals((await handleRequest(withAuth, makeClient)).status, 401);
  await handleRequest(new Request("http://localhost/pdf-import", { method: "POST", body }), makeClient);
  assertEquals(seen, ["Bearer user-jwt", ""]);
});

Deno.test(
  "handlerFromEnv: authenticates the caller's own JWT against Supabase Auth",
  withEnv({ SUPABASE_URL: "http://supabase.test", SUPABASE_ANON_KEY: "anon-key" }, async () => {
    const net = stubFetch({ "/auth/v1/user": () => Response.json({ message: "invalid JWT" }, { status: 401 }) });
    try {
      const req = new Request("http://localhost/pdf-import", {
        method: "POST",
        headers: { Authorization: "Bearer user-jwt" },
        body: JSON.stringify({ filename: "a.pdf", contentBase64: b64("x") }),
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
