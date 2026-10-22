import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1.0.19";
import { corsHeaders, handleRequest, handlerFromEnv, handleTranslate, MAX_TRANSLATE_CHARS } from "./index.ts";
import { quietly, stubFetch, withEnv } from "../_shared/testing.ts";

const B1 = "6f1c1c3e-2b4a-4c55-9d1e-0a3b5c7d9e11";

function fakeSupabase(opts: {
  user?: { id: string } | null;
  // undefined → a row with "Hello"; null → no row visible under RLS.
  contentMd?: string | null;
  rowMissing?: boolean;
  loadError?: { message: string };
  rateLimit?: { data: unknown; error?: { message: string } | null };
  updateResult?: { data?: unknown; error?: { message: string } | null };
}) {
  let lastUpdatePayload: Record<string, unknown> | undefined;
  let lastUpdateId: string | undefined;
  let loadedId: string | undefined;
  const rpcCalls: { fn: string; args: Record<string, unknown> }[] = [];

  const update = (payload: Record<string, unknown>) => {
    lastUpdatePayload = payload;
    return {
      eq: (_col: string, id: string) => {
        lastUpdateId = id;
        return {
          select: (_cols: string) =>
            Promise.resolve({
              data: opts.updateResult?.data ?? [{ id }],
              error: opts.updateResult?.error ?? null,
            }),
        };
      },
    };
  };
  const select = (_cols: string) => ({
    eq: (_col: string, id: string) => {
      loadedId = id;
      return {
        maybeSingle: () =>
          Promise.resolve(
            opts.loadError
              ? { data: null, error: opts.loadError }
              : opts.rowMissing
              ? { data: null, error: null }
              : { data: { content_md: opts.contentMd === undefined ? "Hello" : opts.contentMd }, error: null },
          ),
      };
    },
  });
  const from = (_table: string) => ({ select, update });
  const rpc = (fn: string, args: Record<string, unknown>) => {
    rpcCalls.push({ fn, args });
    return Promise.resolve(opts.rateLimit ?? { data: true, error: null });
  };
  return {
    auth: { getUser: () => Promise.resolve({ data: { user: opts.user === undefined ? { id: "user-1" } : opts.user } }) },
    from,
    rpc,
    rpcCalls,
    get lastUpdatePayload() {
      return lastUpdatePayload;
    },
    get lastUpdateId() {
      return lastUpdateId;
    },
    get loadedId() {
      return loadedId;
    },
  };
}

function fakeFetch(response: { ok: boolean; status?: number; body: unknown }) {
  let lastUrl: string | undefined;
  let lastInit: RequestInit | undefined;
  let calls = 0;
  const impl: typeof fetch = (url, init) => {
    calls++;
    lastUrl = url.toString();
    lastInit = init;
    return Promise.resolve({
      ok: response.ok,
      status: response.status ?? (response.ok ? 200 : 500),
      json: () => Promise.resolve(response.body),
      text: () => Promise.resolve(JSON.stringify(response.body)),
    } as Response);
  };
  return {
    impl,
    get lastUrl() {
      return lastUrl;
    },
    get lastInit() {
      return lastInit;
    },
    get calls() {
      return calls;
    },
  };
}

// deno-lint-ignore no-explicit-any
const asClient = (s: unknown) => s as any;

Deno.test("handleTranslate: returns 401 when unauthenticated", async () => {
  const supabase = fakeSupabase({ user: null });
  const res = await handleTranslate(asClient(supabase), "key:fx", { bookmark_id: B1 });
  assertEquals(res.status, 401);
});

Deno.test("handleTranslate: returns 400 when bookmark_id is missing", async () => {
  const supabase = fakeSupabase({});
  const res = await handleTranslate(asClient(supabase), "key:fx", {});
  assertEquals(res.status, 400);
});

Deno.test("handleTranslate: returns 400 for a malformed bookmark_id", async () => {
  const supabase = fakeSupabase({});
  const res = await handleTranslate(asClient(supabase), "key:fx", { bookmark_id: "b1" });
  assertEquals(res.status, 400);
});

Deno.test("handleTranslate: missing DEEPL_API_KEY is a generic 500", async () => {
  const supabase = fakeSupabase({});
  const res = await handleTranslate(asClient(supabase), undefined, { bookmark_id: B1 });
  assertEquals(res.status, 500);
  assertEquals(await res.json(), "internal error");
});

Deno.test("handleTranslate: translates the stored content_md and ignores client-supplied text", async () => {
  const supabase = fakeSupabase({ contentMd: "Hello from the database" });
  const fetchMock = fakeFetch({
    ok: true,
    body: { translations: [{ text: "Bonjour", detected_source_lang: "EN" }] },
  });

  const res = await handleTranslate(
    asClient(supabase),
    "abc123:fx",
    // deno-lint-ignore no-explicit-any
    { bookmark_id: B1, text: "attacker-chosen text", target_lang: "fr" } as any,
    fetchMock.impl,
  );
  const body = await res.json();

  assertEquals(res.status, 200);
  assertEquals(supabase.loadedId, B1);
  const sent = JSON.parse(fetchMock.lastInit?.body as string);
  assertEquals(sent.text, ["Hello from the database"]);
  assertEquals(body.translated_text, "Bonjour");
  assertEquals(body.translated_lang, "FR");
  assertEquals(body.detected_source_lang, "EN");
  assertEquals(fetchMock.lastUrl, "https://api-free.deepl.com/v2/translate");
  assertStringIncludes(
    (fetchMock.lastInit?.headers as Record<string, string>).Authorization,
    "DeepL-Auth-Key abc123:fx",
  );
  assertEquals(sent.target_lang, "FR");
  assertEquals(fetchMock.lastInit?.signal instanceof AbortSignal, true);
  assertEquals(supabase.lastUpdateId, B1);
  assertEquals(supabase.lastUpdatePayload, { translated_content_md: "Bonjour", translated_lang: "FR" });
});

Deno.test("handleTranslate: defaults target_lang to EN when omitted", async () => {
  const supabase = fakeSupabase({ contentMd: "Hola" });
  const fetchMock = fakeFetch({ ok: true, body: { translations: [{ text: "Hi" }] } });

  await handleTranslate(asClient(supabase), "key:fx", { bookmark_id: B1 }, fetchMock.impl);

  assertStringIncludes(fetchMock.lastInit?.body as string, "\"target_lang\":\"EN\"");
});

Deno.test("handleTranslate: returns 404 when the bookmark isn't visible to the caller", async () => {
  const supabase = fakeSupabase({ rowMissing: true });
  const fetchMock = fakeFetch({ ok: true, body: { translations: [{ text: "x" }] } });

  const res = await handleTranslate(asClient(supabase), "key:fx", { bookmark_id: B1 }, fetchMock.impl);

  assertEquals(res.status, 404);
  assertEquals(fetchMock.calls, 0);
  assertEquals(supabase.rpcCalls.length, 0);
});

Deno.test("handleTranslate: returns 400 when the bookmark has no content", async () => {
  const supabase = fakeSupabase({ contentMd: null });
  const res = await handleTranslate(asClient(supabase), "key:fx", { bookmark_id: B1 });
  assertEquals(res.status, 400);
});

Deno.test("handleTranslate: returns 413 for content over the cap without calling DeepL", async () => {
  const supabase = fakeSupabase({ contentMd: "a".repeat(MAX_TRANSLATE_CHARS + 1) });
  const fetchMock = fakeFetch({ ok: true, body: { translations: [{ text: "x" }] } });

  const res = await handleTranslate(asClient(supabase), "key:fx", { bookmark_id: B1 }, fetchMock.impl);

  assertEquals(res.status, 413);
  assertEquals(fetchMock.calls, 0);
});

Deno.test("handleTranslate: bumps the per-user translate limit and refuses with 429 when exhausted", async () => {
  const supabase = fakeSupabase({ rateLimit: { data: false, error: null } });
  const fetchMock = fakeFetch({ ok: true, body: { translations: [{ text: "x" }] } });

  const res = await handleTranslate(asClient(supabase), "key:fx", { bookmark_id: B1 }, fetchMock.impl);

  assertEquals(res.status, 429);
  assertEquals(fetchMock.calls, 0);
  assertEquals(supabase.rpcCalls, [{
    fn: "bump_rate_limit",
    args: { p_action: "translate" },
  }]);
});

Deno.test("handleTranslate: a failed rate-limit RPC is a generic 500, not a pass", async () => {
  const supabase = fakeSupabase({ rateLimit: { data: null, error: { message: "function does not exist" } } });
  const fetchMock = fakeFetch({ ok: true, body: { translations: [{ text: "x" }] } });

  const res = await handleTranslate(asClient(supabase), "key:fx", { bookmark_id: B1 }, fetchMock.impl);

  assertEquals(res.status, 500);
  assertEquals(await res.json(), "internal error");
  assertEquals(fetchMock.calls, 0);
});

Deno.test("handleTranslate: DeepL 456 (quota) maps to a clear 503 without echoing DeepL's body", async () => {
  const supabase = fakeSupabase({});
  const fetchMock = fakeFetch({ ok: false, status: 456, body: { message: "Quota exceeded secret-detail" } });

  const res = await handleTranslate(asClient(supabase), "key:fx", { bookmark_id: B1 }, fetchMock.impl);
  const bodyText = await res.text();

  assertEquals(res.status, 503);
  assertStringIncludes(bodyText, "quota");
  assertEquals(bodyText.includes("secret-detail"), false);
});

Deno.test("handleTranslate: DeepL 429 maps to a 429 'busy' message", async () => {
  const supabase = fakeSupabase({});
  const fetchMock = fakeFetch({ ok: false, status: 429, body: { message: "Too many requests" } });

  const res = await handleTranslate(asClient(supabase), "key:fx", { bookmark_id: B1 }, fetchMock.impl);

  assertEquals(res.status, 429);
  assertStringIncludes(await res.text(), "busy");
});

Deno.test("handleTranslate: other DeepL failures are a generic 502", async () => {
  const supabase = fakeSupabase({});
  const fetchMock = fakeFetch({ ok: false, status: 500, body: { message: "internal db host xyz" } });

  const res = await handleTranslate(asClient(supabase), "key:fx", { bookmark_id: B1 }, fetchMock.impl);
  const bodyText = await res.text();

  assertEquals(res.status, 502);
  assertEquals(bodyText.includes("xyz"), false);
});

Deno.test("handleTranslate: a DeepL timeout is a 504", async () => {
  const supabase = fakeSupabase({});
  const fetchImpl: typeof fetch = () => Promise.reject(new DOMException("timed out", "TimeoutError"));

  const res = await handleTranslate(asClient(supabase), "key:fx", { bookmark_id: B1 }, fetchImpl);

  assertEquals(res.status, 504);
});

Deno.test("handleTranslate: returns 502 when DeepL responds without a translation", async () => {
  const supabase = fakeSupabase({});
  const fetchMock = fakeFetch({ ok: true, body: { translations: [] } });

  const res = await handleTranslate(asClient(supabase), "key:fx", { bookmark_id: B1 }, fetchMock.impl);
  assertEquals(res.status, 502);
});

Deno.test("handleTranslate: a DB error persisting the translation is a generic 500", async () => {
  const supabase = fakeSupabase({ updateResult: { error: { message: "row not found" } } });
  const fetchMock = fakeFetch({ ok: true, body: { translations: [{ text: "Bonjour" }] } });

  const res = await handleTranslate(asClient(supabase), "key:fx", { bookmark_id: B1 }, fetchMock.impl);
  const bodyText = await res.text();

  assertEquals(res.status, 500);
  assertEquals(bodyText.includes("row not found"), false);
});

Deno.test("handleTranslate: an update that matched no row (deleted meanwhile) is a 404", async () => {
  const supabase = fakeSupabase({ updateResult: { data: [] } });
  const fetchMock = fakeFetch({ ok: true, body: { translations: [{ text: "Bonjour" }] } });

  const res = await handleTranslate(asClient(supabase), "key:fx", { bookmark_id: B1 }, fetchMock.impl);
  assertEquals(res.status, 404);
});

Deno.test("corsHeaders: allows the apikey header supabase-js attaches to functions.invoke calls", () => {
  assertStringIncludes(corsHeaders["Access-Control-Allow-Headers"], "apikey");
});

Deno.test("handleTranslate: splits a long article into several DeepL requests and joins the result", async () => {
  const paragraph = "word ".repeat(10_000).trim(); // ~50KB
  const article = [paragraph, paragraph, paragraph].join("\n\n");
  const supabase = fakeSupabase({ contentMd: article });
  const sent: string[] = [];
  const fetchImpl: typeof fetch = (_url, init) => {
    const { text } = JSON.parse(init?.body as string) as { text: string[] };
    sent.push(...text);
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ translations: text.map((t) => ({ text: t.toUpperCase() })) }),
      text: () => Promise.resolve(""),
    } as Response);
  };

  const res = await handleTranslate(
    asClient(supabase),
    "abc123:fx",
    { bookmark_id: B1, target_lang: "de" },
    fetchImpl,
  );

  assertEquals(res.status, 200);
  assertEquals(sent.length > 1, true);
  assertEquals(sent.join("\n\n"), article);
  assertEquals(supabase.lastUpdatePayload?.translated_content_md, article.toUpperCase());
});

Deno.test("handleRequest: malformed JSON is a 400 with CORS headers", async () => {
  const req = new Request("http://localhost/translate", { method: "POST", body: "{nope" });
  const res = await handleRequest(req, () => asClient(fakeSupabase({})), "key:fx");

  assertEquals(res.status, 400);
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), "*");
});

Deno.test("handleRequest: an oversize declared body is a 413 with CORS headers", async () => {
  const req = new Request("http://localhost/translate", {
    method: "POST",
    headers: { "content-length": String(10 * 1024 * 1024) },
    body: "{}",
  });
  const res = await handleRequest(req, () => asClient(fakeSupabase({})), "key:fx");

  assertEquals(res.status, 413);
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), "*");
});

Deno.test("handleTranslate: an unrecognisable target_lang is a 400 before loading anything", async () => {
  const supabase = fakeSupabase({});
  for (const target_lang of ["english", "E", "EN-", "pt-b"]) {
    const res = await handleTranslate(asClient(supabase), "key:fx", { bookmark_id: B1, target_lang });
    assertEquals(res.status, 400, target_lang);
    assertEquals(await res.json(), "invalid target_lang");
  }
  assertEquals(supabase.loadedId, undefined);
});

Deno.test("handleTranslate: accepts regional target languages and treats '' or non-strings as EN", async () => {
  const cases: [unknown, string][] = [["pt-br", "PT-BR"], ["zh-hans", "ZH-HANS"], ["", "EN"], [7, "EN"]];
  for (const [target_lang, expected] of cases) {
    const supabase = fakeSupabase({});
    const fetchMock = fakeFetch({ ok: true, body: { translations: [{ text: "x" }] } });
    const res = await handleTranslate(asClient(supabase), "key:fx", { bookmark_id: B1, target_lang }, fetchMock.impl);
    assertEquals(res.status, 200);
    assertEquals(JSON.parse(fetchMock.lastInit?.body as string).target_lang, expected);
  }
});

Deno.test("handleTranslate: a DB error loading the bookmark is a generic 500 without calling DeepL", async () => {
  const supabase = fakeSupabase({ loadError: { message: "relation bookmarks does not exist" } });
  const fetchMock = fakeFetch({ ok: true, body: {} });
  const res = await quietly(() => handleTranslate(asClient(supabase), "key:fx", { bookmark_id: B1 }, fetchMock.impl));
  assertEquals(res.status, 500);
  assertEquals(await res.json(), "internal error");
  assertEquals(fetchMock.calls, 0);
});

Deno.test("handleTranslate: reports a null detected_source_lang when DeepL doesn't give one", async () => {
  const supabase = fakeSupabase({});
  const fetchMock = fakeFetch({ ok: true, body: { translations: [{ text: "Hi" }] } });
  const res = await handleTranslate(asClient(supabase), "key:fx", { bookmark_id: B1 }, fetchMock.impl);
  assertEquals(await res.json(), { translated_text: "Hi", translated_lang: "EN", detected_source_lang: null });
});

Deno.test("handleTranslate: uses the global fetch by default", async () => {
  const supabase = fakeSupabase({});
  const net = stubFetch({
    "/v2/translate": () => Response.json({ translations: [{ text: "Hallo", detected_source_lang: "EN" }] }),
  });
  try {
    const res = await handleTranslate(asClient(supabase), "pro-key", { bookmark_id: B1, target_lang: "de" });
    assertEquals(res.status, 200);
    assertEquals((await res.json()).translated_text, "Hallo");
    assertEquals(net.calls.map((c) => c.path), ["/v2/translate"]);
    assertEquals(net.calls[0].headers.get("Authorization"), "DeepL-Auth-Key pro-key");
  } finally {
    net.restore();
  }
});

Deno.test("handleRequest: CORS preflight is answered without touching Supabase", async () => {
  let clients = 0;
  const res = await handleRequest(new Request("http://localhost/translate", { method: "OPTIONS" }), () => {
    clients++;
    return asClient(fakeSupabase({}));
  }, "key:fx");
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("Access-Control-Allow-Headers"), corsHeaders["Access-Control-Allow-Headers"]);
  assertEquals(clients, 0);
});

Deno.test("handleRequest: methods other than POST are a 404 with CORS headers", async () => {
  const res = await handleRequest(
    new Request("http://localhost/translate", { method: "DELETE" }),
    () => asClient(fakeSupabase({})),
    "key:fx",
  );
  assertEquals(res.status, 404);
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), "*");
});

Deno.test("handleRequest: a valid POST translates as the caller, forwarding their Authorization", async () => {
  const seen: string[] = [];
  const makeClient = (authorization: string) => {
    seen.push(authorization);
    return asClient(fakeSupabase({ contentMd: "Hola" }));
  };
  const fetchMock = fakeFetch({ ok: true, body: { translations: [{ text: "Hello" }] } });
  const body = JSON.stringify({ bookmark_id: B1 });
  const withAuth = new Request("http://localhost/translate", {
    method: "POST",
    headers: { Authorization: "Bearer user-jwt" },
    body,
  });
  const res = await handleRequest(withAuth, makeClient, "key:fx", fetchMock.impl);
  assertEquals(res.status, 200);
  assertEquals((await res.json()).translated_text, "Hello");

  await handleRequest(new Request("http://localhost/translate", { method: "POST", body }), makeClient, "key:fx", fetchMock.impl);
  assertEquals(seen, ["Bearer user-jwt", ""]);
});

Deno.test("handleRequest: uses the global fetch for DeepL by default", async () => {
  const net = stubFetch({ "/v2/translate": () => Response.json({ translations: [{ text: "Hello" }] }) });
  try {
    const req = new Request("http://localhost/translate", { method: "POST", body: JSON.stringify({ bookmark_id: B1 }) });
    const res = await handleRequest(req, () => asClient(fakeSupabase({})), "key:fx");
    assertEquals(res.status, 200);
    assertEquals(net.calls.length, 1);
  } finally {
    net.restore();
  }
});

Deno.test(
  "handlerFromEnv: translates end to end as the caller with DEEPL_API_KEY",
  withEnv(
    { SUPABASE_URL: "http://supabase.test", SUPABASE_ANON_KEY: "anon-key", DEEPL_API_KEY: "deepl-key:fx" },
    async () => {
      const net = stubFetch({
        "/auth/v1/user": () => Response.json({ id: "user-1", aud: "authenticated" }),
        "/rest/v1/bookmarks": (req) =>
          req.method === "GET" ? Response.json({ content_md: "Hola mundo" }) : Response.json([{ id: B1 }]),
        "/rest/v1/rpc/bump_rate_limit": () => Response.json(true),
        "/v2/translate": () => Response.json({ translations: [{ text: "Hello world", detected_source_lang: "ES" }] }),
      });
      try {
        const req = new Request("http://localhost/translate", {
          method: "POST",
          headers: { Authorization: "Bearer user-jwt" },
          body: JSON.stringify({ bookmark_id: B1, target_lang: "en-gb" }),
        });
        const res = await handlerFromEnv()(req);
        assertEquals(await res.json(), {
          translated_text: "Hello world",
          translated_lang: "EN-GB",
          detected_source_lang: "ES",
        });
        assertEquals(net.calls.map((c) => `${c.method} ${c.path}`), [
          "GET /auth/v1/user",
          "GET /rest/v1/bookmarks",
          "POST /rest/v1/rpc/bump_rate_limit",
          "POST /v2/translate",
          "PATCH /rest/v1/bookmarks",
        ]);
        // Supabase calls run under the caller's JWT (so RLS applies) …
        for (const call of net.calls.filter((c) => c.path !== "/v2/translate")) {
          assertEquals(call.headers.get("Authorization"), "Bearer user-jwt");
        }
        // … and DeepL gets the server's key, on the free-tier host for a :fx key.
        assertEquals(net.calls[3].headers.get("Authorization"), "DeepL-Auth-Key deepl-key:fx");
      } finally {
        net.restore();
      }
    },
  ),
);

Deno.test("handleTranslate: reports the first source language DeepL detects across chunks", async () => {
  const paragraph = "word ".repeat(10_000).trim(); // ~50KB: one chunk each
  const supabase = fakeSupabase({ contentMd: [paragraph, paragraph, paragraph].join("\n\n") });
  const detected = [undefined, "DE", "EN"];
  let call = 0;
  const fetchImpl: typeof fetch = () =>
    Promise.resolve(Response.json({ translations: [{ text: "x", detected_source_lang: detected[call++] }] }));

  const res = await handleTranslate(asClient(supabase), "key:fx", { bookmark_id: B1 }, fetchImpl);
  assertEquals(call, 3);
  assertEquals((await res.json()).detected_source_lang, "DE");
});

Deno.test("handleTranslate: a DeepL network failure (not a timeout) is a 502 and caches nothing", async () => {
  const supabase = fakeSupabase({});
  const fetchImpl: typeof fetch = () => Promise.reject(new TypeError("error sending request: connection refused"));

  const res = await quietly(() => handleTranslate(asClient(supabase), "key:fx", { bookmark_id: B1 }, fetchImpl));
  assertEquals(res.status, 502);
  assertEquals(await res.json(), "translation service unavailable");
  assertEquals(supabase.lastUpdatePayload, undefined);
});
