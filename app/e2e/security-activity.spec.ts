import { expect, test } from "./fixtures";

function activity(page: import("@playwright/test").Page) {
  return page.getByTestId("security-activity");
}

test("settings lists the newest security events first, described in words", async ({
  page,
  backend,
}) => {
  backend.addSecurityEvent({
    kind: "sign_in",
    detail: {
      user_agent: "Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0",
      ip: "203.0.113.7",
    },
    created_at: "2026-11-01T10:00:00.000000+00:00",
  });
  backend.addSecurityEvent({
    kind: "capture_key_rotated",
    created_at: "2026-11-02T10:00:00.000000+00:00",
  });
  backend.addSecurityEvent({
    kind: "bookmark_deleted",
    detail: { bookmark_id: "b1", title: "Old recipe" },
    created_at: "2026-11-03T10:00:00.000000+00:00",
  });
  await page.goto("/settings");

  await expect(activity(page).getByTestId("security-event-text")).toHaveText([
    "Deleted “Old recipe”",
    "New capture key generated",
    "Signed in · Firefox on Linux · 203.0.113.7",
  ]);
  const read = backend.callsTo("rest", "security_events");
  expect(read).toHaveLength(1);
  expect(read[0]!.params.get("order")).toBe("created_at.desc");
  expect(read[0]!.params.get("limit")).toBe("50");
});

test("no events yet says so", async ({ page }) => {
  await page.goto("/settings");
  await expect(activity(page).getByTestId("security-activity-empty")).toHaveText("No activity yet");
});

test("a failed read shows an error and Try again recovers", async ({ page, backend }) => {
  backend.addSecurityEvent({ kind: "capture_key_rotated" });
  backend.fail((c) => c.name === "security_events");
  await page.goto("/settings");
  await expect(activity(page).getByTestId("security-activity-error")).toBeVisible();
  await activity(page).getByTestId("security-activity-retry").click();
  await expect(activity(page).getByTestId("security-event-text")).toHaveText([
    "New capture key generated",
  ]);
});
