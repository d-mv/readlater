import { test, expect, type Page, type Route } from "@playwright/test";

// Mirrors supabase-js's default storage key derivation: `sb-${hostname's
// first label}-auth-token` — see @supabase/supabase-js's SupabaseClient
// constructor. Keeping this in sync with app/.env's VITE_SUPABASE_URL is what
// lets us seed a session without a real login round-trip.
const SUPABASE_HOST = "yqdyswhdwbqabbbczmwq.supabase.co";
const AUTH_STORAGE_KEY = "sb-yqdyswhdwbqabbbczmwq-auth-token";
const USER_ID = "e2e-user-1";

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
    id: "e2e-bookmark-1",
    user_id: USER_ID,
    url: "https://example.com/article",
    type: "article",
    status: "ready",
    title: "An article",
    author: null,
    excerpt: null,
    content_md: "Hello world",
    translated_content_md: null,
    translated_lang: null,
    thumbnail_url: null,
    youtube_video_id: null,
    content_edited: false,
    word_count: 100,
    reading_time: 3,
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

async function mockBookmarksList(page: Page, bookmarks: ReturnType<typeof makeBookmark>[]) {
  await page.route(`https://${SUPABASE_HOST}/rest/v1/bookmarks**`, async (route) => {
    const req = route.request();
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS_HEADERS });
    await fulfillJson(route, bookmarks);
  });
}

test("a translated bookmark shows the translated-language badge in the list, an untranslated one doesn't", async ({
  page,
}) => {
  await seedSession(page);
  const translated = makeBookmark({
    id: "e2e-bookmark-translated",
    title: "Translated article",
    translated_content_md: "[translated] Hello world",
    translated_lang: "EN",
  });
  const untranslated = makeBookmark({
    id: "e2e-bookmark-plain",
    title: "Plain article",
  });
  await mockBookmarksList(page, [translated, untranslated]);

  await page.goto("/");

  const translatedRow = page.locator(".row", { hasText: "Translated article" });
  const plainRow = page.locator(".row", { hasText: "Plain article" });

  await expect(translatedRow.locator(".translated-badge")).toBeVisible();
  await expect(plainRow.locator(".translated-badge")).toHaveCount(0);
});
