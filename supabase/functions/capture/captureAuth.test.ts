import { assertEquals } from "jsr:@std/assert@1.0.19";
import { quietly } from "../_shared/testing.ts";
import {
  CAPTURE_KEY_MAX_CHARS,
  markKeyUsed,
  resolveCaller,
  sha256Hex,
} from "./captureAuth.ts";

const OWNER = "00000000-0000-4000-8000-0000000000aa";
const OTHER = "00000000-0000-4000-8000-0000000000bb";
const DB_KEY = "rlk_db-key";
const ENV_KEY = "env-static-key";

type KeyRow = { user_id: string; key_hash: string };

// The capture_keys table as the service-role client sees it.
function fakeKeys(opts: {
  rows?: KeyRow[];
  lookupError?: { message: string };
  // Fails only the lookup by user_id (the env-fallback check).
  ownerLookupError?: { message: string };
  updateError?: { message: string };
  updateThrows?: boolean;
} = {}) {
  const lookups: Record<string, string>[] = [];
  const updates: {
    row: Record<string, unknown>;
    filters: Record<string, string>;
  }[] = [];
  const client = {
    from: (table: string) => {
      if (table !== "capture_keys") {
        throw new Error(`unexpected table ${table}`);
      }
      return {
        select: (_cols: string) => {
          const filters: Record<string, string> = {};
          const query = {
            eq: (col: string, val: string) => {
              filters[col] = val;
              return query;
            },
            maybeSingle: () => {
              lookups.push(filters);
              if (opts.lookupError) {
                return Promise.resolve({ data: null, error: opts.lookupError });
              }
              if ("user_id" in filters && opts.ownerLookupError) {
                return Promise.resolve({
                  data: null,
                  error: opts.ownerLookupError,
                });
              }
              const row = (opts.rows ?? []).find((r) =>
                Object.entries(filters).every(([k, v]) =>
                  r[k as keyof KeyRow] === v
                )
              );
              return Promise.resolve({
                data: row ? { user_id: row.user_id } : null,
                error: null,
              });
            },
          };
          return query;
        },
        update: (row: Record<string, unknown>) => ({
          eq: (col: string, val: string) => {
            updates.push({ row, filters: { [col]: val } });
            if (opts.updateThrows) {
              return Promise.reject(new Error("network down"));
            }
            return Promise.resolve({ error: opts.updateError ?? null });
          },
        }),
      };
    },
  };
  // deno-lint-ignore no-explicit-any
  return { client: client as any, lookups, updates };
}

const env = { captureKey: ENV_KEY, ownerUserId: OWNER };
const bearer = (token: string) => `Bearer ${token}`;

Deno.test("sha256Hex: the lowercase hex sha256 of the UTF-8 text (as Postgres computes it)", async () => {
  // echo -n abc | shasum -a 256
  assertEquals(
    await sha256Hex("abc"),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
});

Deno.test("resolveCaller: a stored key resolves to that key's user", async () => {
  const keys = fakeKeys({
    rows: [{ user_id: OTHER, key_hash: await sha256Hex(DB_KEY) }],
  });
  assertEquals(await resolveCaller(keys.client, bearer(DB_KEY), env), {
    kind: "user",
    userId: OTHER,
    source: "key",
  });
  // Looked up by hash only — the plaintext never goes to the database.
  assertEquals(keys.lookups, [{ key_hash: await sha256Hex(DB_KEY) }]);
});

Deno.test("resolveCaller: the env key is accepted as OWNER_USER_ID while the owner has no key row", async () => {
  const keys = fakeKeys({
    rows: [{ user_id: OTHER, key_hash: await sha256Hex(DB_KEY) }],
  });
  assertEquals(await resolveCaller(keys.client, bearer(ENV_KEY), env), {
    kind: "user",
    userId: OWNER,
    source: "env",
  });
  assertEquals(keys.lookups, [{ key_hash: await sha256Hex(ENV_KEY) }, {
    user_id: OWNER,
  }]);
});

Deno.test("resolveCaller: the env key is refused once the owner has generated a key", async () => {
  const keys = fakeKeys({
    rows: [{ user_id: OWNER, key_hash: await sha256Hex(DB_KEY) }],
  });
  assertEquals(await resolveCaller(keys.client, bearer(ENV_KEY), env), {
    kind: "unauthorized",
  });
});

Deno.test("resolveCaller: an unknown key is unauthorized, and never checked against the owner", async () => {
  const keys = fakeKeys({ rows: [] });
  assertEquals(await resolveCaller(keys.client, bearer("wrong"), env), {
    kind: "unauthorized",
  });
  assertEquals(keys.lookups, [{ key_hash: await sha256Hex("wrong") }]);
});

Deno.test("resolveCaller: without CAPTURE_KEY only stored keys work", async () => {
  const keys = fakeKeys({ rows: [] });
  assertEquals(
    await resolveCaller(keys.client, bearer(ENV_KEY), {
      captureKey: "",
      ownerUserId: OWNER,
    }),
    { kind: "unauthorized" },
  );
});

Deno.test("resolveCaller: a missing header, another scheme or an empty token is refused without a lookup", async () => {
  const keys = fakeKeys({ rows: [] });
  for (const header of [null, "Basic abc", "Bearer "]) {
    assertEquals(await resolveCaller(keys.client, header, env), {
      kind: "unauthorized",
    });
  }
  assertEquals(keys.lookups, []);
});

Deno.test("resolveCaller: an oversize token is refused without hashing or a lookup", async () => {
  const keys = fakeKeys({ rows: [] });
  const token = "a".repeat(CAPTURE_KEY_MAX_CHARS + 1);
  assertEquals(await resolveCaller(keys.client, bearer(token), env), {
    kind: "unauthorized",
  });
  assertEquals(keys.lookups, []);
});

Deno.test("resolveCaller: a failed key lookup is an error, not a pass or a 401", async () => {
  const keys = fakeKeys({ lookupError: { message: "db down" } });
  const result = await resolveCaller(keys.client, bearer(ENV_KEY), env);
  assertEquals(result.kind, "error");
});

Deno.test("resolveCaller: a failed owner check on the env path is an error, not a pass", async () => {
  const keys = fakeKeys({ ownerLookupError: { message: "db down" } });
  const result = await resolveCaller(keys.client, bearer(ENV_KEY), env);
  assertEquals(result.kind, "error");
});

Deno.test("resolveCaller: the env key with OWNER_USER_ID unset is an error", async () => {
  const keys = fakeKeys({ rows: [] });
  const result = await resolveCaller(keys.client, bearer(ENV_KEY), {
    captureKey: ENV_KEY,
    ownerUserId: undefined,
  });
  assertEquals(result.kind, "error");
  assertEquals(keys.lookups.length, 1);
});

Deno.test("markKeyUsed: records last_used_at on the user's key", async () => {
  const keys = fakeKeys();
  await markKeyUsed(keys.client, OTHER, new Date("2026-11-08T12:00:00Z"));
  assertEquals(keys.updates, [{
    row: { last_used_at: "2026-11-08T12:00:00.000Z" },
    filters: { user_id: OTHER },
  }]);
});

Deno.test("markKeyUsed: a failed or thrown update is logged and swallowed", async () => {
  for (
    const opts of [{ updateError: { message: "nope" } }, { updateThrows: true }]
  ) {
    const keys = fakeKeys(opts);
    await quietly(() => markKeyUsed(keys.client, OTHER));
    assertEquals(keys.updates.length, 1);
  }
});
