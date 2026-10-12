import { assertEquals, assertThrows } from "jsr:@std/assert@1.0.19";
import { handleRequest, handlerFromEnv } from "./index.ts";
import { quietly, stubFetch, withEnv } from "../_shared/testing.ts";

function fakeAdmin(opts: {
  orphans?: { bucket_id: string; name: string }[] | Record<string, unknown>;
  listError?: { message: string };
  removeError?: { message: string };
  // What Storage reports as removed for a batch (default: every name).
  removedData?: (names: string[]) => { name: string }[] | null;
}) {
  const removed: { bucket: string; names: string[] }[] = [];
  return {
    rpc: (_fn: string) =>
      Promise.resolve(
        opts.listError ? { data: null, error: opts.listError } : { data: opts.orphans ?? [], error: null },
      ),
    storage: {
      from: (bucket: string) => ({
        remove: (names: string[]) => {
          removed.push({ bucket, names });
          return Promise.resolve(
            opts.removeError
              ? { data: null, error: opts.removeError }
              : { data: opts.removedData ? opts.removedData(names) : names.map((name) => ({ name })), error: null },
          );
        },
      }),
    },
    removed,
  };
}

const KEY = "service-role-key";
const req = (query = "", auth = `Bearer ${KEY}`) =>
  new Request(`http://localhost/storage-sweep${query}`, { method: "POST", headers: { Authorization: auth } });

Deno.test("storage-sweep: refuses callers without the service-role key", async () => {
  const admin = fakeAdmin({ orphans: [{ bucket_id: "bookmark-pdfs", name: "u/a.pdf" }] });
  // deno-lint-ignore no-explicit-any
  const res = await handleRequest(req("", "Bearer anon-key"), admin as any, KEY);
  assertEquals(res.status, 401);
  assertEquals(admin.removed, []);
});

Deno.test("storage-sweep: removes orphans per bucket through the Storage API", async () => {
  const admin = fakeAdmin({
    orphans: [
      { bucket_id: "bookmark-pdfs", name: "u/a.pdf" },
      { bucket_id: "bookmark-assets", name: "youtube/t.jpg" },
      { bucket_id: "bookmark-pdfs", name: "u/b.pdf" },
    ],
  });
  // deno-lint-ignore no-explicit-any
  const res = await quietly(() => handleRequest(req(), admin as any, KEY));
  const body = await res.json();

  assertEquals(res.status, 200);
  assertEquals(admin.removed, [
    { bucket: "bookmark-pdfs", names: ["u/a.pdf", "u/b.pdf"] },
    { bucket: "bookmark-assets", names: ["youtube/t.jpg"] },
  ]);
  assertEquals(body.removed, { "bookmark-pdfs": 2, "bookmark-assets": 1 });
});

Deno.test("storage-sweep: dry_run=1 reports without removing", async () => {
  const admin = fakeAdmin({ orphans: [{ bucket_id: "bookmark-pdfs", name: "u/a.pdf" }] });
  // deno-lint-ignore no-explicit-any
  const res = await handleRequest(req("?dry_run=1"), admin as any, KEY);
  const body = await res.json();

  assertEquals(body, { dry_run: true, found: { "bookmark-pdfs": 1 } });
  assertEquals(admin.removed, []);
});

Deno.test("storage-sweep: a listing error is a generic 500", async () => {
  const admin = fakeAdmin({ listError: { message: "permission denied for function" } });
  // deno-lint-ignore no-explicit-any
  const res = await quietly(() => handleRequest(req(), admin as any, KEY));
  assertEquals(res.status, 500);
  assertEquals(await res.json(), "internal error");
});

Deno.test("storage-sweep: a listing that isn't an array is a generic 500", async () => {
  const admin = fakeAdmin({ orphans: { unexpected: true } });
  // deno-lint-ignore no-explicit-any
  const res = await quietly(() => handleRequest(req(), admin as any, KEY));
  assertEquals(res.status, 500);
  assertEquals(admin.removed, []);
});

Deno.test("storage-sweep: a Storage remove failure is a generic 500 and stops the sweep", async () => {
  const admin = fakeAdmin({
    orphans: [
      { bucket_id: "bookmark-pdfs", name: "u/a.pdf" },
      { bucket_id: "bookmark-assets", name: "youtube/t.jpg" },
    ],
    removeError: { message: "storage unavailable" },
  });
  // deno-lint-ignore no-explicit-any
  const res = await quietly(() => handleRequest(req(), admin as any, KEY));
  assertEquals(res.status, 500);
  assertEquals(await res.json(), "internal error");
  assertEquals(admin.removed.map((r) => r.bucket), ["bookmark-pdfs"]);
});

Deno.test("storage-sweep: removes in batches of 500 and counts what Storage reports gone", async () => {
  const names = Array.from({ length: 1001 }, (_, i) => `u/${i}.pdf`);
  const admin = fakeAdmin({
    orphans: names.map((name) => ({ bucket_id: "bookmark-pdfs", name })),
    // Storage answering a batch with no data counts as nothing removed.
    removedData: (batch) => (batch.length === 1 ? null : batch.map((name) => ({ name }))),
  });
  // deno-lint-ignore no-explicit-any
  const res = await quietly(() => handleRequest(req(), admin as any, KEY));
  const body = await res.json();

  assertEquals(res.status, 200);
  assertEquals(admin.removed.map((r) => r.names.length), [500, 500, 1]);
  assertEquals(body, { dry_run: false, found: { "bookmark-pdfs": 1001 }, removed: { "bookmark-pdfs": 1000 } });
});

Deno.test("storage-sweep: nothing orphaned removes nothing", async () => {
  const admin = fakeAdmin({ orphans: [] });
  // deno-lint-ignore no-explicit-any
  const res = await quietly(() => handleRequest(req(), admin as any, KEY));
  assertEquals(await res.json(), { dry_run: false, found: {}, removed: {} });
  assertEquals(admin.removed, []);
});

Deno.test("storage-sweep: CORS preflight is answered without auth; other methods are 404", async () => {
  const admin = fakeAdmin({});
  const preflight = new Request("http://localhost/storage-sweep", { method: "OPTIONS" });
  // deno-lint-ignore no-explicit-any
  const ok = await handleRequest(preflight, admin as any, KEY);
  assertEquals(ok.status, 200);
  assertEquals(ok.headers.get("Access-Control-Allow-Methods"), "POST, OPTIONS");

  const get = new Request("http://localhost/storage-sweep", { method: "GET", headers: { Authorization: `Bearer ${KEY}` } });
  // deno-lint-ignore no-explicit-any
  const notFound = await handleRequest(get, admin as any, KEY);
  assertEquals(notFound.status, 404);
  assertEquals(admin.removed, []);
});

const deployedEnv = { SUPABASE_URL: "http://supabase.test", SUPABASE_SERVICE_ROLE_KEY: KEY };
const orphanList = () => Response.json([{ bucket_id: "bookmark-pdfs", name: "u/a.pdf" }]);

Deno.test(
  "handlerFromEnv: lists orphans as service_role when called with the service-role key",
  withEnv(deployedEnv, async () => {
    const net = stubFetch({ "/rest/v1/rpc/list_orphaned_storage_objects": orphanList });
    try {
      const res = await handlerFromEnv()(req("?dry_run=1"));
      assertEquals(await res.json(), { dry_run: true, found: { "bookmark-pdfs": 1 } });
      assertEquals(net.calls.map((c) => `${c.method} ${c.path}`), ["POST /rest/v1/rpc/list_orphaned_storage_objects"]);
      assertEquals(net.calls[0].headers.get("apikey"), KEY);
    } finally {
      net.restore();
    }
  }),
);

Deno.test(
  "handlerFromEnv: a Storage API failure surfaces as a generic 500",
  withEnv(deployedEnv, async () => {
    // Only the listing is routed: the remove call gets the stub's 500.
    const net = stubFetch({ "/rest/v1/rpc/list_orphaned_storage_objects": orphanList });
    try {
      const res = await quietly(() => handlerFromEnv()(req()));
      assertEquals(res.status, 500);
      assertEquals(net.calls.map((c) => `${c.method} ${c.path}`), [
        "POST /rest/v1/rpc/list_orphaned_storage_objects",
        "DELETE /storage/v1/object/bookmark-pdfs",
      ]);
    } finally {
      net.restore();
    }
  }),
);

Deno.test(
  "handlerFromEnv: an unset service-role key fails at startup instead of serving",
  // deno-lint-ignore require-await
  withEnv({ ...deployedEnv, SUPABASE_SERVICE_ROLE_KEY: undefined }, async () => {
    assertThrows(() => handlerFromEnv(), Error, "supabaseKey is required");
  }),
);
