import { assertEquals } from "jsr:@std/assert";
import { handleRefresh, insertReadyNote } from "./index.ts";

function fakeSupabase(opts: {
  contentEdited?: boolean;
  updateError?: { message: string };
}) {
  const maybeSingle = () => Promise.resolve({ data: { content_edited: opts.contentEdited ?? false } });
  const eqSelect = (_col: string, _val: string) => ({ maybeSingle });
  const select = (_cols: string) => ({ eq: eqSelect });

  const not = () => Promise.resolve({ error: opts.updateError ?? null });
  const eqUpdate = (_col: string, _val: string) => ({ not });
  const update = (row: Record<string, unknown>) => {
    lastUpdatedRow = row;
    return { eq: eqUpdate };
  };
  let lastUpdatedRow: Record<string, unknown> | undefined;

  const from = (_table: string) => ({ select, update });
  return {
    from,
    get lastUpdatedRow() {
      return lastUpdatedRow;
    },
  };
}

Deno.test("handleRefresh: resets an un-edited bookmark to pending without asking to confirm", async () => {
  const supabase = fakeSupabase({ contentEdited: false });
  // deno-lint-ignore no-explicit-any
  const res = await handleRefresh(supabase as any, "b1", false);
  const body = await res.json();

  assertEquals(res.status, 200);
  assertEquals(body.status, "ok");
  assertEquals(supabase.lastUpdatedRow, { status: "pending", error_message: null, content_edited: false });
});

Deno.test("handleRefresh: returns 409 confirm_required for an edited bookmark when not forced", async () => {
  const supabase = fakeSupabase({ contentEdited: true });
  // deno-lint-ignore no-explicit-any
  const res = await handleRefresh(supabase as any, "b1", false);
  const body = await res.json();

  assertEquals(res.status, 409);
  assertEquals(body.status, "confirm_required");
  assertEquals(supabase.lastUpdatedRow, undefined);
});

Deno.test("handleRefresh: proceeds for an edited bookmark when force=true, skipping the check", async () => {
  const supabase = fakeSupabase({ contentEdited: true });
  // deno-lint-ignore no-explicit-any
  const res = await handleRefresh(supabase as any, "b1", true);
  const body = await res.json();

  assertEquals(res.status, 200);
  assertEquals(body.status, "ok");
  assertEquals(supabase.lastUpdatedRow, { status: "pending", error_message: null, content_edited: false });
});

Deno.test("handleRefresh: returns 500 with the DB error message on update failure", async () => {
  const supabase = fakeSupabase({ contentEdited: false, updateError: { message: "update failed" } });
  // deno-lint-ignore no-explicit-any
  const res = await handleRefresh(supabase as any, "b1", false);
  const body = await res.json();

  assertEquals(res.status, 500);
  assertEquals(body, "update failed");
});

Deno.test("insertReadyNote: stores a ready note with word count and reading time", async () => {
  let inserted: Record<string, unknown> | undefined;
  const single = () => Promise.resolve({ data: { id: "n1" }, error: null });
  const client = {
    from: (_table: string) => ({
      insert: (row: Record<string, unknown>) => {
        inserted = row;
        return { select: (_cols: string) => ({ single }) };
      },
    }),
  };

  // deno-lint-ignore no-explicit-any
  const res = await insertReadyNote(client as any, "owner-1", "a quick thought to keep");

  assertEquals(res.status, 200);
  assertEquals(inserted, {
    url: null,
    type: "note",
    status: "ready",
    title: "a quick thought to keep",
    content_md: "a quick thought to keep",
    word_count: 5,
    reading_time: 1,
    user_id: "owner-1",
  });
});
