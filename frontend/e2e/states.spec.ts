import { expect, test } from "@playwright/test";
import { acceptTerms } from "./helpers";

test.describe("Degraded and environment states", () => {
  test.beforeEach(async ({ page }) => {
    await acceptTerms(page);
  });

  test("wrong network: banner + switch works", async ({ page }) => {
    await page.goto("/?scenario=wrongNetwork");
    await page.getByTestId("connect-wallet").click();
    await expect(page.getByTestId("banner-wrong-network")).toBeVisible({ timeout: 10_000 });

    await page.getByTestId("wallet-menu-button").click();
    await page.getByTestId("switch-network").click();
    await expect(page.getByTestId("banner-wrong-network")).toBeHidden({ timeout: 10_000 });
  });

  test("indexer lag is flagged without blocking on-chain views", async ({ page }) => {
    await page.goto("/?scenario=indexerLag");
    await expect(page.getByTestId("banner-indexer-lag")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("pool-stats")).toBeVisible();
    // Quotes still price from live state despite the lagging indexer
    await expect(page.getByTestId("quote-caption")).toContainText("randomness", { timeout: 10_000 });
  });

  test("RPC down: indexed data browsable, quotes and writes paused", async ({ page }) => {
    await page.goto("/?scenario=rpcDown");
    await expect(page.getByTestId("banner-rpc-down")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("acquire-panel")).toContainText("Quote unavailable", { timeout: 10_000 });
    // Listings (indexed) still render
    await expect(page.locator('[data-testid^="listing-card-"]').first()).toBeVisible();
  });

  test("activity feed distinguishes indexed from confirmed", async ({ page }) => {
    await page.goto("/activity?scenario=default");
    await expect(page.getByTestId("activity-feed")).toBeVisible();
    await expect(page.getByText("● indexed")).toBeVisible();
    const rows = page.locator('[data-testid^="activity-"]');
    expect(await rows.count()).toBeGreaterThan(5);
  });

  test("rewards: honest inactive state, active module claims", async ({ page }) => {
    await page.goto("/rewards?scenario=default");
    await expect(page.getByText("Rewards V2 are not deployed")).toBeVisible();
    // No invented APR anywhere
    await expect(page.locator("body")).not.toContainText("APR");

    await page.goto("/rewards?scenario=rewardsActive");
    await page.getByTestId("connect-wallet").click();
    const claim = page.getByTestId("claim-depositor");
    await expect(claim).toBeVisible({ timeout: 10_000 });
    // An open programme must never tell a holder their rewards are locked.
    await expect(claim).toBeEnabled({ timeout: 10_000 });
    await expect(claim).toHaveText("Claim HWA");
    await claim.click();
    await expect(page.getByTestId("tx-claim_rewards")).toHaveAttribute("data-phase", "completed", { timeout: 15_000 });
    await expect(claim).toBeDisabled({ timeout: 10_000 });
    await expect(claim).toHaveText("Nothing to claim");
  });

  test("reload during a pending acquisition resumes tracking", async ({ page }) => {
    await page.goto("/?scenario=slowRandomness");
    await page.getByTestId("connect-wallet").click();
    await page.getByTestId("acquire-review").click();
    await page.getByTestId("acquire-confirm").click();
    await expect(page.locator('[data-testid^="ticket-"]').first()).toBeVisible({ timeout: 15_000 });

    // Simulate the refresh mid-randomness
    await page.reload();
    await page.getByTestId("connect-wallet").click();
    const ticket = page.locator('[data-testid^="ticket-"]').first();
    await expect(ticket).toBeVisible({ timeout: 10_000 });
    // Resumed ticket completes shortly after
    await expect(ticket).toHaveAttribute("data-phase", "allocated", { timeout: 20_000 });
  });

  test("mock data is always labeled", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("banner-mock")).toContainText("MOCK DATA");
  });
});
