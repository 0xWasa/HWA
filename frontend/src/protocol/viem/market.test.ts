import { describe, expect, it } from "vitest";
import { buildPoolMarketHistory } from "./market";

const Q96 = 2n ** 96n;

describe("Project X pool market history", () => {
  it("buckets swaps, exposes both volumes and closes at the current price", () => {
    const now = 1_800_000_000;
    const history = buildPoolMarketHistory(
      [
        { timestamp: now - 1_000, sqrtPriceX96: Q96, amount0: -4n, amount1: 8n },
        { timestamp: now - 950, sqrtPriceX96: Q96 * 2n, amount0: 3n, amount1: -7n },
      ],
      true,
      2n * 10n ** 18n,
      now,
    );

    expect(history.poolSwaps).toBe(2);
    expect(history.volume24hHype).toBe(15n);
    expect(history.volume24hToken).toBe(7n);
    expect(history.candles.length).toBeGreaterThanOrEqual(2);
    expect(history.candles.at(-1)?.c).toBe(2n * 10n ** 18n);
  });

  it("does not fabricate a chart before the first swap", () => {
    expect(buildPoolMarketHistory([], true, 10n, 1_800_000_000)).toEqual({
      candles: [],
      change24hBps: undefined,
      volume24hHype: 0n,
      volume24hToken: 0n,
      poolSwaps: 0,
    });
  });

  it("drops swaps older than 24 hours", () => {
    const now = 1_800_000_000;
    const history = buildPoolMarketHistory(
      [{ timestamp: now - 86_401, sqrtPriceX96: Q96, amount0: -4n, amount1: 8n }],
      true,
      1n,
      now,
    );
    expect(history.poolSwaps).toBe(0);
    expect(history.candles).toEqual([]);
  });
});
