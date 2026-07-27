import { expect, test } from "@playwright/test";

const VIEWPORTS = [
  { label: "mobile", width: 390, height: 844 },
  { label: "tablet portrait", width: 768, height: 1024 },
  { label: "tablet landscape", width: 1024, height: 768 },
  { label: "desktop", width: 1440, height: 900 },
] as const;

for (const viewport of VIEWPORTS) {
  test(`pool remains usable without page overflow on ${viewport.label}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto("/?scenario=default");

    await expect(page.getByTestId("market-hud")).toBeVisible();
    await expect(page.getByTestId("acquire-panel")).toBeVisible();
    await expect(page.getByTestId("connect-wallet")).toBeVisible();

    const layout = await page.evaluate(() => {
      const root = document.documentElement;
      const connect = document.querySelector<HTMLElement>("[data-testid='connect-wallet']")?.getBoundingClientRect();
      const ticket = document.querySelector<HTMLElement>("[data-testid='acquire-panel']")?.getBoundingClientRect();
      return {
        clientWidth: root.clientWidth,
        scrollWidth: root.scrollWidth,
        connectLeft: connect?.left ?? -1,
        connectRight: connect?.right ?? Number.MAX_SAFE_INTEGER,
        ticketLeft: ticket?.left ?? -1,
        ticketRight: ticket?.right ?? Number.MAX_SAFE_INTEGER,
      };
    });

    expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth + 1);
    expect(layout.connectLeft).toBeGreaterThanOrEqual(0);
    expect(layout.connectRight).toBeLessThanOrEqual(layout.clientWidth + 1);
    expect(layout.ticketLeft).toBeGreaterThanOrEqual(0);
    expect(layout.ticketRight).toBeLessThanOrEqual(layout.clientWidth + 1);
  });
}
