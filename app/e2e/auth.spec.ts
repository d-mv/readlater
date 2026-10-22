import { AUTH_STORAGE_KEY } from "./supabaseEnv";
import { expect, rows, test, USER } from "./fixtures";

test.describe("signed out", () => {
  test.use({ auth: "signed-out" });

  test("protected pages redirect to the login screen", async ({ page }) => {
    await page.goto("/settings");
    await expect(page).toHaveURL(/\/login\?redirect=\/settings$/);
    await page.goto("/b/some-id");
    await expect(page).toHaveURL(/\/login\?redirect=\/b\/some-id$/);
  });

  test("signing in with the right password opens the reading list", async ({ page, backend }) => {
    backend.addBookmark({ title: "Waiting for me" });
    await page.goto("/");
    await expect(page).toHaveURL(/\/login$/);

    await page.getByLabel("Email").fill(USER.email);
    await page.getByLabel("Password").fill(USER.password);
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page).toHaveURL(/\/$/);
    await expect(rows(page)).toHaveText([/Waiting for me/]);
    // The session is kept for the next visit.
    const stored = await page.evaluate((key) => localStorage.getItem(key), AUTH_STORAGE_KEY);
    expect(stored).toContain(USER.email);
    expect(backend.callsTo("auth", "token:password")).toHaveLength(1);
  });

  test("a wrong password shows the error and stays on the login screen", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(USER.email);
    await page.getByLabel("Password").fill("not the password");
    await page.getByRole("button", { name: "Sign in" }).press("Enter");

    await expect(page.getByTestId("error")).toHaveText("Invalid login credentials");
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("button", { name: "Sign in" })).toBeEnabled();
  });

  test("signing in before confirming the email says what to do", async ({ page, backend }) => {
    backend.fail((c) => c.service === "auth" && c.name === "token:password", {
      status: 400,
      body: { code: 400, error_code: "email_not_confirmed", msg: "Email not confirmed" },
    });
    await page.goto("/login");
    await page.getByLabel("Email").fill(USER.email);
    await page.getByLabel("Password").fill(USER.password);
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page.getByTestId("error")).toHaveText(
      "Check your email to confirm your account, then sign in.",
    );
    await expect(page).toHaveURL(/\/login$/);
  });
});

test("a signed-in visit to /login goes to the list", async ({ page, backend }) => {
  backend.addBookmark({ title: "Already here" });
  await page.goto("/login");
  await expect(page).toHaveURL(/\/$/);
  await expect(rows(page)).toHaveCount(1);
});

test.describe("expired session", () => {
  test.use({ auth: "expired" });

  test("a session whose refresh is refused ends on the login screen", async ({ page, backend }) => {
    backend.addBookmark();
    await page.goto("/");
    await expect(page).toHaveURL(/\/login$/);
    expect(backend.callsTo("auth", "token:refresh_token").length).toBeGreaterThan(0);
    // Nothing of the old session is left to sign back in with.
    const stored = await page.evaluate((key) => localStorage.getItem(key), AUTH_STORAGE_KEY);
    expect(stored).toBeNull();
  });
});

test("an API 401 mid-session signs out instead of showing the offline copy", async ({
  page,
  backend,
}) => {
  backend.addBookmark({ title: "Visible while valid" });
  await page.goto("/");
  await expect(rows(page)).toHaveCount(1);

  // The token is revoked server-side; the next list read gets a 401.
  backend.rejectJwt = true;
  await page.getByTestId("search-input").fill("anything");
  await page.getByTestId("search-input").press("Enter");

  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByLabel("Email")).toBeVisible();
});

test("an API 401 while the auth server is unreachable keeps the login and shows the offline copy", async ({
  page,
  backend,
}) => {
  backend.addBookmark({ title: "Visible while valid" });
  await page.goto("/");
  await expect(rows(page)).toHaveCount(1);

  // The REST API refuses the request, but the session check can't reach the
  // auth server (503): that's no proof the session is over.
  backend.rejectJwt = true;
  backend.fail((c) => c.service === "auth" && c.name === "user", { status: 503, times: 5 });
  await page.getByTestId("search-input").fill("visible");
  await page.getByTestId("search-input").press("Enter");

  await expect(rows(page)).toHaveCount(1);
  await expect(page).not.toHaveURL(/\/login$/);
});
