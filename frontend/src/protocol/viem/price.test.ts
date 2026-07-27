import { describe, expect, it } from "vitest";
import { hypePerHwaFromSqrtPrice } from "./price";

const Q96 = 1n << 96n;

describe("Algebra pool price conversion", () => {
  it("returns one HYPE per HWA at the neutral price in either token order", () => {
    expect(hypePerHwaFromSqrtPrice(Q96, true)).toBe(10n ** 18n);
    expect(hypePerHwaFromSqrtPrice(Q96, false)).toBe(10n ** 18n);
  });

  it("inverts the quote when HWA is token1", () => {
    expect(hypePerHwaFromSqrtPrice(Q96 * 2n, true)).toBe(4n * 10n ** 18n);
    expect(hypePerHwaFromSqrtPrice(Q96 * 2n, false)).toBe(25n * 10n ** 16n);
  });

  it("refuses an uninitialized pool", () => {
    expect(hypePerHwaFromSqrtPrice(0n, true)).toBeUndefined();
  });
});
