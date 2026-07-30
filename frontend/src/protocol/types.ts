/**
 * Domain types of the FWA/HyperEVM frontend.
 *
 * These are business types, deliberately decoupled from raw ABI tuples: the
 * Viem/indexer adapters translate on-chain data into this shape at the edge.
 * All native amounts are bigint wei of HYPE (18 decimals). Basis points are
 * plain integers. Timestamps are unix seconds.
 *
 * On-chain vocabulary is preserved from the Ethereum reference
 * (FWA_ETHEREUM_REFERENCE/FWA/sources/src/FWA.sol):
 *   ListingStatus  { None, Active, Allocated, Withdrawn, Settled, Staged }
 *   AcquisitionStatus { None, Pending, Fulfilled, Expired, Refunded, Ready, TimedOut }
 */

export type Address = `0x${string}`;
export type Hex = `0x${string}`;

// ---------------------------------------------------------------- listings

export type ListingStatus = "staged" | "active" | "allocated" | "withdrawn" | "settled";

/** Frontend-derived rarity band from current selection odds (docs: “the
 *  highest-backed positions are the rarest”). Display-only — never used in
 *  transaction parameters. Exact FWA class mapping: see INTEGRATION_NEEDS.md. */
export type RarityTier = "common" | "uncommon" | "rare" | "epic" | "grail";

export interface CollectionInfo {
  address: Address;
  /** Untrusted metadata — render as text only. */
  name: string;
  symbol?: string;
  whitelisted: boolean;
}

export type SettlementOutcome =
  | "kept" // purchaser kept the NFT
  | "relisted" // purchaser kept + relisted atomically
  | "bid_accepted" // purchaser sold back for HYPE (85% of backing)
  | "bid_accepted_tokens" // same sale settled as HWA tokens
  | "depositor_reclaim_nft" // depositor resolved after the 24h window
  | "depositor_reclaim_backing"
  | "finalized"; // permissionless default outcome after 7d

export interface Listing {
  id: bigint;
  status: ListingStatus;
  collection: Address;
  tokenId: bigint;
  depositor: Address;
  /** Set once allocated. */
  purchaser?: Address;
  /** Committed HYPE backing (funds the depositor's standing bid). */
  backing: bigint;
  /** Selection weight = 1e36 / backing. */
  weight: bigint;
  /** Unix seconds. Staged/listed time from the indexer. */
  listedAt: number;
  /** Set when allocated; opens the settlement windows. */
  allocatedAt?: number;
  /** All-in price the purchaser paid for the acquisition that took it. */
  acquiredFor?: bigint;
  /** Current top deposit (crown) holder. */
  isCrown: boolean;
  /** Accrued, claimable fee earnings attached to this listing (pendingFees). */
  pendingFees: bigint;
  /** If NFT delivery failed at settlement, who may retry recovery. */
  stuckRecipient?: Address;
  settlement?: SettlementOutcome;
  /** Untrusted NFT metadata (indexer-resolved). */
  nft: NFTMetadata;
}

export interface NFTMetadata {
  name?: string;
  imageUrl?: string;
  collectionName?: string;
  collectionSymbol?: string;
}

// ------------------------------------------------------------ pool snapshot

export interface CrownState {
  listingId: bigint;
  pot: bigint;
  shareBps: number; // current tithe on distributed fees (1% live value)
  thresholdBps: number; // new crown must beat backing by this (10%)
}

export interface PoolSnapshot {
  chainId: number;
  blockNumber: bigint;
  /** Unix seconds of the snapshot. */
  timestamp: number;
  activeListingCount: number;
  stagedListingCount: number;
  /** Sum of active backing — headline stat. */
  totalBacking: bigint;
  totalWeight: bigint;
  weightedBackingTotal: bigint;
  /** Pool component of the price: EV × (1 + surcharge). */
  acquisitionFee: bigint;
  /** Randomness service component, paid on top. */
  serviceFee: bigint;
  /** acquisitionFee + serviceFee. */
  totalPrice: bigint;
  surchargeBps: number;
  /** Protocol default drift tolerance (selectionSlippageBps), FWA baseline 10%. */
  defaultDriftBps: number;
  minBacking: bigint;
  maxBatch: number;
  settlementWindowSec: number;
  finalizeWindowSec: number;
  bidPayoutBps: number;
  acquisitionsEnabled: boolean;
  pendingAcquisitions: number;
  crown?: CrownState;
}

// ------------------------------------------------------------- acquisitions

export type AcquisitionPhase =
  | "requested" // tx confirmed, sequence assigned
  | "randomness_pending" // waiting for the provider word
  | "randomness_cached" // word arrived, waiting for ordered processing
  | "processing"
  | "allocated" // NFT position assigned
  | "expired" // word missed its deadline → refund credited
  | "refunded" // empty pool / drift out of tolerance → refund credited
  | "timed_out"; // late callback; skipped at head of queue

export interface AcquisitionTicket {
  requestId: bigint;
  sequence: bigint;
  purchaser: Address;
  feePaid: bigint;
  serviceFeePaid: bigint;
  requestedAt: number;
  /** EVM block that emitted the request. Used only for honest progress UI. */
  requestBlock?: bigint;
  txHash?: Hex;
  /** Block by which the randomness word must arrive before expiry. */
  wordDeadlineBlock?: bigint;
  phase: AcquisitionPhase;
  /** Present once allocated. */
  listingId?: bigint;
  /** Credited refund (withdrawable via withdrawAcquisitionRefund). */
  refund?: bigint;
}

// --------------------------------------------------------------- settlement

/** Purchaser-exclusive window (24h), then depositor, then anyone (7d). */
export interface SettlementInfo {
  listingId: bigint;
  allocatedAt: number;
  purchaserWindowEndsAt: number;
  finalizeOpensAt: number;
  /** Payout share of backing on accept-bid (8 500 bps → purchaser gets 85%). */
  bidPayoutBps: number;
  bidPayout: bigint;
  /** Backing minus the 1% owner settlement cut. */
  netBackingToDepositor: bigint;
}

export type SettlementChoice =
  | { kind: "keep" }
  | { kind: "relist"; newBacking: bigint }
  | { kind: "acceptBidHype" }
  | { kind: "acceptBidTokens"; minTokensOut: bigint }
  | { kind: "depositorReclaimNft" }
  | { kind: "depositorReclaimBacking" }
  | { kind: "finalize" };

// ------------------------------------------------------------------- users

export interface ClaimableBalances {
  /** Fee earnings + settled backing, withdrawEarnings(). */
  earnings: bigint;
  /** Refunds from expired/refunded acquisitions, withdrawAcquisitionRefund(). */
  acquisitionRefund: bigint;
  /** Per-listing fee accruals claimable without closing the listing. */
  listingFees: { listingId: bigint; amount: bigint }[];
  /** Crown pot claimable via claimTopSpot when user holds the crown. */
  crownPot: bigint;
}

export interface UserPositions {
  account: Address;
  /** Listings the user deposited that are staged or active. */
  deposited: Listing[];
  /** Listings allocated to the user awaiting their settlement choice. */
  allocated: Listing[];
  /** User's deposits currently allocated to another purchaser (depositor-side
   *  settlement surface: reclaim after 24h, finalize after 7d). */
  depositedAllocated: Listing[];
  /** In-flight or unsettled acquisition requests. */
  pendingAcquisitions: AcquisitionTicket[];
  /** Historical outcomes involving the user (either side). */
  settled: Listing[];
  /** Listings with failed NFT delivery the user can retry. */
  stuck: Listing[];
  claimable: ClaimableBalances;
}

// ----------------------------------------------------------------- rewards

export interface RewardsSnapshot {
  /** False until the HWA token/rewards module is deployed. */
  moduleActive: boolean;
  tokenSymbol: "HWA";
  tokenAddress?: Address;
  emission?: {
    startedAt: number;
    endsAt: number;
    currentSeason: number;
    currentEpoch: number;
    claimsEnabled: boolean;
    configured: boolean;
    /** Wei of HWA emitted per second across all active deposits. Set once at
     *  configuration and immutable afterwards, but read rather than assumed. */
    depositorRatePerSec: bigint;
    reserveRemaining: bigint;
    emitted: bigint;
    burned: bigint;
    depositorEmitted: bigint;
    purchaserEmitted: bigint;
    effectiveQuoteX96: bigint;
    valueCapBps: number;
    seasons: Array<{ season: number; startsAt: number; endsAt: number; maxBudget: bigint }>;
  };
  buyback?: {
    depositorRouted: bigint;
    purchaserRouted: bigint;
  };
  epoch?: {
    current: number;
    /** hot = last acquisition < hotGap ago. */
    mode: "hot" | "cold";
    hotGapSec: number;
    coldGapSec: number;
    lastAcquisitionAt: number;
  };
  /** Project X V3 route used by buy-side settlements (1% tier). */
  swapRoute?: { dex: "Project X"; feeTierBps: number; pool?: Address };
  user?: {
    depositorPending: bigint;
    depositorCredit: bigint;
    purchaserClaimable: bigint;
    /** HYPE allowance committed to an on-chain HWA purchase on claim. */
    purchaserBuyAllowanceHype: bigint;
    /** Lifetime claimed amount when the active data source exposes it. */
    claimed?: bigint;
    claimableEpochs: number[];
  };
  /** FWA-style native-revenue split reserved for holders of the immutable snapshot NFT. */
  holderRevenue?: {
    splitterAddress: Address;
    snapshotNft: Address;
    snapshotSupply: number;
    maxTokenId: bigint;
    nftShareBps: number;
    claimablePerToken: bigint;
    sweepAvailableAt?: number;
    claimsClosed: boolean;
    splitFrozen: boolean;
    user?: {
      ownedTokenIds: bigint[];
      pendingHype: bigint;
    };
  };
}

// ---------------------------------------------------------------- activity

export type ActivityType =
  | "deposit"
  | "activation"
  | "withdraw_listing"
  | "backing_update"
  | "acquisition_request"
  | "randomness_cached"
  | "allocation"
  | "keep"
  | "relist"
  | "bid_accepted"
  | "bid_accepted_tokens"
  | "depositor_resolved"
  | "finalized"
  | "acquisition_refund"
  | "earnings_withdraw"
  | "earnings_accrued"
  | "reward_claim"
  | "crown_set"
  | "crown_funded"
  | "crown_settled"
  | "config_set"
  | "collection_whitelist"
  | "fees_paid_out"
  | "protocol_fees_to_token"
  | "delivery_failed"
  | "stuck_recovered";

export interface ActivityItem {
  id: string;
  type: ActivityType;
  txHash: Hex;
  blockNumber: bigint;
  timestamp: number;
  /** Primary actor. */
  address?: Address;
  listingId?: bigint;
  collection?: Address;
  tokenId?: bigint;
  /** HYPE amount when meaningful (backing, payout, refund…). */
  amount?: bigint;
  /** HWA token amount when meaningful. */
  tokenAmount?: bigint;
  /**
   * indexed  → seen by the indexer, could still lag or reorg;
   * confirmed → cross-checked against on-chain head.
   * The UI never presents "indexed" as final.
   */
  finality: "indexed" | "confirmed";
}

// ------------------------------------------------------------------ quotes

export interface AcquisitionQuote {
  quantity: number;
  poolFeePerItem: bigint;
  serviceFeePerItem: bigint;
  totalPerItem: bigint;
  total: bigint;
  /** maxAcquisitionFee guard sent with the tx (per item), from drift tolerance. */
  maxAcquisitionFeePerItem: bigint;
  driftToleranceBps: number;
  /** minWeightedValue guard against pool draining below expectation. */
  minWeightedValue: bigint;
  quotedAt: number;
  blockNumber: bigint;
}

// ------------------------------------------------------------ transactions

export type TxPhase =
  | "review" // client-side, before wallet prompt
  | "wallet" // waiting for wallet confirmation
  | "submitted" // in mempool
  | "confirming" // seen on-chain, waiting confirmations
  | "indexed" // indexer picked the events up
  | "completed"
  | "rejected" // user rejected in wallet
  | "reverted"
  | "replaced" // speed-up/cancel replaced the hash
  | "timeout"; // stale — outcome unknown, retryable

export type TxKind =
  | "approve_nft"
  | "list_nft"
  | "update_backing"
  | "withdraw_listing"
  | "acquire"
  | "settle_keep"
  | "settle_relist"
  | "settle_accept_bid"
  | "settle_accept_bid_tokens"
  | "depositor_reclaim"
  | "finalize"
  | "recover_stuck_nft"
  | "withdraw_earnings"
  | "withdraw_refund"
  | "claim_listing_fees"
  | "claim_crown"
  | "claim_splitter"
  | "claim_rewards"
  | "swap";

export interface TrackedTransaction {
  /** Client-generated id, stable across refreshes. */
  id: string;
  kind: TxKind;
  label: string;
  phase: TxPhase;
  hash?: Hex;
  createdAt: number;
  updatedAt: number;
  /** Human-readable, decoded failure when phase is rejected/reverted/timeout. */
  error?: { title: string; detail?: string; raw?: string };
  /** Public context for resume-after-refresh (listingId, quantity…). Strings only. */
  meta: Record<string, string>;
}


// ------------------------------------------------------------ token market

/** OHLC candle; all values are HYPE wei per 1 HWA. */
export interface Candle {
  /** Bucket start, unix seconds. */
  t: number;
  o: bigint;
  h: bigint;
  l: bigint;
  c: bigint;
  /** Volume over the bucket, HYPE wei. */
  v: bigint;
}

export interface TokenMarket {
  /** False until the token/rewards module is deployed. */
  moduleActive: boolean;
  symbol: "HWA";
  tokenAddress?: Address;
  /** HYPE wei per 1 HWA. */
  price?: bigint;
  change24hBps?: number;
  marketCapHype?: bigint;
  volume24hHype?: bigint;
  volume24hToken?: bigint;
  poolSwaps?: number;
  poolAddress?: Address;
  dex?: "Project X";
  feeTierBps?: number;
  /** Owner-controlled HWA transfer gate for public pool buys. */
  externalBuysEnabled?: boolean;
  /** Reviewed Project X UI route. Public trading is external; protocol buybacks use the adapter. */
  externalTradeUrl?: string;
  candles?: Candle[];
  user?: { hypeBalance: bigint; tokenBalance: bigint };
}

export type SwapSide = "buy" | "sell";

export interface SwapQuote {
  side: SwapSide;
  /** HYPE wei when buying, HWA wei when selling. */
  amountIn: bigint;
  /** HWA wei when buying, HYPE wei when selling. */
  amountOut: bigint;
  minOut: bigint;
  slippageBps: number;
  priceImpactBps: number;
  feeBps: number;
  quotedAt: number;
}

// ------------------------------------------------------- purchase analytics

export interface PurchaseRecord {
  requestId: bigint;
  timestamp: number;
  txHash?: Hex;
  /** Pool fee + randomness service actually paid. */
  allInPaid: bigint;
  listingId?: bigint;
  /** Backing of the position received (0 when refunded/expired). */
  backingReceived: bigint;
  outcome: SettlementOutcome | "allocated" | "refunded" | "pending";
  nft?: NFTMetadata;
}

export interface PurchaseStats {
  purchases: number;
  /** Mean all-in price across settled purchases. */
  avgAllInPrice: bigint;
  allInSpend: bigint;
  /** Signed: value received (backing) minus all-in spend. */
  netListingPL: bigint;
  history: PurchaseRecord[];
}

// ------------------------------------------------------------------- misc

export interface OwnedNFT {
  collection: Address;
  tokenId: bigint;
  whitelisted: boolean;
  /** Approval state towards the FWA custody contract. */
  approved: boolean;
  nft: NFTMetadata;
}

export interface IndexerHealth {
  status: "ok" | "lagging" | "down";
  /** Blocks behind chain head (0 when ok). */
  lagBlocks: number;
  /** Head the indexer has processed. */
  indexedBlock: bigint;
  chainBlock: bigint;
}

export interface ConnectionHealth {
  rpc: "ok" | "degraded" | "down";
  indexer: IndexerHealth;
}

export interface ListingsQuery {
  view: "pool" | "recent" | "top" | "deposits";
  search?: string;
  collections?: Address[];
  rarities?: RarityTier[];
  statuses?: ListingStatus[];
  sort: "value" | "date" | "name" | "odds";
  direction: "asc" | "desc";
  cursor?: string;
  limit: number;
  /** Skip display-only token metadata for large telemetry/distribution reads. */
  includeMetadata?: boolean;
}

export interface ActivityQuery {
  scope: "global" | "user";
  account?: Address;
  types?: ActivityType[];
  collections?: Address[];
  cursor?: string;
  limit: number;
}

export interface Page<T> {
  items: T[];
  nextCursor?: string;
  total: number;
}
