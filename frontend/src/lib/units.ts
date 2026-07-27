/**
 * HYPE money math. All on-chain values are bigint wei (18 decimals).
 * JavaScript floats are forbidden for anything that ends up in a transaction
 * or a displayed balance — formatting works on decimal strings only.
 */

export const WEI = 10n ** 18n;
export const BPS = 10_000n;

/** Format wei as a HYPE decimal string. Trims trailing zeros, keeps >= minDecimals. */
export function formatHype(
  wei: bigint,
  opts: { maxDecimals?: number; minDecimals?: number; sign?: boolean } = {},
): string {
  const { maxDecimals = 4, minDecimals = 0, sign = false } = opts;
  const neg = wei < 0n;
  const abs = neg ? -wei : wei;
  const whole = abs / WEI;
  const frac = abs % WEI;
  let fracStr = frac.toString().padStart(18, "0").slice(0, Math.max(maxDecimals, minDecimals));
  // Trim trailing zeros down to minDecimals
  while (fracStr.length > minDecimals && fracStr.endsWith("0")) {
    fracStr = fracStr.slice(0, -1);
  }
  const wholeStr = groupThousands(whole.toString());
  const core = fracStr.length > 0 ? `${wholeStr}.${fracStr}` : wholeStr;
  if (neg) return `-${core}`;
  return sign && wei > 0n ? `+${core}` : core;
}

/** Narrow no-break space — keeps grouped digits glued on line wraps. */
export const NNBSP = " ";

/** "1 234 567" grouping, terminal style. */
function groupThousands(s: string): string {
  return s.replace(/\B(?=(\d{3})+(?!\d))/g, NNBSP);
}

/** Parse a user-typed HYPE amount into wei. Returns null on invalid input. */
export function parseHype(input: string): bigint | null {
  // Accept every space flavor (plain, NBSP, NNBSP) so formatted values round-trip.
  const cleaned = input.trim().replace(/[\s  ]/g, "").replace(",", ".");
  if (cleaned === "" || cleaned === ".") return null;
  if (!/^\d*(\.\d*)?$/.test(cleaned)) return null;
  const [wholeRaw = "0", fracRaw = ""] = cleaned.split(".");
  if (fracRaw.length > 18) return null; // more precision than wei
  const whole = BigInt(wholeRaw === "" ? "0" : wholeRaw);
  const frac = BigInt((fracRaw + "0".repeat(18 - fracRaw.length)) || "0");
  return whole * WEI + frac;
}

/** Integer bps application: value * bps / 10_000, floor semantics like the contract. */
export function applyBps(value: bigint, bps: bigint): bigint {
  return (value * bps) / BPS;
}

/** Selection odds of one listing: weight / totalWeight, in parts-per-million. */
export function oddsPpm(weight: bigint, totalWeight: bigint): number {
  if (totalWeight <= 0n) return 0;
  return Number((weight * 1_000_000n) / totalWeight);
}

/** "1 in N" presentation of odds. */
export function oddsOneIn(weight: bigint, totalWeight: bigint): string {
  if (weight <= 0n || totalWeight <= 0n) return "—";
  const n = (totalWeight + weight - 1n) / weight;
  if (n > 1_000_000n) return ">1 in 1M";
  return `1 in ${groupThousands(n.toString())}`;
}

export function formatOddsPercent(weight: bigint, totalWeight: bigint): string {
  const ppm = oddsPpm(weight, totalWeight);
  if (ppm === 0) return "0%";
  if (ppm < 100) return "<0.01%";
  const pct = ppm / 10_000; // 1e6 ppm = 100%
  return `${pct >= 10 ? pct.toFixed(1) : pct.toFixed(2)}%`;
}

/** HWA reward token amounts (18 decimals as well). */
export function formatHwa(amount: bigint, maxDecimals = 2): string {
  return formatHype(amount, { maxDecimals });
}

/** On-chain listing weight (1e36 / backing wei). */
export const INVERSE_WEIGHT_NUMERATOR = 10n ** 36n;
export function weightFromBacking(backingWei: bigint): bigint {
  if (backingWei <= 0n) return 0n;
  return INVERSE_WEIGHT_NUMERATOR / backingWei;
}
