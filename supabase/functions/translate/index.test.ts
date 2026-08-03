import { assertEquals, assertStringIncludes } from "jsr:@std/assert";
import { corsHeaders, handleTranslate } from "./index.ts";

function fakeSupabase(opts: {
  user?: { id: string } | null;
  updateResult?: { error?: { message: string } };
}) {
  let lastUpdatePayload: Record<string, unknown> | undefined;
  let lastUpdateId: string | undefined;
  const eq = (_col: string, id: string) => {
    lastUpdateId = id;
    return Promise.resolve(opts.updateResult ?? { error: null });
  };
  const update = (payload: Record<string, unknown>) => {
    lastUpdatePayload = payload;
    return { eq };
  };
  const from = (_table: string) => ({ update });
  return {
    auth: { getUser: () => Promise.resolve({ data: { user: opts.user ?? null } }) },
    from,
    get lastUpdatePayload() {
      return lastUpdatePayload;
    },
    get lastUpdateId() {
      return lastUpdateId;
    },
  };
}

function fakeFetch(response: { ok: boolean; status?: number; body: unknown }) {
  let lastUrl: string | undefined;
  let lastInit: RequestInit | undefined;
  const impl: typeof fetch = (url, init) => {
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
  };
}

Deno.test("handleTranslate: returns 401 when unauthenticated", async () => {
  const supabase = fakeSupabase({ user: null });
  // deno-lint-ignore no-explicit-any
  const res = await handleTranslate(supabase as any, "key:fx", { bookmark_id: "b1", text: "hi" });
  assertEquals(res.status, 401);
});

Deno.test("handleTranslate: returns 400 when bookmark_id is missing", async () => {
  const supabase = fakeSupabase({ user: { id: "user-1" } });
  // deno-lint-ignore no-explicit-any
  const res = await handleTranslate(supabase as any, "key:fx", { text: "hi" });
  assertEquals(res.status, 400);
});

Deno.test("handleTranslate: returns 400 when text is blank", async () => {
  const supabase = fakeSupabase({ user: { id: "user-1" } });
  // deno-lint-ignore no-explicit-any
  const res = await handleTranslate(supabase as any, "key:fx", { bookmark_id: "b1", text: "   " });
  assertEquals(res.status, 400);
});

Deno.test("handleTranslate: calls the free-tier DeepL host, uppercases target_lang, and persists the translation", async () => {
  const supabase = fakeSupabase({ user: { id: "user-1" } });
  const fetchMock = fakeFetch({
    ok: true,
    body: { translations: [{ text: "Bonjour", detected_source_lang: "EN" }] },
  });

  const res = await handleTranslate(
    // deno-lint-ignore no-explicit-any
    supabase as any,
    "abc123:fx",
    { bookmark_id: "b1", text: "Hello", target_lang: "fr" },
    fetchMock.impl,
  );
  const body = await res.json();

  assertEquals(res.status, 200);
  assertEquals(body.translated_text, "Bonjour");
  assertEquals(body.translated_lang, "FR");
  assertEquals(body.detected_source_lang, "EN");
  assertEquals(fetchMock.lastUrl, "https://api-free.deepl.com/v2/translate");
  assertStringIncludes(
    (fetchMock.lastInit?.headers as Record<string, string>).Authorization,
    "DeepL-Auth-Key abc123:fx",
  );
  assertStringIncludes(fetchMock.lastInit?.body as string, "\"target_lang\":\"FR\"");
  assertEquals(supabase.lastUpdateId, "b1");
  assertEquals(supabase.lastUpdatePayload, { translated_content_md: "Bonjour", translated_lang: "FR" });
});

Deno.test("handleTranslate: defaults target_lang to EN when omitted", async () => {
  const supabase = fakeSupabase({ user: { id: "user-1" } });
  const fetchMock = fakeFetch({
    ok: true,
    body: { translations: [{ text: "Hi" }] },
  });

  await handleTranslate(supabase as any, "key:fx", { bookmark_id: "b1", text: "Hola" }, fetchMock.impl);

  assertStringIncludes(fetchMock.lastInit?.body as string, "\"target_lang\":\"EN\"");
});

Deno.test("handleTranslate: returns 502 with DeepL's error body when the request fails", async () => {
  const supabase = fakeSupabase({ user: { id: "user-1" } });
  const fetchMock = fakeFetch({ ok: false, status: 456, body: { message: "Quota exceeded" } });

  const res = await handleTranslate(
    supabase as any,
    "key:fx",
    { bookmark_id: "b1", text: "hi" },
    fetchMock.impl,
  );
  const bodyText = await res.text();

  assertEquals(res.status, 502);
  assertStringIncludes(bodyText, "Quota exceeded");
});

Deno.test("handleTranslate: returns 502 when DeepL responds without a translation", async () => {
  const supabase = fakeSupabase({ user: { id: "user-1" } });
  const fetchMock = fakeFetch({ ok: true, body: { translations: [] } });

  const res = await handleTranslate(
    supabase as any,
    "key:fx",
    { bookmark_id: "b1", text: "hi" },
    fetchMock.impl,
  );
  assertEquals(res.status, 502);
});

Deno.test("handleTranslate: returns 500 with the DB error message when persisting the translation fails", async () => {
  const supabase = fakeSupabase({
    user: { id: "user-1" },
    updateResult: { error: { message: "row not found" } },
  });
  const fetchMock = fakeFetch({ ok: true, body: { translations: [{ text: "Bonjour" }] } });

  const res = await handleTranslate(
    supabase as any,
    "key:fx",
    { bookmark_id: "b1", text: "hi" },
    fetchMock.impl,
  );
  const bodyText = await res.text();

  assertEquals(res.status, 500);
  assertStringIncludes(bodyText, "row not found");
});

Deno.test("corsHeaders: allows the apikey header supabase-js attaches to functions.invoke calls", () => {
  assertStringIncludes(corsHeaders["Access-Control-Allow-Headers"], "apikey");
});
