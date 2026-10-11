import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1.0.19";
import { corsHeaders, handleRequest, handleTranslate, MAX_TRANSLATE_CHARS } from "./index.ts";

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
    args: { p_action: "translate", p_max: 20, p_window: "1 hour" },
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
