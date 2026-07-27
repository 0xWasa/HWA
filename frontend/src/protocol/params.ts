/**
 * FWA baseline protocol parameters, captured from the Ethereum deployment
 * (FWA_PARITY_MANIFEST.md §4). The mock engine and display fallbacks use
 * them; in testnet/mainnet mode every one of these is read on-chain and the
 * on-chain value always wins. Do not treat this file as configuration.
 */

import { WEI } from "@/lib/units";

export const FWA_PARAMS = {
  /** Acquisition surcharge over pool EV. */
  surchargeBps: 1_000,
  /** Default selection drift tolerance (positive cap & default negative). */
  defaultDriftBps: 1_000,
  /** Accept-bid payout to purchaser, share of backing. */
  bidPayoutBps: 8_500,
  /** Owner cut on acquisition fee distribution. */
  ownerAcquisitionFeeBps: 100,
  /** Owner cut on keep/relist settlement. */
  ownerSettlementFeeBps: 100,
  /** Purchaser-exclusive settlement window, seconds. */
  settlementWindowSec: 86_400,
  /** Permissionless finalization window, seconds. */
  finalizeWindowSec: 604_800,
  /** Crown (top deposit) share of distributed fees — live value 1%. */
  crownShareBps: 100,
  /** New crown must beat current backing by this margin. */
  crownThresholdBps: 1_000,
  minBacking: WEI / 100n, // 0.01 HYPE
  /** UI batch bound, mirrors the FWA frontend (1–5). */
  maxBatch: 5,
  /** Reward epoch gaps (hot/cold), seconds. */
  hotGapSec: 60,
  coldGapSec: 3_600,
  /** Minimum future-round buffer enforced by the production BN254 coordinator. */
  mainnetRandomnessSecurityBufferSec: 30,
  /** Historical authenticated-relay buffer used only by the value-less chain 998 harness. */
  testnetRandomnessSecurityBufferSec: 6,
} as const;

export function randomnessSecurityBufferSec(chainId: number): number {
  return chainId === 999
    ? FWA_PARAMS.mainnetRandomnessSecurityBufferSec
    : FWA_PARAMS.testnetRandomnessSecurityBufferSec;
}

/** Quote is presented as stale after this many ms without refresh. */
export const QUOTE_FRESH_MS = 20_000;
/** Quotes auto-refresh at this cadence while the acquire panel is visible. */
export const QUOTE_REFRESH_MS = 8_000;
