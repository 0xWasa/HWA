const Q192 = 1n << 192n;
const ONE_TOKEN = 10n ** 18n;

/**
 * Algebra's sqrtPriceX96 is sqrt(token1 raw units / token0 raw units) * 2^96.
 * HWA and wHYPE both use 18 decimals, so this returns HYPE wei per whole HWA.
 */
export function hypePerHwaFromSqrtPrice(sqrtPriceX96: bigint, hwaIsToken0: boolean): bigint | undefined {
  if (sqrtPriceX96 <= 0n) return undefined;
  const squared = sqrtPriceX96 * sqrtPriceX96;
  const price = hwaIsToken0 ? (squared * ONE_TOKEN) / Q192 : (Q192 * ONE_TOKEN) / squared;
  return price > 0n ? price : undefined;
}
