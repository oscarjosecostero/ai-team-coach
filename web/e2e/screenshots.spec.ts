import { test } from "@playwright/test";

/** Opt-in visual pass (SCREENSHOTS=1): saves each page, light and dark, to e2e/screenshots/. */
test.skip(!process.env.SCREENSHOTS, "set SCREENSHOTS=1 to capture screenshots");

for (const scheme of ["light", "dark"] as const) {
  test(`screenshots (${scheme})`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    test.info().annotations.push({ type: "errors", description: "see console" });
    await page.emulateMedia({ colorScheme: scheme });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/login");
    await page.getByTestId("demo-login-carlos").waitFor();
    await page.screenshot({ path: `e2e/screenshots/${scheme}-login.png`, fullPage: true });
    await page.getByTestId("demo-login-carlos").click();
    await page.getByTestId("kpis").waitFor();
    await page.waitForTimeout(500);
    await page.screenshot({ path: `e2e/screenshots/${scheme}-dashboard.png`, fullPage: true });
    await page.goto("/proposals");
    await page.getByTestId("proposal-card").first().waitFor();
    await page.screenshot({ path: `e2e/screenshots/${scheme}-proposals.png`, fullPage: true });
    await page.getByRole("tab", { name: "History" }).click();
    await page.getByTestId("proposal-card").first().waitFor();
    await page.screenshot({ path: `e2e/screenshots/${scheme}-proposal-history.png`, fullPage: true });
    for (const route of ["calendar", "team", "chat"]) {
      await page.goto(`/${route}`);
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(300);
      await page.screenshot({ path: `e2e/screenshots/${scheme}-${route}.png`, fullPage: true });
    }
    await page.getByRole("button", { name: "Sign out" }).click();
    await page.getByTestId("demo-login-elena").click();
    await page.getByTestId("ranking").waitFor();
    await page.screenshot({ path: `e2e/screenshots/${scheme}-coach-team.png`, fullPage: true });
    await page.getByRole("button", { name: "Sign out" }).click();
    await page.getByTestId("demo-login-carlos").click();
    await page.getByTestId("kpis").waitFor();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/dashboard");
    await page.getByTestId("kpis").waitFor();
    await page.screenshot({ path: `e2e/screenshots/${scheme}-mobile-dashboard.png`, fullPage: true });
    if (errors.length) throw new Error(`browser errors:\n${errors.join("\n")}`);
  });
}
