import type {
  AcquisitionQuote,
  ActivityItem,
  ActivityQuery,
  Address,
  CollectionInfo,
  ConnectionHealth,
  Listing,
  ListingsQuery,
  OwnedNFT,
  Page,
  PoolSnapshot,
  PurchaseStats,
  RewardsSnapshot,
  SettlementChoice,
  SettlementInfo,
  SwapQuote,
  SwapSide,
  TokenMarket,
  TrackedTransaction,
  UserPositions,
} from "./types";

/**
 * The protocol boundary. Components and hooks depend on this interface only;
 * implementations are swapped by configuration, never by editing components.
 *
 *  - MockProtocolClient  — full in-memory simulation for development/tests
 *  - ViemProtocolClient  — HyperEVM testnet/mainnet through wagmi/viem +
 *                          indexer, gated on the deployment manifest
 *
 * Read-path rule: exploratory/history data may come from the indexer, but
 * anything a transaction depends on (quotes, balances, position state,
 * allowance) is revalidated directly on-chain right before signing.
 */
export interface ProtocolClient {
  readonly kind: "mock" | "viem";

  // ---- reads -----------------------------------------------------------
  getPoolSnapshot(): Promise<PoolSnapshot>;
  getListings(query: ListingsQuery): Promise<Page<Listing>>;
  getListing(id: bigint): Promise<Listing | null>;
  getActivity(query: ActivityQuery): Promise<Page<ActivityItem>>;
  getUserPositions(account: Address): Promise<UserPositions>;
  getRewards(account?: Address): Promise<RewardsSnapshot>;
  getOwnedEligibleNFTs(account: Address): Promise<OwnedNFT[]>;
  getCollections(): Promise<CollectionInfo[]>;
  getNativeBalance(account: Address): Promise<bigint>;
  getSettlementInfo(listingId: bigint): Promise<SettlementInfo | null>;
  getConnectionHealth(): Promise<ConnectionHealth>;
  /** $HWA market data for the token screen (chart + swap). */
  getTokenMarket(account?: Address): Promise<TokenMarket>;
  /** Purchase-side analytics for the acquisitions screen. */
  getPurchaseStats(account: Address): Promise<PurchaseStats>;

  // ---- quoting (on-chain, pre-transaction) -----------------------------
  quoteAcquisition(input: { quantity: number; driftToleranceBps: number }): Promise<AcquisitionQuote>;
  quoteSwap(input: { side: SwapSide; amountIn: bigint; slippageBps: number }): Promise<SwapQuote>;

  // ---- writes ----------------------------------------------------------
  approveNFT(input: { collection: Address; tokenId: bigint }): Promise<TrackedTransaction>;
  listNFT(input: { collection: Address; tokenId: bigint; backing: bigint }): Promise<TrackedTransaction>;
  withdrawListing(input: { listingId: bigint }): Promise<TrackedTransaction>;
  acquire(input: { quote: AcquisitionQuote }): Promise<TrackedTransaction>;
  settle(input: { listingId: bigint; choice: SettlementChoice }): Promise<TrackedTransaction>;
  recoverStuckNFT(input: { listingId: bigint }): Promise<TrackedTransaction>;
  withdrawEarnings(): Promise<TrackedTransaction>;
  withdrawAcquisitionRefund(): Promise<TrackedTransaction>;
  claimListingFees(input: { listingIds: bigint[] }): Promise<TrackedTransaction>;
  claimCrown(input: { listingId: bigint }): Promise<TrackedTransaction>;
  claimSplitterRevenue(input: { tokenIds: bigint[] }): Promise<TrackedTransaction>;
  claimRewards(input: {
    epochs?: number[];
    listingIds?: bigint[];
    withdrawCredit?: boolean;
    claimAccruedMinOut?: bigint;
  }): Promise<TrackedTransaction>;
  swap(input: { quote: SwapQuote }): Promise<TrackedTransaction>;

  // ---- transaction tracking -------------------------------------------
  getTrackedTransactions(): TrackedTransaction[];
  /** Re-attach watchers to persisted pending txs after a page reload. */
  resumeTracking(): void;
  dismissTransaction(id: string): void;

  // ---- change notification --------------------------------------------
  subscribe(listener: (event: ProtocolEvent) => void): () => void;
}

export type ProtocolEvent =
  | { scope: "tx"; txId: string }
  | { scope: "pool" }
  | { scope: "listings" }
  | { scope: "positions" }
  | { scope: "activity" }
  | { scope: "rewards" }
  | { scope: "health" }
  | { scope: "wallet" };
