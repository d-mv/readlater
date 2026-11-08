import { createHash } from "node:crypto";

import { answerNextConfirm, expect, test } from "./fixtures";
import { SUPABASE_URL } from "./supabaseEnv";

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

test("the first key: generated once, shown read-only, and only its hash is stored", async ({
  page,
  backend,
}) => {
  await page.goto("/settings");
  const section = page.getByTestId("capture-key");
  await expect(section.getByTestId("capture-key-status")).toContainText("No key yet");

  let confirmText = "";
  page.once("dialog", (dialog) => {
    confirmText = dialog.message();
    void dialog.accept();
  });
  await section.getByRole("button", { name: "Generate key" }).click();

  const field = section.getByLabel("Your new key");
  await expect(field).toHaveValue(/^rlk_[A-Za-z0-9_-]{43}$/);
  await expect(field).not.toBeEditable();
  expect(confirmText).toContain("The old key stops working; update your iOS Shortcut");
  const key = await field.inputValue();
  expect(backend.issuedCaptureKeys).toEqual([key]);
  expect(backend.captureKeys).toHaveLength(1);
  expect(backend.captureKeys[0]!.key_hash).toBe(sha256(key));

  await expect(section.getByTestId("capture-key-status")).toContainText("Never used");
  await expect(section.getByTestId("capture-key-howto")).toContainText(
    `${SUPABASE_URL}/functions/v1/capture`,
  );
  await expect(section.getByTestId("capture-key-howto")).toContainText("Authorization");
  // Only the dates were ever read; the hash never left the "server".
  for (const call of backend.callsTo("rest", "capture_keys")) {
    expect(call.params.get("select")).toBe("created_at,last_used_at");
  }
});

test("the plaintext is never stored on the device and is gone after leaving Settings", async ({
  page,
}) => {
  await page.goto("/settings");
  answerNextConfirm(page, true);
  await page.getByTestId("capture-key-generate").click();
  const key = await page.getByTestId("capture-key-value").inputValue();
  expect(key).toMatch(/^rlk_/);

  const stored = await page.evaluate(async () => {
    const dump: string[] = [];
    for (const storage of [localStorage, sessionStorage]) {
      for (let i = 0; i < storage.length; i += 1) dump.push(storage.getItem(storage.key(i)!) ?? "");
    }
    for (const info of await indexedDB.databases()) {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const open = indexedDB.open(info.name!);
        open.onsuccess = () => resolve(open.result);
        open.onerror = () => reject(open.error);
      });
      for (const name of Array.from(db.objectStoreNames)) {
        const all = await new Promise<unknown[]>((resolve, reject) => {
          const req = db.transaction(name).objectStore(name).getAll();
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        });
        dump.push(JSON.stringify(all));
      }
      db.close();
    }
    return dump.join("\n");
  });
  expect(stored).not.toContain(key);

  await page.getByRole("button", { name: "Back" }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByTestId("capture-key-status")).toContainText("Never used");
  await expect(page.getByTestId("capture-key-new")).toHaveCount(0);
  expect(await page.content()).not.toContain(key);
});

test("an existing key shows its dates; declining the confirm keeps it", async ({
  page,
  backend,
}) => {
  const existing = backend.addCaptureKey({
    created_at: "2026-10-01T09:00:00.000000+00:00",
    last_used_at: "2026-11-07T08:00:00.000000+00:00",
  });
  await page.goto("/settings");
  const status = page.getByTestId("capture-key-status");
  await expect(status).toContainText("Created");
  await expect(status).toContainText("Last used");

  answerNextConfirm(page, false);
  await page.getByRole("button", { name: "Generate new key" }).click();
  await expect(page.getByTestId("capture-key-new")).toHaveCount(0);
  expect(backend.callsTo("rpc", "rotate_capture_key")).toHaveLength(0);
  expect(backend.captureKeys).toEqual([existing]);
});

test("generating again replaces the key; Done hides it", async ({ page, backend }) => {
  backend.addCaptureKey();
  await page.goto("/settings");
  answerNextConfirm(page, true);
  await page.getByTestId("capture-key-generate").click();
  const first = await page.getByTestId("capture-key-value").inputValue();

  answerNextConfirm(page, true);
  await page.getByTestId("capture-key-generate").click();
  await expect(page.getByTestId("capture-key-value")).not.toHaveValue(first);
  const second = await page.getByTestId("capture-key-value").inputValue();
  expect(backend.captureKeys.map((k) => k.key_hash)).toEqual([sha256(second)]);

  await page.getByTestId("capture-key-done").click();
  await expect(page.getByTestId("capture-key-new")).toHaveCount(0);
});

test("over the hourly rotation limit the reason is shown and no key appears", async ({
  page,
  backend,
}) => {
  backend.issuedCaptureKeys = Array.from({ length: 10 }, (_, i) => `rlk_old${i}`);
  await page.goto("/settings");
  answerNextConfirm(page, true);
  await page.getByTestId("capture-key-generate").click();
  await expect(page.getByTestId("capture-key-rotate-error")).toHaveText(
    "Too many new keys in the last hour. Try again later.",
  );
  await expect(page.getByTestId("capture-key-new")).toHaveCount(0);
});

test("a failed read shows an error and Try again recovers", async ({ page, backend }) => {
  backend.fail((c) => c.name === "capture_keys");
  await page.goto("/settings");
  await expect(page.getByTestId("capture-key-error")).toBeVisible();
  await page.getByTestId("capture-key-retry").click();
  await expect(page.getByTestId("capture-key-status")).toContainText("No key yet");
});

test("copy puts the new key on the clipboard", async ({ page, context, browserName }) => {
  test.skip(browserName !== "chromium", "clipboard permissions are Chromium-only");
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/settings");
  answerNextConfirm(page, true);
  await page.getByTestId("capture-key-generate").click();
  const key = await page.getByTestId("capture-key-value").inputValue();

  await page.getByRole("button", { name: "Copy key" }).click();
  await expect(page.getByTestId("capture-key-copied")).toHaveText("Key copied");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(key);
});
