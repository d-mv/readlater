import { assertEquals } from "jsr:@std/assert@1.0.19";
import { handleRequest } from "./index.ts";

function fakeAdmin(opts: {
  orphans?: { bucket_id: string; name: string }[];
  listError?: { message: string };
  removeError?: { message: string };
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
              : { data: names.map((name) => ({ name })), error: null },
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

const quietly = async <T>(fn: () => Promise<T>): Promise<T> => {
  const [log, err] = [console.log, console.error];
  console.log = console.error = () => {};
  try {
    return await fn();
  } finally {
    console.log = log;
    console.error = err;
  }
};

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
