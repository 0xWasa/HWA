import { expect, test } from "@playwright/test";
import { acceptTerms } from "./helpers";

test.describe("Positions & settlement", () => {
  test.beforeEach(async ({ page }) => {
    await acceptTerms(page);
  });

  test("tabs populate and settlement keep completes", async ({ page }) => {
    await page.goto("/positions?scenario=default");
    await page.getByTestId("connect-wallet").click();

    // Deposited tab: fee claims + withdraw lock messaging
    await expect(page.getByTestId("deposited-list")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Fees accrued").first()).toBeVisible();

    // Allocated: purchaser-side settlement with the four choices
    await page.getByTestId("tab-allocated").click();
    await page.locator('[data-testid^="settle-open-"]').first().click();
    const drawer = page.getByTestId("settlement-drawer");
    await expect(drawer).toBeVisible();
    await expect(drawer).toContainText("Keep the NFT");
    await expect(drawer).toContainText("Keep & relist");
    await expect(drawer).toContainText("Accept the depositor bid");
    // Token settlement gated while the rewards module is inactive
    await expect(page.getByTestId("settle-acceptBidTokens")).toBeDisabled();

    await page.getByTestId("settle-keep").click();
    await page.getByTestId("settle-confirm").click();
    await expect(page.getByTestId("tx-settle_keep")).toHaveAttribute("data-phase", "completed", { timeout: 15_000 });

    // Lands in Settled with the outcome recorded
    await page.getByTestId("tab-settled").click();
    await expect(page.getByText("Kept NFT").first()).toBeVisible({ timeout: 10_000 });
  });

  test("depositor window and stuck NFT recovery", async ({ page }) => {
    await page.goto("/positions?scenario=default");
    await page.getByTestId("connect-wallet").click();

    // Depositor-side allocation (26h old): reclaim actions are open
    await page.getByTestId("tab-allocated").click();
    await expect(page.getByText("your deposit — acquired")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("button", { name: "Reclaim backing" })).toBeVisible();

    // Stuck NFT retry
    await page.getByTestId("tab-claims").click();
    await expect(page.getByTestId("stuck-list")).toBeVisible();
    await page.locator('[data-testid^="retry-stuck-"]').first().click();
    await expect(page.getByTestId("tx-recover_stuck_nft")).toHaveAttribute("data-phase", "completed", {
      timeout: 15_000,
    });
  });

  test("refunds & earnings withdraw to the wallet", async ({ page }) => {
    await page.goto("/positions?scenario=default");
    await page.getByTestId("connect-wallet").click();
    await page.getByTestId("tab-claims").click();

    await page.getByTestId("claim-earnings").click();
    await expect(page.getByTestId("tx-withdraw_earnings")).toHaveAttribute("data-phase", "completed", {
      timeout: 15_000,
    });
    // Once withdrawn, the row zeroes out and disables
    await expect(page.getByTestId("claim-earnings")).toBeDisabled({ timeout: 10_000 });
  });

  test("wallet without positions sees empty states", async ({ page }) => {
    await page.goto("/positions?scenario=fresh");
    await page.getByTestId("connect-wallet").click();
    await expect(page.getByText("No deposits")).toBeVisible({ timeout: 10_000 });
    await page.getByTestId("tab-pending").click();
    await expect(page.getByText("No acquisition requests")).toBeVisible();
  });
});
