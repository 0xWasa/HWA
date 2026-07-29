import { expect, test } from "@playwright/test";
import { acceptTerms } from "./helpers";

test.describe("Acquisition journey", () => {
  test.beforeEach(async ({ page }) => {
    await acceptTerms(page);
  });

  test("connect → quote → review → confirm → randomness → reveal → settlement choices", async ({ page }) => {
    await page.goto("/?scenario=default");

    // Wallet disconnected state first
    await expect(page.getByTestId("acquire-connect")).toBeVisible();
    await page.getByTestId("connect-wallet").click();
    await expect(page.getByTestId("wallet-menu-button")).toBeVisible();

    // Quote visible with total; pick quantity 2
    await expect(page.getByTestId("quote-total")).toBeVisible();
    await page.getByTestId("qty-2").click();

    // Review step shows network, amount and guards before any signature
    await page.getByTestId("acquire-review").click();
    const review = page.getByTestId("acquire-review-block");
    await expect(review).toBeVisible();
    await expect(review).toContainText("HyperEVM");
    await expect(review).toContainText("Acquire 2 random positions");
    await expect(review).toContainText("Drift tolerance");

    await page.getByTestId("acquire-confirm").click();

    // Tx machine: never "submitted = success"
    const tx = page.getByTestId("tx-acquire");
    await expect(tx).toBeVisible();
    await expect(tx).toHaveAttribute("data-phase", "completed", { timeout: 15_000 });

    // The NFT remains concealed while authenticated randomness is in flight.
    await expect(page.getByTestId("randomness-flight-deck")).toBeVisible({ timeout: 10_000 });

    // Tickets go through randomness, reveal, then expose every settlement path.
    const tickets = page.locator('[data-testid^="ticket-"]');
    await expect(tickets.first()).toBeVisible({ timeout: 10_000 });
    const reveal = page.getByTestId("reveal-overlay");
    await expect(reveal).toBeVisible({ timeout: 20_000 });
    // Pack-opening machine: sealed → flipping → revealed always terminates.
    await expect(reveal).toHaveAttribute("data-reveal-stage", "revealed", { timeout: 10_000 });
    await expect(reveal.getByTestId("purchase-result-surface")).toBeVisible();
    await expect(reveal.getByText("Purchase Successful", { exact: true })).toBeVisible();
    await expect(reveal.getByTestId("inline-settlement-panel")).toBeVisible();
    await expect(reveal.getByTestId("settle-keep")).toBeEnabled();
    await expect(reveal.getByTestId("settle-relist")).toBeEnabled();
    await expect(reveal.getByTestId("settle-acceptBidHype")).toBeEnabled();
    await expect(reveal.getByTestId("settle-acceptBidTokens")).toBeVisible();

    await reveal.getByTestId("open-share-purchase").click();
    const share = page.getByTestId("share-purchase-modal");
    await expect(share).toBeVisible();
    await expect(share.locator("canvas")).toBeVisible();
    await expect(share.getByTestId("download-purchase-card")).toBeVisible();
    await expect(share.getByTestId("share-purchase-card")).toBeVisible();
  });

  test("sealed reveal card can be tapped through and always resolves", async ({ page }) => {
    await page.goto("/?scenario=default");
    await page.getByTestId("connect-wallet").click();
    await page.getByTestId("acquire-review").click();
    await page.getByTestId("acquire-confirm").click();

    const reveal = page.getByTestId("reveal-overlay");
    await expect(reveal).toBeVisible({ timeout: 20_000 });
    // The seal auto-advances after a short hold; if we catch it in time, a tap
    // must skip the hold. The click races the machine by design, so a miss is
    // fine — the real invariant is that the machine always lands on "revealed".
    const seal = reveal.getByTestId("reveal-seal");
    if (await seal.isVisible().catch(() => false)) {
      await seal.click({ timeout: 1_500 }).catch(() => {});
    }
    await expect(reveal).toHaveAttribute("data-reveal-stage", "revealed", { timeout: 8_000 });
    await expect(reveal.getByText("Purchase Successful", { exact: true })).toBeVisible();
  });

  test("insufficient balance blocks the CTA with a reason", async ({ page }) => {
    await page.goto("/?scenario=poorWallet");
    await page.getByTestId("connect-wallet").click();
    await expect(page.getByTestId("acquire-review")).toContainText("Insufficient HYPE balance", { timeout: 10_000 });
    await expect(page.getByTestId("acquire-review")).toBeDisabled();
  });

  test("frozen quote goes stale and is flagged", async ({ page }) => {
    await page.goto("/?scenario=staleQuote");
    await page.getByTestId("connect-wallet").click();
    await expect(page.getByTestId("quote-freshness")).toHaveAttribute("data-freshness", "stale", {
      timeout: 30_000,
    });
  });

  test("randomness timeout expires the request and credits a refund", async ({ page }) => {
    test.setTimeout(90_000);
    await page.goto("/?scenario=randomnessTimeout");
    await page.getByTestId("connect-wallet").click();
    await page.getByTestId("acquire-review").click();
    await page.getByTestId("acquire-confirm").click();
    const ticket = page.locator('[data-testid^="ticket-"]').first();
    await expect(ticket).toBeVisible({ timeout: 15_000 });
    await expect(ticket).toHaveAttribute("data-phase", "expired", { timeout: 30_000 });
    await expect(ticket).toContainText("credited");
  });
});
