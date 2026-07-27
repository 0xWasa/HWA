import { describe, expect, it } from "vitest";
import {
  applyBps,
  formatHype,
  formatOddsPercent,
  oddsOneIn,
  oddsPpm,
  parseHype,
  weightFromBacking,
  WEI,
} from "./units";

describe("formatHype", () => {
  it("formats whole and fractional amounts", () => {
    expect(formatHype(0n)).toBe("0");
    expect(formatHype(WEI)).toBe("1");
    expect(formatHype(WEI / 100n)).toBe("0.01");
    expect(formatHype((WEI * 12345n) / 10000n)).toBe("1.2345");
  });
  it("truncates to maxDecimals without rounding up liabilities", () => {
    expect(formatHype(WEI + 1n, { maxDecimals: 4 })).toBe("1");
    expect(formatHype((WEI * 123456n) / 100000n, { maxDecimals: 2 })).toBe("1.23");
  });
  it("groups thousands with NNBSP and keeps sign", () => {
    expect(formatHype(1_234_567n * WEI)).toBe("1 234 567");
    expect(formatHype(-3n * WEI)).toBe("-3");
    expect(formatHype(3n * WEI, { sign: true })).toBe("+3");
  });
});

describe("parseHype", () => {
  it("parses decimals into wei", () => {
    expect(parseHype("1")).toBe(WEI);
    expect(parseHype("0.01")).toBe(WEI / 100n);
    expect(parseHype("1,5")).toBe(WEI + WEI / 2n);
    expect(parseHype("  2 000 ")).toBe(2000n * WEI);
  });
  it("rejects invalid input", () => {
    expect(parseHype("")).toBeNull();
    expect(parseHype("abc")).toBeNull();
    expect(parseHype("1.2.3")).toBeNull();
    expect(parseHype("-1")).toBeNull();
    expect(parseHype("0." + "1".repeat(19))).toBeNull(); // beyond wei precision
  });
  it("round-trips with formatHype", () => {
    const v = (WEI * 987654321n) / 1_000_000n;
    expect(parseHype(formatHype(v, { maxDecimals: 18 }).replace(/ /g, ""))).toBe(v);
  });
});

describe("weights and odds", () => {
  it("weight = 1e36 / backing (matches FWA.sol)", () => {
    expect(weightFromBacking(WEI)).toBe(10n ** 18n);
    expect(weightFromBacking(WEI / 100n)).toBe(10n ** 20n);
  });
  it("odds are proportional to weight", () => {
    const w1 = weightFromBacking(WEI); // 1 HYPE
    const w2 = weightFromBacking(WEI / 100n); // 0.01 HYPE → 100× more likely
    const total = w1 + w2;
    expect(oddsPpm(w2, total)).toBeGreaterThan(oddsPpm(w1, total) * 99);
    expect(oddsOneIn(w1, total)).toBe("1 in 101");
    expect(formatOddsPercent(w2, total)).toBe("99.0%");
  });
  it("handles empty pool", () => {
    expect(oddsPpm(1n, 0n)).toBe(0);
    expect(oddsOneIn(0n, 0n)).toBe("—");
  });
});

describe("applyBps", () => {
  it("floors like the contract", () => {
    expect(applyBps(10_000n, 8_500n)).toBe(8_500n);
    expect(applyBps(3n, 8_500n)).toBe(2n); // 2.55 → 2
    expect(applyBps(WEI, 11_000n)).toBe((WEI * 11n) / 10n);
  });
});
