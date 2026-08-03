import { test, expect, type Page, type Route } from "@playwright/test";

// Mirrors supabase-js's default storage key derivation: `sb-${hostname's
// first label}-auth-token` — see @supabase/supabase-js's SupabaseClient
// constructor. Keeping this in sync with app/.env's VITE_SUPABASE_URL is what
// lets us seed a session without a real login round-trip.
const SUPABASE_HOST = "yqdyswhdwbqabbbczmwq.supabase.co";
const AUTH_STORAGE_KEY = "sb-yqdyswhdwbqabbbczmwq-auth-token";
const USER_ID = "e2e-user-1";
const BOOKMARK_ID = "e2e-note-1";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
};

async function fulfillJson(route: Route, body: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: "application/json",
    headers: CORS_HEADERS,
    body: JSON.stringify(body),
  });
}

async function seedSession(page: Page) {
  const farFuture = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 365;
  await page.addInitScript(
    ({ key, userId, expiresAt }) => {
      window.localStorage.setItem(
        key,
        JSON.stringify({
          access_token: "e2e-fake-access-token",
          refresh_token: "e2e-fake-refresh-token",
          expires_in: 60 * 60 * 24 * 365,
          expires_at: expiresAt,
          token_type: "bearer",
          user: {
            id: userId,
            aud: "authenticated",
            role: "authenticated",
            email: "e2e@example.com",
            app_metadata: {},
            user_metadata: {},
            created_at: new Date().toISOString(),
          },
        }),
      );
    },
    { key: AUTH_STORAGE_KEY, userId: USER_ID, expiresAt: farFuture },
  );
}

function makeBookmark(overrides: Record<string, unknown> = {}) {
  return {
    id: BOOKMARK_ID,
    user_id: USER_ID,
    url: null,
    type: "note",
    status: "ready",
    title: "Bonjour le monde",
    author: null,
    excerpt: null,
    content_md: "Bonjour le monde",
    translated_content_md: null,
    translated_lang: null,
    thumbnail_url: null,
    youtube_video_id: null,
    content_edited: false,
    word_count: 3,
    reading_time: 1,
    tags: [],
    is_public: false,
    archived: false,
    read_at: null,
    error_message: null,
    created_at: "2026-01-01T00:00:00Z",
    processed_at: "2026-01-01T00:00:01Z",
    ...overrides,
  };
}

/**
 * Mocks the two network calls the reader view makes for a single bookmark:
 * the PostgREST fetchOne GET and the translate edge function POST. `bookmark`
 * is mutable so a test can assert what's "persisted" server-side after a
 * translate call, then reload the page and see that reflected — the same way
 * the real cache-then-reuse behavior works in production.
 */
async function mockBackend(
  page: Page,
  bookmark: ReturnType<typeof makeBookmark>,
  options: { onTranslate?: () => void } = {},
) {
  await page.route(`https://${SUPABASE_HOST}/rest/v1/bookmarks**`, async (route) => {
    const req = route.request();
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS_HEADERS });
    await fulfillJson(route, bookmark);
  });

  await page.route(`https://${SUPABASE_HOST}/functions/v1/translate`, async (route) => {
    const req = route.request();
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS_HEADERS });

    options.onTranslate?.();
    const { text } = req.postDataJSON() as { text: string };
    const translated = `[translated] ${text}`;
    bookmark.translated_content_md = translated;
    bookmark.translated_lang = "EN";
    await fulfillJson(route, { translated_text: translated, translated_lang: "EN" });
  });
}

test("translating a note shows the translation inline, and it's still there after a reload", async ({
  page,
}) => {
  await seedSession(page);
  const bookmark = makeBookmark();
  await mockBackend(page, bookmark);

  await page.goto(`/b/${BOOKMARK_ID}`);
  await expect(page.getByRole("heading", { name: "Bonjour le monde" })).toBeVisible();
  await expect(page.locator(".article")).toContainText("Bonjour le monde");

  await page.locator(".menu-trigger").click();
  await page.locator(".translate-item").click();

  await expect(page.locator(".translate-bar")).toContainText("Translated");
  await expect(page.locator(".article")).toContainText("[translated] Bonjour le monde");

  await page.locator(".translate-toggle").click();
  await expect(page.locator(".translate-bar")).toContainText("Original");
  await expect(page.locator(".article")).toContainText("Bonjour le monde");
  await expect(page.locator(".article")).not.toContainText("[translated]");

  // The edge function persisted the translation server-side (simulated by
  // mockBackend mutating `bookmark`), so a fresh load of the same bookmark
  // should show the translated version by default without any extra click.
  await page.reload();
  await expect(page.locator(".article")).toContainText("[translated] Bonjour le monde");
  await expect(page.locator(".translate-bar")).toContainText("Translated");
});

test("opening a note that already has a cached translation shows it by default without calling DeepL", async ({
  page,
}) => {
  await seedSession(page);
  let translateCalls = 0;
  const bookmark = makeBookmark({
    translated_content_md: "[translated] Bonjour le monde",
    translated_lang: "EN",
  });
  await mockBackend(page, bookmark, { onTranslate: () => translateCalls++ });

  await page.goto(`/b/${BOOKMARK_ID}`);

  await expect(page.locator(".translate-bar")).toContainText("Translated");
  await expect(page.locator(".article")).toContainText("[translated] Bonjour le monde");
  expect(translateCalls).toBe(0);

  // Clicking Translate again should just confirm the cached view — not spend
  // another DeepL call.
  await page.locator(".menu-trigger").click();
  await page.locator(".translate-item").click();
  expect(translateCalls).toBe(0);
});
