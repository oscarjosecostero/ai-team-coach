import { expect, test } from "@playwright/test";

/**
 * Phase 4 gate: demo login -> see the coach's proposal with its evidence -> accept -> calendar updated.
 */
test("athlete accepts a proposal and the calendar reflects it", async ({ page }) => {
  await page.goto("/login");
  await page.getByTestId("demo-login-carlos").click();

  await expect(page.getByTestId("dashboard")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Hi Carlos" })).toBeVisible();
  const banner = page.getByTestId("pending-proposals-banner");
  await expect(banner).toContainText("1 proposal from your coach");
  await banner.click();

  await expect(page).toHaveURL(/\/proposals$/);
  const card = page.getByTestId("proposal-card");
  await expect(card).toHaveCount(1);
  await expect(card).toContainText("Waiting for you");
  await expect(card).toContainText("Evidence cited");
  await expect(card).toContainText("Most consecutive hard days");
  await expect(card).toContainText("Plan impact (computed by the backend)");

  // The proposed duration as shown in the "Proposed" box, e.g. "Run · Intervals · 45 min".
  const proposed = (await card.locator("text=/Intervals · \\d+ min/").last().textContent()) ?? "";
  const minutes = /(\d+) min/.exec(proposed)?.[1];
  expect(minutes).toBeTruthy();
  const title = (await card.locator('[data-slot="card-title"]').textContent()) ?? "";

  await card.getByTestId("accept-proposal").click();
  await expect(page.getByText("Accepted. Your calendar is updated.")).toBeVisible();
  await expect(page.getByTestId("proposal-card")).toHaveCount(0);

  await page.getByRole("link", { name: "Calendar" }).click();
  await expect(page.getByTestId("calendar")).toBeVisible();
  const workoutTitle = title.split(" · ").slice(1).join(" · ").trim();
  const updated = page.locator('[data-testid^="workout-"]', { hasText: workoutTitle }).filter({ hasText: "Updated by an accepted proposal" });
  await expect(updated).toHaveCount(1);
  await expect(updated).toContainText(`${minutes} min`);
});

/** Regression: Next keeps visited routes alive; the login page must be usable again after a logout. */
test("switching accounts: athlete -> coach -> athlete", async ({ page }) => {
  await page.goto("/login");
  await page.getByTestId("demo-login-carlos").click();
  await expect(page.getByTestId("dashboard")).toBeVisible();

  await page.getByRole("button", { name: "Sign out" }).click();
  await page.getByTestId("demo-login-elena").click();
  await expect(page.getByTestId("ranking")).toBeVisible();
  await expect(page.getByRole("heading", { name: /Review queue/ })).toBeVisible();

  await page.getByRole("button", { name: "Sign out" }).click();
  await page.getByTestId("demo-login-carlos").click();
  await expect(page.getByRole("heading", { name: "Hi Carlos" })).toBeVisible();
});
