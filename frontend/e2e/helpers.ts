import type { Page } from "@playwright/test";

/** The mock wallet address used by every scenario. */
export const MOCK_ADDRESS = "0xe11000000000000000000000000000000000cafe";

/**
 * Pre-accept the terms gate so a test can reach the connected UI. The gate
 * itself is covered by its own spec; every other journey seeds acceptance the
 * way a returning user would have it.
 */
export async function acceptTerms(page: Page, address = MOCK_ADDRESS): Promise<void> {
  await page.addInitScript(
    ([addr]) => {
      try {
        window.localStorage.setItem(`hwa.tos.${String(addr).toLowerCase()}`, "accepted");
      } catch {
        // storage unavailable — the gate will simply show
      }
    },
    [address],
  );
}
