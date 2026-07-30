import { expect, test } from "@playwright/test";

test.describe("Pool exploration", () => {
  test("loads stats, mock banner, crown and listings", async ({ page }) => {
    await page.goto("/?scenario=default");
    await expect(page.getByTestId("banner-mock")).toBeVisible();
    await expect(page.getByTestId("pool-stats")).toBeVisible();
    await expect(page.getByTestId("crown-card")).toBeVisible();
    await expect(page.getByTestId("crown-card")).toContainText("next crown ≥");
    await expect(page.getByTestId("crown-card")).toContainText("(+10%)");
    await expect(page.getByTestId("listing-grid")).toBeVisible();
    const cards = page.locator('[data-testid^="listing-card-"]');
    expect(await cards.count()).toBeGreaterThan(8);
  });

  test("show more reveals every current pool position without limiting the hero deck", async ({ page }) => {
    await page.goto("/?scenario=default");

    const cards = page.locator('[data-testid^="listing-card-"]');
    await expect(cards).toHaveCount(24);
    const showMore = page.getByRole("button", { name: /Show more/ });
    await expect(showMore).toBeVisible();

    const heroTotal = Number(await page.getByTestId("hero-stage").getAttribute("data-total"));
    expect(heroTotal).toBe(24);

    await showMore.click();
    await expect(cards).toHaveCount(27);
    await expect(showMore).toHaveCount(0);
  });
  test("browses the hero deck by drag, arrows and keyboard — never on hover", async ({ page }) => {
    await page.goto("/?scenario=default");
    const stage = page.getByTestId("hero-stage");
    await expect(stage).toBeVisible();

    const total = Number(await stage.getAttribute("data-total"));
    expect(total).toBeGreaterThan(7);

    const bounds = await stage.boundingBox();
    expect(bounds).not.toBeNull();
    if (!bounds) return;
    const y = bounds.y + Math.min(120, bounds.height / 2);
    const midX = bounds.x + bounds.width / 2;

    // Hovering across the deck must NOT change the card: the deck sits between
    // the page and the buy panel, and swapping under a passing cursor reads as
    // a broken hero.
    const before = await stage.getAttribute("data-front-index");
    await page.mouse.move(bounds.x + 4, y);
    await page.mouse.move(bounds.x + bounds.width - 4, y, { steps: 12 });
    await page.waitForTimeout(400);
    expect(await stage.getAttribute("data-front-index")).toBe(before);

    // Dragging does.
    await page.mouse.move(midX, y);
    await page.mouse.down();
    await page.mouse.move(midX - 220, y, { steps: 10 });
    await page.mouse.up();
    await expect.poll(() => stage.getAttribute("data-front-index")).not.toBe(before);
    await expect(stage.locator('[data-active="true"]')).toHaveCount(1);

    // So do the arrow buttons and the keyboard.
    const afterDrag = await stage.getAttribute("data-front-index");
    await page.getByRole("button", { name: "Next listed NFT" }).click();
    await expect.poll(() => stage.getAttribute("data-front-index")).not.toBe(afterDrag);

    const afterButton = await stage.getAttribute("data-front-index");
    await stage.focus();
    await page.keyboard.press("ArrowLeft");
    await expect.poll(() => stage.getAttribute("data-front-index")).not.toBe(afterButton);
  });

  test("active NFT tracks the pointer with branded foil depth", async ({ page }) => {
    await page.goto("/?scenario=default");
    const stage = page.getByTestId("hero-stage");
    await expect(stage).toBeVisible();

    const active = stage.locator('[data-active="true"]');
    await expect(active).toHaveCount(1);
    await active.hover({ position: { x: 210, y: 120 } });

    const foil = active.locator(".hero-prize-card");
    await expect.poll(() => foil.getAttribute("data-fx-active")).toBe("true");
    const tilt = await foil.evaluate((element) => ({
      x: element.style.getPropertyValue("--card-tilt-x"),
      y: element.style.getPropertyValue("--card-tilt-y"),
      glare: element.style.getPropertyValue("--card-fx-opacity"),
    }));
    expect(tilt.x).not.toBe("0deg");
    expect(tilt.y).not.toBe("0deg");
    expect(tilt.glare).toBe("1");

    await page.mouse.move(0, 0);
    await expect.poll(() => foil.getAttribute("data-fx-active")).toBe("false");
  });

  test("clicking the active NFT flips its protocol data directly onto the card", async ({ page }) => {
    await page.goto("/?scenario=default");
    const stage = page.getByTestId("hero-stage");
    await expect(stage).toBeVisible();

    // Hover pauses auto-rotation so the active card stays stable for both clicks.
    await stage.hover();
    const active = stage.locator('[data-active="true"]');
    await expect(active).toHaveCount(1);
    await active.click();

    await expect(active).toHaveAttribute("data-flipped", "true");
    await expect(active.getByText("HWA POSITION DATA")).toBeVisible();
    for (const label of ["P/L", "Backing", "Odds", "Since", "Listing", "Depositor"]) {
      await expect(active.getByText(label, { exact: true })).toBeVisible();
    }

    await active.click();
    await expect(active).toHaveAttribute("data-flipped", "false");
    await expect(page.getByTestId("hero-open-details")).toBeVisible();
  });

  test("switches feeds, list layout, filters and sort", async ({ page }) => {
    await page.goto("/?scenario=default");
    await page.getByRole("radio", { name: "Deposits" }).click();
    await expect(page.locator('[data-testid^="feed-row-"]').first()).toBeVisible();

    await page.getByRole("radiogroup", { name: "Layout" }).getByRole("radio", { name: "List" }).click();
    await expect(page.getByTestId("listing-list")).toBeVisible();

    await page.getByLabel("Search listings").fill("Hypurr");
    await expect(page.locator('[data-testid^="listing-row-"]').first()).toContainText("Hypurr");

    await page.getByLabel("Sort listings").selectOption("date:desc");
    await expect(page.getByTestId("listing-list")).toBeVisible();
  });

  test("opens the deep-linkable detail drawer", async ({ page }) => {
    await page.goto("/?scenario=default");
    await page.locator('[data-testid^="listing-card-"]').first().click();
    await expect(page.getByTestId("listing-detail")).toBeVisible();
    expect(page.url()).toMatch(/listing=\d+/);

    // Deep link directly
    await page.goto("/?scenario=default&listing=1");
    await expect(page.getByTestId("listing-detail")).toBeVisible();
    await expect(page.getByTestId("listing-detail").getByText("Selection odds")).toBeVisible();
  });

  test("empty pool shows the honest empty state", async ({ page }) => {
    await page.goto("/?scenario=emptyPool");
    await expect(page.getByText("No active NFT positions.", { exact: true })).toBeVisible();
    await expect(page.getByTestId("prize-stack").locator(".skeleton")).toHaveCount(0);
    await expect(page.getByText("The pool is empty", { exact: true })).toBeVisible();
    await expect(page.getByTestId("acquire-panel")).toContainText("Acquisitions closed");
  });
});
