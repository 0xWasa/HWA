import { expect, test } from "@playwright/test";
import { acceptTerms } from "./helpers";

test.describe("Deposit journey", () => {
  test.beforeEach(async ({ page }) => {
    await acceptTerms(page);
  });

  test("guided flow: select → backing → approve → list → staged/active", async ({ page }) => {
    await page.goto("/deposit?scenario=fresh");

    // Gate: wallet first
    await expect(page.getByText("Connect a wallet to deposit")).toBeVisible();
    await page.getByRole("button", { name: "Connect wallet" }).first().click();

    // Inventory loads; ineligible collection is disabled with a reason
    await expect(page.getByTestId("nft-picker")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("nft-ineligible").first()).toBeDisabled();

    // Pick an eligible, unapproved NFT
    await page.getByTestId("nft-eligible").first().click();

    // Backing below minimum is rejected inline
    await page.getByLabel("HYPE backing").fill("0.001");
    await expect(page.getByTestId("backing-error")).toContainText("live on-chain minimum");
    await page.getByLabel("HYPE backing").fill("0.5");
    await expect(page.getByText("Selection odds after deposit")).toBeVisible();

    // Approval is its own visible transaction
    await page.getByTestId("approve-btn").click();
    await expect(page.getByTestId("tx-approve_nft")).toHaveAttribute("data-phase", "completed", { timeout: 15_000 });
    await expect(page.getByText("approved ✓").first()).toBeVisible();

    // Then the listing transaction
    await page.getByTestId("list-btn").click();
    await expect(page.getByTestId("deposit-launch-sequence")).toBeVisible();
    await expect(page.getByTestId("tx-list_nft")).toHaveAttribute("data-phase", "completed", { timeout: 15_000 });

    // Staged confirmation, then automatic activation
    await expect(page.getByTestId("deposit-launch-sequence")).toHaveAttribute("data-phase", /staged|active/, { timeout: 15_000 });
    await expect(page.getByTestId("deposit-launch-sequence")).toHaveAttribute("data-phase", "active", { timeout: 20_000 });
    await expect(page.getByRole("button", { name: "View live card" })).toBeVisible();
  });

  test("wrong network gate offers a switch, and refusal is surfaced", async ({ page }) => {
    await page.goto("/deposit?scenario=switchRefused");
    await page.getByRole("button", { name: "Connect wallet" }).first().click();
    await expect(page.getByRole("main").getByText("Wrong network")).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: "Switch network" }).click();
    // Refused: still on the wrong network, banner persists
    await expect(page.getByTestId("banner-wrong-network")).toBeVisible({ timeout: 10_000 });
  });
});
