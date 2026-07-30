import type { Candle } from "@/protocol/types";
import { hypePerHwaFromSqrtPrice } from "./price";

export interface PoolSwapSample {
  timestamp: number;
  sqrtPriceX96: bigint;
  amount0: bigint;
  amount1: bigint;
}

export interface PoolMarketHistory {
  candles: Candle[];
  change24hBps?: number;
  volume24hHype: bigint;
  volume24hToken: bigint;
  poolSwaps: number;
}

const CANDLE_SECONDS = 15 * 60;
const HISTORY_SECONDS = 24 * 60 * 60;

function absolute(value: bigint): bigint {
  return value < 0n ? -value : value;
}

/**
 * Convert canonical V3 Swap samples into the local, dependency-free chart
 * model. A swap's sqrt price is the post-swap pool price; volumes use the
 * absolute pool deltas so buys and sells contribute equally.
 */
export function buildPoolMarketHistory(
  samples: PoolSwapSample[],
  hwaIsToken0: boolean,
  currentPrice: bigint,
  now: number,
): PoolMarketHistory {
  const cutoff = now - HISTORY_SECONDS;
  const recent = samples
    .filter((sample) => sample.timestamp >= cutoff && sample.timestamp <= now)
    .sort((a, b) => a.timestamp - b.timestamp);

  let volume24hHype = 0n;
  let volume24hToken = 0n;
  const buckets = new Map<number, Candle>();

  for (const sample of recent) {
    const price = hypePerHwaFromSqrtPrice(sample.sqrtPriceX96, hwaIsToken0);
    if (price === undefined || price <= 0n) continue;
    const hypeVolume = absolute(hwaIsToken0 ? sample.amount1 : sample.amount0);
    const tokenVolume = absolute(hwaIsToken0 ? sample.amount0 : sample.amount1);
    volume24hHype += hypeVolume;
    volume24hToken += tokenVolume;

    const t = Math.floor(sample.timestamp / CANDLE_SECONDS) * CANDLE_SECONDS;
    const candle = buckets.get(t);
    if (!candle) {
      buckets.set(t, { t, o: price, h: price, l: price, c: price, v: hypeVolume });
    } else {
      if (price > candle.h) candle.h = price;
      if (price < candle.l) candle.l = price;
      candle.c = price;
      candle.v += hypeVolume;
    }
  }

  // Close the latest active bucket at slot0 without inventing history when the
  // pool has never swapped. This also makes a single fresh claim visible.
  if (buckets.size > 0 && currentPrice > 0n) {
    const t = Math.floor(now / CANDLE_SECONDS) * CANDLE_SECONDS;
    const candle = buckets.get(t);
    if (!candle) buckets.set(t, { t, o: currentPrice, h: currentPrice, l: currentPrice, c: currentPrice, v: 0n });
    else {
      if (currentPrice > candle.h) candle.h = currentPrice;
      if (currentPrice < candle.l) candle.l = currentPrice;
      candle.c = currentPrice;
    }
  }

  const candles = [...buckets.values()].sort((a, b) => a.t - b.t);
  const firstPrice = candles[0]?.o;
  const change24hBps =
    firstPrice && firstPrice > 0n
      ? Number(((currentPrice - firstPrice) * 10_000n) / firstPrice)
      : undefined;

  return {
    candles,
    change24hBps,
    volume24hHype,
    volume24hToken,
    poolSwaps: recent.length,
  };
}
