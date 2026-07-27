import { expect, test } from "@playwright/test";
import { acceptTerms } from "./helpers";

test.describe("Token, acquisitions, docs and terms", () => {
  test("terms gate appears on connect and unlocks the app", async ({ page }) => {
    // Deliberately NOT pre-accepted: this is the gate's own test.
    await page.goto("/?scenario=default");
    await page.getByTestId("connect-wallet").click();

    const gate = page.getByTestId("tos-gate");
    await expect(gate).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("tos-continue")).toBeDisabled();

    await page.getByTestId("tos-checkbox").check();
    await page.getByTestId("tos-continue").click();
    await expect(gate).toBeHidden();

    // Acceptance is remembered for that address across reloads
    await page.reload();
    await expect(page.getByTestId("tos-gate")).toBeHidden();
  });

  test("token page: honest inactive state, then live market with a swap quote", async ({ page }) => {
    await acceptTerms(page);

    await page.goto("/token?scenario=default");
    await expect(page.getByText(/not (live|activated)/i).first()).toBeVisible({ timeout: 10_000 });

    await page.goto("/token?scenario=rewardsActive");
    await page.getByTestId("connect-wallet").click();
    // Chart renders from local candles — no external chart library or network
    await expect(page.locator("svg").first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/HWA \/ HYPE|\$HWA/i).first()).toBeVisible();
    await expect(page.getByText(/pool swaps/i).first()).toBeVisible();
  });

  test("acquisitions page shows purchase stats and history", async ({ page }) => {
    await acceptTerms(page);
    await page.goto("/acquisitions?scenario=default");
    await page.getByTestId("connect-wallet").click();

    await expect(page.getByText(/purchases/i).first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/all-in/i).first()).toBeVisible();
    await expect(page.getByText(/net listing p\/?l/i).first()).toBeVisible();
  });

  test("an acquisition keeps a persistent, deep-linkable result and its four choices", async ({ page }) => {
    await acceptTerms(page);
    await page.goto("/acquisitions/6028?scenario=default");
    await page.getByTestId("connect-wallet").click();

    const result = page.getByTestId("purchase-result-surface");
    await expect(result).toBeVisible({ timeout: 10_000 });
    await expect(result.getByText("Purchase Successful", { exact: true })).toBeVisible();
    await expect(result.getByTestId("inline-settlement-panel")).toBeVisible();
    await expect(result.getByTestId("settle-keep")).toBeVisible();
    await expect(result.getByTestId("settle-relist")).toBeVisible();
    await expect(result.getByTestId("settle-acceptBidHype")).toBeVisible();
    await expect(result.getByTestId("settle-acceptBidTokens")).toBeVisible();
  });

  test("docs and terms render without a wallet", async ({ page }) => {
    await page.goto("/docs");
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
    await expect(page.getByText(/1e36/).first()).toBeVisible();

    await page.goto("/terms");
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
    await expect(page.locator("body")).not.toContainText("Ξ");
  });

  test("nav reaches every route", async ({ page }) => {
    await page.goto("/");
    for (const [label, path] of [
      ["$HWA", "/token"],
      ["Acquisitions", "/acquisitions"],
      ["Manage", "/positions"],
      ["Activity", "/activity"],
      ["Rewards", "/rewards"],
    ] as const) {
      await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: label }).click();
      await expect(page).toHaveURL(new RegExp(`${path}$`));
    }
  });
});
