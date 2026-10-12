import { assertEquals } from "jsr:@std/assert@1.0.19";
import { quietly, stubFetch, withEnv } from "../_shared/testing.ts";
import {
  handleCapture,
  handleRefresh,
  handleRequest,
  handlerFromEnv,
  insertReadyNote,
  MAX_TEXT_CHARS,
  MAX_TITLE_CHARS,
  MAX_URL_CHARS,
} from "./index.ts";

const OWNER = "owner-1";
const BOOKMARK_ID = "6f1c1c3e-2b4a-4c55-9d1e-0a3b5c7d9e11";

function fakeSupabase(opts: {
  contentEdited?: boolean;
  updateError?: { message: string };
  updatedRows?: { id: string }[] | null;
  rateLimit?: { data: unknown; error?: { message: string } | null };
  insertResult?: { data: unknown; error: unknown };
  // What the post-conflict lookup by url_normalized finds.
  existing?: { id: string; title: string | null; created_at: string } | null;
  // The refresh's content_edited lookup sees no row.
  contentLookupMissing?: boolean;
}) {
  let lastUpdatedRow: Record<string, unknown> | undefined;
  let lastInsertedRow: Record<string, unknown> | undefined;
  const lookups: { col: string; val: string }[] = [];
  const rpcCalls: { fn: string; args: Record<string, unknown> }[] = [];

  const select = (_cols: string) => ({
    eq: (col: string, val: string) => ({
      maybeSingle: () => {
        if (col === "url_normalized") {
          lookups.push({ col, val });
          return Promise.resolve({ data: opts.existing ?? null });
        }
        return Promise.resolve({
          data: opts.contentLookupMissing ? null : { content_edited: opts.contentEdited ?? false },
        });
      },
    }),
  });

  const selectAfterUpdate = (_cols: string) =>
    Promise.resolve(
      opts.updateError
        ? { data: null, error: opts.updateError }
        : { data: opts.updatedRows === undefined ? [{ id: BOOKMARK_ID }] : opts.updatedRows, error: null },
    );
  const not = () => ({ select: selectAfterUpdate });
  const eqUpdate = (_col: string, _val: string) => ({ not });
  const update = (row: Record<string, unknown>) => {
    lastUpdatedRow = row;
    return { eq: eqUpdate };
  };

  const insert = (row: Record<string, unknown>) => {
    lastInsertedRow = row;
    return {
      select: (_cols: string) => ({
        single: () => Promise.resolve(opts.insertResult ?? { data: { id: "n1" }, error: null }),
      }),
    };
  };

  const from = (_table: string) => ({ select, update, insert });
  const rpc = (fn: string, args: Record<string, unknown>) => {
    rpcCalls.push({ fn, args });
    return Promise.resolve(opts.rateLimit ?? { data: true, error: null });
  };
  return {
    from,
    rpc,
    rpcCalls,
    lookups,
    get lastUpdatedRow() {
      return lastUpdatedRow;
    },
    get lastInsertedRow() {
      return lastInsertedRow;
    },
  };
}

Deno.test("handleRefresh: resets an un-edited bookmark to pending without asking to confirm", async () => {
  const supabase = fakeSupabase({ contentEdited: false });
  // deno-lint-ignore no-explicit-any
  const res = await handleRefresh(supabase as any, OWNER, BOOKMARK_ID, false);
  const body = await res.json();

  assertEquals(res.status, 200);
  assertEquals(body.status, "ok");
  assertEquals(supabase.lastUpdatedRow, { status: "pending", error_message: null, content_edited: false });
});

Deno.test("handleRefresh: returns 409 confirm_required for an edited bookmark when not forced", async () => {
  const supabase = fakeSupabase({ contentEdited: true });
  // deno-lint-ignore no-explicit-any
  const res = await handleRefresh(supabase as any, OWNER, BOOKMARK_ID, false);
  const body = await res.json();

  assertEquals(res.status, 409);
  assertEquals(body.status, "confirm_required");
  assertEquals(supabase.lastUpdatedRow, undefined);
});

Deno.test("handleRefresh: proceeds for an edited bookmark when force=true, skipping the check", async () => {
  const supabase = fakeSupabase({ contentEdited: true });
  // deno-lint-ignore no-explicit-any
  const res = await handleRefresh(supabase as any, OWNER, BOOKMARK_ID, true);
  const body = await res.json();

  assertEquals(res.status, 200);
  assertEquals(body.status, "ok");
  assertEquals(supabase.lastUpdatedRow, { status: "pending", error_message: null, content_edited: false });
});

Deno.test("handleRefresh: returns a generic 500 (no DB error text) on update failure", async () => {
  const supabase = fakeSupabase({ contentEdited: false, updateError: { message: "update failed" } });
  // deno-lint-ignore no-explicit-any
  const res = await handleRefresh(supabase as any, OWNER, BOOKMARK_ID, false);
  const body = await res.json();

  assertEquals(res.status, 500);
  assertEquals(body, "internal error");
});

Deno.test("handleRefresh: returns 404 when the update matched no row", async () => {
  const supabase = fakeSupabase({ updatedRows: [] });
  // deno-lint-ignore no-explicit-any
  const res = await handleRefresh(supabase as any, OWNER, BOOKMARK_ID, true);
  assertEquals(res.status, 404);
});

Deno.test("handleRefresh: rejects a malformed id with 400", async () => {
  const supabase = fakeSupabase({});
  // deno-lint-ignore no-explicit-any
  const res = await handleRefresh(supabase as any, OWNER, "not-a-uuid", true);
  assertEquals(res.status, 400);
  assertEquals(supabase.lastUpdatedRow, undefined);
});

Deno.test("insertReadyNote: stores a ready note with word count and reading time", async () => {
  const supabase = fakeSupabase({});
  // deno-lint-ignore no-explicit-any
  const res = await insertReadyNote(supabase as any, OWNER, "a quick thought to keep");

  assertEquals(res.status, 200);
  assertEquals(supabase.lastInsertedRow, {
    url: null,
    type: "note",
    status: "ready",
    title: "a quick thought to keep",
    content_md: "a quick thought to keep",
    word_count: 5,
    reading_time: 1,
    user_id: OWNER,
  });
});

Deno.test("handleCapture: bumps the per-user capture limit as the owner via the service-role RPC", async () => {
  const supabase = fakeSupabase({});
  // deno-lint-ignore no-explicit-any
  const res = await handleCapture(supabase as any, OWNER, { url: "https://example.com/post" });

  assertEquals(res.status, 200);
  assertEquals(supabase.rpcCalls, [{
    fn: "bump_rate_limit_for_user",
    args: { p_user_id: OWNER, p_action: "capture", p_max: 120, p_window: "1 hour" },
  }]);
});

Deno.test("handleCapture: returns 429 and inserts nothing when the rate limit refuses", async () => {
  const supabase = fakeSupabase({ rateLimit: { data: false, error: null } });
  // deno-lint-ignore no-explicit-any
  const res = await handleCapture(supabase as any, OWNER, { url: "https://example.com/post" });

  assertEquals(res.status, 429);
  assertEquals(supabase.lastInsertedRow, undefined);
});

Deno.test("handleCapture: a rate-limit RPC that returns no row is an error, not a pass", async () => {
  const supabase = fakeSupabase({ rateLimit: { data: null, error: null } });
  // deno-lint-ignore no-explicit-any
  const res = await handleCapture(supabase as any, OWNER, { text: "a note" });

  assertEquals(res.status, 500);
  assertEquals(supabase.lastInsertedRow, undefined);
});

Deno.test("handleCapture: truncates an oversize title", async () => {
  const supabase = fakeSupabase({});
  await handleCapture(
    // deno-lint-ignore no-explicit-any
    supabase as any,
    OWNER,
    { url: "https://example.com/post", title: "t".repeat(MAX_TITLE_CHARS + 100) },
  );
  assertEquals((supabase.lastInsertedRow?.title as string).length, MAX_TITLE_CHARS);
});

Deno.test("handleCapture: refuses note text over the cap with 413", async () => {
  const supabase = fakeSupabase({});
  // deno-lint-ignore no-explicit-any
  const res = await handleCapture(supabase as any, OWNER, { text: "a".repeat(MAX_TEXT_CHARS + 1) });
  assertEquals(res.status, 413);
  assertEquals(supabase.lastInsertedRow, undefined);
});

Deno.test("handleCapture: insert failure is a generic 500 without the DB message", async () => {
  const supabase = fakeSupabase({
    insertResult: { data: null, error: { code: "XX000", message: "relation secret_table blew up" } },
  });
  // deno-lint-ignore no-explicit-any
  const res = await handleCapture(supabase as any, OWNER, { text: "a note" });
  assertEquals(res.status, 500);
  assertEquals(await res.json(), "internal error");
});

const env = { captureKey: "k3y", ownerUserId: OWNER };

function captureRequest(body: BodyInit, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/functions/v1/capture", {
    method: "POST",
    headers: { Authorization: "Bearer k3y", "content-type": "application/json", ...headers },
    body,
  });
}

Deno.test("handleRequest: malformed JSON is a 400 carrying CORS headers", async () => {
  const supabase = fakeSupabase({});
  // deno-lint-ignore no-explicit-any
  const res = await handleRequest(captureRequest("{not json"), supabase as any, env);

  assertEquals(res.status, 400);
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), "*");
});

Deno.test("handleRequest: a body over 1 MB is refused with 413 before parsing", async () => {
  const supabase = fakeSupabase({});
  const big = JSON.stringify({ text: "a".repeat(1024 * 1024) });
  // deno-lint-ignore no-explicit-any
  const res = await handleRequest(captureRequest(big), supabase as any, env);

  assertEquals(res.status, 413);
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), "*");
  assertEquals(supabase.lastInsertedRow, undefined);
});

Deno.test("handleRequest: refresh with no body is an unconfirmed refresh", async () => {
  const supabase = fakeSupabase({ contentEdited: true });
  const req = new Request(`http://localhost/functions/v1/capture/${BOOKMARK_ID}/refresh`, {
    method: "POST",
    headers: { Authorization: "Bearer k3y" },
  });
  // deno-lint-ignore no-explicit-any
  const res = await handleRequest(req, supabase as any, env);
  assertEquals(res.status, 409);
});

// deno-lint-ignore no-explicit-any
const asClient = (s: unknown) => s as any;

Deno.test("handleCapture: missing OWNER_USER_ID is a generic 500 that touches nothing", async () => {
  const supabase = fakeSupabase({});
  const res = await quietly(() => handleCapture(asClient(supabase), undefined, { text: "a note" }));
  assertEquals(res.status, 500);
  assertEquals(await res.json(), "internal error");
  assertEquals(supabase.rpcCalls, []);
});

Deno.test("handleCapture: a url over the cap is a 400", async () => {
  const supabase = fakeSupabase({});
  const url = "https://example.com/" + "a".repeat(MAX_URL_CHARS);
  const res = await handleCapture(asClient(supabase), OWNER, { url });
  assertEquals(res.status, 400);
  assertEquals(await res.json(), "url is too long");
  assertEquals(supabase.rpcCalls, []);
});

Deno.test("handleCapture: a non-http(s) url is a 400", async () => {
  const supabase = fakeSupabase({});
  const res = await handleCapture(asClient(supabase), OWNER, { url: "javascript:alert(1)" });
  assertEquals(res.status, 400);
  assertEquals(await res.json(), "invalid url");
  assertEquals(supabase.lastInsertedRow, undefined);
});

Deno.test("handleCapture: neither url nor text (or only whitespace) is a 400", async () => {
  const supabase = fakeSupabase({});
  for (const input of [{}, { url: "  ", text: "\n" }, { url: 42, text: null }]) {
    const res = await handleCapture(asClient(supabase), OWNER, input);
    assertEquals(res.status, 400);
    assertEquals(await res.json(), "capture requires url or text");
  }
  assertEquals(supabase.rpcCalls, []);
});

Deno.test("handleCapture: saves a url as a pending bookmark of the detected type", async () => {
  const supabase = fakeSupabase({ insertResult: { data: { id: "b9" }, error: null } });
  const res = await handleCapture(asClient(supabase), OWNER, {
    url: " https://youtu.be/abc ",
    title: "A video",
  });
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { status: "created", id: "b9" });
  assertEquals(supabase.lastInsertedRow, {
    url: "https://youtu.be/abc",
    title: "A video",
    type: "youtube",
    status: "pending",
    user_id: OWNER,
  });
});

Deno.test("handleCapture: shared text that is just a URL is saved as a URL, not a note", async () => {
  const supabase = fakeSupabase({});
  const res = await handleCapture(asClient(supabase), OWNER, { text: "https://example.com/post" });
  assertEquals(res.status, 200);
  assertEquals(supabase.lastInsertedRow?.url, "https://example.com/post");
  assertEquals(supabase.lastInsertedRow?.type, "article");
  assertEquals(supabase.lastInsertedRow?.status, "pending");
});

Deno.test("handleCapture: a URL already saved reports the existing bookmark as a duplicate", async () => {
  const supabase = fakeSupabase({
    insertResult: { data: null, error: { code: "23505", message: "duplicate key" } },
    existing: { id: "b1", title: "Old title", created_at: "2026-01-02T03:04:05Z" },
  });
  const res = await handleCapture(asClient(supabase), OWNER, { url: "https://Example.com/Post/" });
  assertEquals(res.status, 200);
  assertEquals(await res.json(), {
    status: "duplicate",
    existingId: "b1",
    existingTitle: "Old title",
    existingSavedAt: "2026-01-02T03:04:05Z",
  });
  // Looked up by the same normalisation Postgres applies to url_normalized.
  assertEquals(supabase.lookups, [{ col: "url_normalized", val: "https://example.com/post" }]);
});

Deno.test("handleCapture: a unique violation whose row is gone by lookup time is a generic 500", async () => {
  const supabase = fakeSupabase({
    insertResult: { data: null, error: { code: "23505", message: "duplicate key" } },
    existing: null,
  });
  const res = await quietly(() => handleCapture(asClient(supabase), OWNER, { url: "https://example.com/post" }));
  assertEquals(res.status, 500);
  assertEquals(await res.json(), "internal error");
});

Deno.test("handleCapture: any other URL insert failure is a generic 500 without a lookup", async () => {
  const supabase = fakeSupabase({
    insertResult: { data: null, error: { code: "42501", message: "permission denied for table bookmarks" } },
  });
  const res = await quietly(() => handleCapture(asClient(supabase), OWNER, { url: "https://example.com/post" }));
  assertEquals(res.status, 500);
  assertEquals(await res.json(), "internal error");
  assertEquals(supabase.lookups, []);
});

Deno.test("handleRefresh: missing OWNER_USER_ID is a generic 500 that touches nothing", async () => {
  const supabase = fakeSupabase({});
  const res = await quietly(() => handleRefresh(asClient(supabase), undefined, BOOKMARK_ID, true));
  assertEquals(res.status, 500);
  assertEquals(supabase.rpcCalls, []);
  assertEquals(supabase.lastUpdatedRow, undefined);
});

Deno.test("handleRefresh: a failed rate-limit RPC is a 500, not a pass", async () => {
  const supabase = fakeSupabase({ rateLimit: { data: null, error: { message: "rpc down" } } });
  const res = await quietly(() => handleRefresh(asClient(supabase), OWNER, BOOKMARK_ID, true));
  assertEquals(res.status, 500);
  assertEquals(supabase.lastUpdatedRow, undefined);
});

Deno.test("handleRefresh: returns 429 and updates nothing when the rate limit refuses", async () => {
  const supabase = fakeSupabase({ rateLimit: { data: false, error: null } });
  const res = await handleRefresh(asClient(supabase), OWNER, BOOKMARK_ID, true);
  assertEquals(res.status, 429);
  assertEquals(supabase.lastUpdatedRow, undefined);
});

Deno.test("handleRefresh: a bookmark the edited-check can't see falls through to a 404", async () => {
  // No row from the content_edited lookup → nothing to confirm; the update
  // (which also matches nothing) then reports the bookmark as missing.
  const supabase = fakeSupabase({ updatedRows: null, contentLookupMissing: true });
  const res = await handleRefresh(asClient(supabase), OWNER, BOOKMARK_ID, false);
  assertEquals(res.status, 404);
  assertEquals(await res.json(), "bookmark not found");
});

Deno.test("handleRequest: CORS preflight is answered without auth", async () => {
  const supabase = fakeSupabase({});
  const req = new Request("http://localhost/functions/v1/capture", { method: "OPTIONS" });
  const res = await handleRequest(req, asClient(supabase), env);
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("Access-Control-Allow-Methods"), "POST, OPTIONS");
  assertEquals(await res.text(), "");
});

Deno.test("handleRequest: a missing or wrong capture key is a 401 with CORS headers", async () => {
  const supabase = fakeSupabase({});
  const headerSets: Record<string, string>[] = [{}, { Authorization: "Bearer wrong" }];
  for (const headers of headerSets) {
    const req = new Request("http://localhost/functions/v1/capture", {
      method: "POST",
      headers,
      body: JSON.stringify({ text: "a note" }),
    });
    const res = await handleRequest(req, asClient(supabase), env);
    assertEquals(res.status, 401);
    assertEquals(res.headers.get("Access-Control-Allow-Origin"), "*");
  }
  assertEquals(supabase.lastInsertedRow, undefined);
});

Deno.test("handleRequest: a valid POST creates the capture", async () => {
  const supabase = fakeSupabase({});
  const res = await handleRequest(captureRequest(JSON.stringify({ text: "a note" })), asClient(supabase), env);
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { status: "created", id: "n1" });
  assertEquals(supabase.lastInsertedRow?.type, "note");
});

Deno.test("handleRequest: a path without the function name still routes to capture", async () => {
  const supabase = fakeSupabase({});
  const req = new Request("http://localhost/", {
    method: "POST",
    headers: { Authorization: "Bearer k3y" },
    body: JSON.stringify({ text: "a note" }),
  });
  const res = await handleRequest(req, asClient(supabase), env);
  assertEquals(res.status, 200);
});

Deno.test("handleRequest: unknown routes and methods are 404s", async () => {
  const supabase = fakeSupabase({});
  const cases: [string, string][] = [
    ["GET", "http://localhost/functions/v1/capture"],
    ["POST", "http://localhost/functions/v1/capture/extra"],
    ["POST", `http://localhost/functions/v1/capture/${BOOKMARK_ID}/delete`],
    ["GET", `http://localhost/functions/v1/capture/${BOOKMARK_ID}/refresh`],
  ];
  for (const [method, url] of cases) {
    const res = await handleRequest(
      new Request(url, { method, headers: { Authorization: "Bearer k3y" } }),
      asClient(supabase),
      env,
    );
    assertEquals(res.status, 404, `${method} ${url}`);
    assertEquals(res.headers.get("Access-Control-Allow-Origin"), "*");
  }
  assertEquals(supabase.rpcCalls, []);
});

function refreshRequest(body?: BodyInit): Request {
  return new Request(`http://localhost/functions/v1/capture/${BOOKMARK_ID}/refresh`, {
    method: "POST",
    headers: { Authorization: "Bearer k3y" },
    body,
  });
}

Deno.test("handleRequest: refresh with force=true overrides the edited-content check", async () => {
  const supabase = fakeSupabase({ contentEdited: true });
  const res = await handleRequest(refreshRequest(JSON.stringify({ force: true })), asClient(supabase), env);
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { status: "ok" });
});

Deno.test("handleRequest: refresh with a non-JSON body or a non-true force is an unconfirmed refresh", async () => {
  for (const body of ["{not json", JSON.stringify({ force: "yes" })]) {
    const supabase = fakeSupabase({ contentEdited: true });
    const res = await handleRequest(refreshRequest(body), asClient(supabase), env);
    assertEquals(res.status, 409);
    assertEquals(supabase.lastUpdatedRow, undefined);
  }
});

Deno.test("handleRequest: refresh with an oversize body is a 413", async () => {
  const supabase = fakeSupabase({});
  const big = JSON.stringify({ force: true, pad: "a".repeat(1024 * 1024) });
  const res = await handleRequest(refreshRequest(big), asClient(supabase), env);
  assertEquals(res.status, 413);
  assertEquals(supabase.lastUpdatedRow, undefined);
});

const deployedEnv = {
  SUPABASE_URL: "http://supabase.test",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
  CAPTURE_KEY: "k3y",
  OWNER_USER_ID: OWNER,
};

Deno.test(
  "handlerFromEnv: captures as OWNER_USER_ID through a service-role client",
  withEnv(deployedEnv, async () => {
    const net = stubFetch({
      "/rest/v1/rpc/bump_rate_limit_for_user": () => Response.json(true),
      "/rest/v1/bookmarks": () => Response.json({ id: "n1" }, { status: 201 }),
    });
    try {
      const res = await handlerFromEnv()(captureRequest(JSON.stringify({ text: "a note" })));
      assertEquals(res.status, 200);
      assertEquals(await res.json(), { status: "created", id: "n1" });

      assertEquals(net.calls.map((c) => `${c.method} ${c.path}`), [
        "POST /rest/v1/rpc/bump_rate_limit_for_user",
        "POST /rest/v1/bookmarks",
      ]);
      for (const call of net.calls) assertEquals(call.headers.get("apikey"), "service-role-key");
      assertEquals(JSON.parse(net.calls[1].body!).user_id, OWNER);
    } finally {
      net.restore();
    }
  }),
);

Deno.test(
  "handlerFromEnv: refuses every caller when CAPTURE_KEY is unset",
  withEnv({ ...deployedEnv, CAPTURE_KEY: undefined }, async () => {
    const net = stubFetch({});
    try {
      const res = await handlerFromEnv()(captureRequest(JSON.stringify({ text: "a note" })));
      assertEquals(res.status, 401);
      assertEquals(net.calls, []);
    } finally {
      net.restore();
    }
  }),
);
