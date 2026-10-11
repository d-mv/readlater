import { assertEquals } from "jsr:@std/assert@1.0.19";
import {
  handleCapture,
  handleRefresh,
  handleRequest,
  insertReadyNote,
  MAX_TEXT_CHARS,
  MAX_TITLE_CHARS,
} from "./index.ts";

const OWNER = "owner-1";
const BOOKMARK_ID = "6f1c1c3e-2b4a-4c55-9d1e-0a3b5c7d9e11";

function fakeSupabase(opts: {
  contentEdited?: boolean;
  updateError?: { message: string };
  updatedRows?: { id: string }[];
  rateLimit?: { data: unknown; error?: { message: string } | null };
  insertResult?: { data: unknown; error: unknown };
}) {
  let lastUpdatedRow: Record<string, unknown> | undefined;
  let lastInsertedRow: Record<string, unknown> | undefined;
  const rpcCalls: { fn: string; args: Record<string, unknown> }[] = [];

  const maybeSingle = () => Promise.resolve({ data: { content_edited: opts.contentEdited ?? false } });
  const eqSelect = (_col: string, _val: string) => ({ maybeSingle });
  const select = (_cols: string) => ({ eq: eqSelect });

  const selectAfterUpdate = (_cols: string) =>
    Promise.resolve(
      opts.updateError
        ? { data: null, error: opts.updateError }
        : { data: opts.updatedRows ?? [{ id: BOOKMARK_ID }], error: null },
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
