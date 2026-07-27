import { test } from "@playwright/test";
import { acceptTerms } from "./helpers";
import fs from "node:fs";
import path from "node:path";

/**
 * Responsive control captures → frontend/artifacts/screenshots/.
 * Run with: npm run screenshots
 */

const OUT = path.join(__dirname, "..", "artifacts", "screenshots");

const VIEWPORTS = [
  { name: "desktop-1440", width: 1440, height: 900 },
  { name: "tablet-1024", width: 1024, height: 768 },
  { name: "mobile-390", width: 390, height: 844 },
] as const;

const PAGES = [
  { name: "pool", url: "/?scenario=default", settle: 21_000 },
  { name: "pool-detail", url: "/?scenario=default&listing=1", settle: 2_500 },
  { name: "deposit", url: "/deposit?scenario=default", settle: 1_500, connect: true },
  { name: "positions", url: "/positions?scenario=default", settle: 1_500, connect: true },
  { name: "activity", url: "/activity?scenario=default", settle: 1_500 },
  { name: "rewards-inactive", url: "/rewards?scenario=default", settle: 1_200 },
  { name: "rewards-active", url: "/rewards?scenario=rewardsActive", settle: 1_500, connect: true },
  { name: "token-live", url: "/token?scenario=rewardsActive", settle: 3_500, connect: true },
  { name: "token-inactive", url: "/token?scenario=default", settle: 2_500 },
  { name: "acquisitions", url: "/acquisitions?scenario=default", settle: 1_500, connect: true },
  { name: "docs", url: "/docs", settle: 1_200 },
  { name: "terms", url: "/terms", settle: 1_200 },
] as const;

test.beforeAll(() => {
  fs.mkdirSync(OUT, { recursive: true });
});

// Light-theme control shots (dark is default everywhere else)
for (const p of [
  { name: "pool-light", url: "/?scenario=default", settle: 2_500 },
  { name: "positions-light", url: "/positions?scenario=default", settle: 1_500, connect: true },
] as const) {
  test(`${p.name} @ desktop-1440`, async ({ page }) => {
    await acceptTerms(page);
    await page.addInitScript(() => localStorage.setItem("hwa.theme", "light"));
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(p.url);
    if ("connect" in p && p.connect) {
      await page.waitForTimeout(900);
      const btn = page.getByTestId("connect-wallet");
      if (await btn.isVisible().catch(() => false)) {
        await btn.click();
        await page.getByTestId("wallet-menu-button").waitFor({ timeout: 10_000 }).catch(() => {});
        await page.waitForTimeout(700);
      }
    }
    await page.waitForTimeout(p.settle);
    await page.screenshot({ path: path.join(OUT, `${p.name}--desktop-1440.png`), fullPage: false });
  });
}

for (const vp of VIEWPORTS) {
  for (const p of PAGES) {
    test(`${p.name} @ ${vp.name}`, async ({ page }) => {
      await acceptTerms(page);
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto(p.url);
      if ("connect" in p && p.connect) {
        // Let React hydrate before clicking, otherwise the click lands on the
        // server-rendered markup and no handler runs.
        await page.waitForTimeout(900);
        const btn = page.getByTestId("connect-wallet");
        if (await btn.isVisible().catch(() => false)) {
          await btn.click();
          await page.getByTestId("wallet-menu-button").waitFor({ timeout: 10_000 }).catch(() => {});
          await page.waitForTimeout(700);
        }
      }
      await page.waitForTimeout(p.settle);
      await page.screenshot({ path: path.join(OUT, `${p.name}--${vp.name}.png`), fullPage: false });
    });
  }
}
