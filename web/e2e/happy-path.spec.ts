import { expect, test } from "@playwright/test";

const live = Boolean(process.env.E2E_BASE_URL);

/**
 * Phase 4 gate: demo login -> see the coach's proposal with its evidence -> accept -> calendar updated.
 * Locally the fixture's proposal comes from the agent loop with a scripted model. Against the live site
 * (Phase 5 gate) the proposal comes from real Claude: if none is waiting, the test runs the analysis.
 */
test("athlete accepts a proposal and the calendar reflects it", async ({ page }) => {
  if (live) test.setTimeout(5 * 60_000);
  await page.goto("/login");
  await page.getByTestId("demo-login-carlos").click();

  await expect(page.getByTestId("dashboard")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Hi Carlos" })).toBeVisible();
  const banner = page.getByTestId("pending-proposals-banner");
  if (live && !(await banner.isVisible({ timeout: 5_000 }).catch(() => false))) {
    await page.getByTestId("run-analysis").click();
    await expect(page.getByText(/^Analysis done/)).toBeVisible({ timeout: 4 * 60_000 });
  }
  await expect(banner).toContainText(live ? /proposals? from your coach/ : "1 proposal from your coach");
  await banner.click();

  await expect(page).toHaveURL(/\/proposals$/);
  const card = page.getByTestId("proposal-card").first();
  if (!live) await expect(page.getByTestId("proposal-card")).toHaveCount(1);
  await expect(card).toContainText("Waiting for you");
  await expect(card).toContainText("Evidence cited");
  if (!live) await expect(card).toContainText("Most consecutive hard days"); // the real model may cite other facts
  await expect(card).toContainText("Plan impact (computed by the backend)");

  // The fixture's proposal shortens the intervals session; its "Proposed" box reads "Run · Intervals · 45 min".
  const proposed = live ? "" : ((await card.locator("text=/Intervals · \\d+ min/").last().textContent()) ?? "");
  const minutes = /(\d+) min/.exec(proposed)?.[1];
  if (!live) expect(minutes).toBeTruthy();
  const title = (await card.locator('[data-slot="card-title"]').textContent()) ?? "";

  const before = await page.getByTestId("proposal-card").count();
  await card.getByTestId("accept-proposal").click();
  await expect(page.getByText("Accepted. Your calendar is updated.")).toBeVisible();
  await expect(page.getByTestId("proposal-card")).toHaveCount(before - 1);

  await page.getByRole("link", { name: "Calendar" }).click();
  await expect(page.getByTestId("calendar")).toBeVisible();
  const updated = page.locator('[data-testid^="workout-"]').filter({ hasText: "Updated by an accepted proposal" });
  if (live) {
    // A real proposal may move, swap or rest any workout: check that the accepted change landed.
    await expect(updated.first()).toBeVisible();
  } else {
    const workoutTitle = title.split(" · ").slice(1).join(" · ").trim();
    await expect(updated.filter({ hasText: workoutTitle })).toHaveCount(1);
    await expect(updated.filter({ hasText: workoutTitle })).toContainText(`${minutes} min`);
  }
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

/** The analysis runs in the background (202 + polling), so no proxy timeout sits in front of it. */
test("run analysis: the button waits for the background run and shows the cited summary", async ({ page }) => {
  test.skip(live, "Covered by the happy path against the live site (it may trigger a real run).");
  await page.goto("/login");
  await page.getByTestId("demo-login-ana").click();
  await expect(page.getByRole("heading", { name: "Hi Ana" })).toBeVisible();

  const button = page.getByTestId("run-analysis");
  await button.click();
  await expect(button).toBeDisabled();
  await expect(button).toContainText("Analyzing");
  await expect(page.getByText("Analysis done: no change needed.")).toBeVisible({ timeout: 30_000 });
  await expect(button).toBeEnabled();
  await expect(button).toHaveText("Run analysis");
  // The cited fact is rendered with the backend's value, not the raw [[fact-id]].
  await expect(page.getByText(/acute:chronic load ratio is/)).toBeVisible();
  await expect(page.getByText(/\[\[wk:/)).toHaveCount(0);
});
