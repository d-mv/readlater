import { test as base, expect, type Locator, type Page } from "@playwright/test";

import { FakeBackend, makeSession } from "./fakeBackend";
import { AUTH_STORAGE_KEY } from "./supabaseEnv";

export { expect };
export { USER, PNG_BYTES, type ServerBookmark } from "./fakeBackend";

/**
 * - signed-in: a valid stored session (the default).
 * - signed-out: nothing stored.
 * - expired: an expired access token whose refresh token the backend refuses.
 */
export type AuthState = "signed-in" | "signed-out" | "expired";

interface Fixtures {
  auth: AuthState;
  backend: FakeBackend;
}

export const test = base.extend<Fixtures>({
  auth: ["signed-in", { option: true }],

  // Auto: every test runs against the fake, even one that never touches
  // `backend` — nothing may reach the network.
  backend: [
    async ({ context, auth }, use) => {
      const backend = new FakeBackend();
      await backend.install(context);

      if (auth !== "signed-out") {
        const refreshToken = auth === "expired" ? "e2e-revoked-refresh-token" : "e2e-refresh-token";
        if (auth === "expired") backend.revokedRefreshTokens.add(refreshToken);
        const session = makeSession({ expired: auth === "expired", refreshToken });
        // Seeded once per tab: a reload after signing out must not sign back in.
        await context.addInitScript(
          ({ key, value }) => {
            if (sessionStorage.getItem("e2e-session-seeded")) return;
            sessionStorage.setItem("e2e-session-seeded", "1");
            localStorage.setItem(key, value);
          },
          { key: AUTH_STORAGE_KEY, value: JSON.stringify(session) },
        );
      }

      await use(backend);

      expect(backend.unhandled, "calls the fake backend doesn't implement").toEqual([]);
    },
    { auto: true },
  ],
});

// ---- page helpers ---------------------------------------------------------------

export function rows(page: Page): Locator {
  return page.getByTestId("row");
}

export function row(page: Page, title: string): Locator {
  return page.getByTestId("row").filter({ hasText: title });
}

/** Opens a list row in the reader. */
export async function openRow(page: Page, title: string) {
  await row(page, title).getByRole("button").first().click();
  await expect(readerTitle(page)).toBeVisible();
}

/** The reader's (or public reader's) article title. */
export function readerTitle(page: Page): Locator {
  return page.locator('h1[data-testid="title"]');
}

/** The reader's rendered article body. */
export function article(page: Page): Locator {
  return page.getByTestId("article");
}

/** Opens the reader's overflow menu and returns its panel. */
export async function openMenu(page: Page): Promise<Locator> {
  await page.getByTestId("menu-trigger").click();
  const panel = page.getByTestId("menu-panel");
  await expect(panel).toBeVisible();
  return panel;
}

export async function menuAction(page: Page, testId: string) {
  await openMenu(page);
  await page.getByTestId("menu-panel").getByTestId(testId).click();
}

/** Accepts (or dismisses) the next window.confirm. */
export function answerNextConfirm(page: Page, accept: boolean) {
  page.once("dialog", (dialog) => (accept ? dialog.accept() : dialog.dismiss()));
}

/**
 * Writes a record straight into the app's offline DB (which the app must
 * already have created) — for state the app would have stored itself.
 */
export async function putOfflineRecord(page: Page, store: string, value: Record<string, unknown>) {
  await page.evaluate(
    ({ storeName, record }) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open("read-later-offline");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction(storeName, "readwrite");
          tx.objectStore(storeName).put(record);
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
    { storeName: store, record: value },
  );
}

/** Reads every key of an IndexedDB object store in the app's offline DB. */
export async function offlineStoreKeys(page: Page, store: string): Promise<string[]> {
  return page.evaluate(async (storeName) => {
    // Opening a database that doesn't exist yet would create it at
    // version 1 and break the app's own upgrade path.
    const databases = await indexedDB.databases();
    if (!databases.some((db) => db.name === "read-later-offline")) return [];
    return new Promise<string[]>((resolve, reject) => {
      const open = indexedDB.open("read-later-offline");
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        if (!db.objectStoreNames.contains(storeName)) {
          db.close();
          resolve([]);
          return;
        }
        const request = db.transaction(storeName).objectStore(storeName).getAllKeys();
        request.onsuccess = () => {
          db.close();
          resolve(request.result.map(String));
        };
        request.onerror = () => reject(request.error);
      };
    });
  }, store);
}
