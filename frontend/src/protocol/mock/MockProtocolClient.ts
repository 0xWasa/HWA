import type { ProtocolClient, ProtocolEvent } from "@/protocol/client";
import { ProtocolError } from "@/protocol/errors";
import type {
  AcquisitionQuote,
  ActivityQuery,
  Address,
  ListingsQuery,
  SettlementChoice,
  SwapQuote,
  SwapSide,
  TrackedTransaction,
} from "@/protocol/types";
import type { MockEngine } from "./engine";

/**
 * ProtocolClient over the in-memory MockEngine. Methods resolve on the next
 * microtask/small delay so loading states are observable, mirroring network
 * latencies without slowing development down.
 */
export class MockProtocolClient implements ProtocolClient {
  readonly kind = "mock" as const;

  constructor(private engine: MockEngine) {}

  private async lag<T>(value: T, ms = 120): Promise<T> {
    await new Promise((r) => setTimeout(r, ms + Math.random() * 80));
    return value;
  }

  getPoolSnapshot() {
    if (this.engine.world.scenario.rpcDown) {
      // Reads fall back to last-indexed data in this scenario; the snapshot is
      // still computable from the indexed world but flagged through health().
      return this.lag(this.engine.poolSnapshot(), 40);
    }
    return this.lag(this.engine.poolSnapshot(), 40);
  }

  getListings(query: ListingsQuery) {
    return this.lag(this.engine.queryListings(query));
  }

  getListing(id: bigint) {
    const l = this.engine.world.listings.get(id);
    return this.lag(l ? { ...l, nft: { ...l.nft } } : null, 60);
  }

  getActivity(query: ActivityQuery) {
    return this.lag(this.engine.queryActivity(query));
  }

  getUserPositions(account: Address) {
    return this.lag(this.engine.userPositions(account), 90);
  }

  getRewards(_account?: Address) {
    return this.lag(this.engine.rewards(), 70);
  }

  getOwnedEligibleNFTs(_account: Address) {
    return this.lag(
      this.engine.world.ownedNfts.map((n) => ({ ...n, nft: { ...n.nft } })),
      450, // wallet NFT scans are slow in real life; make the skeleton visible
    );
  }

  getCollections() {
    return this.lag(this.engine.world.collections.map((c) => ({ ...c })), 50);
  }

  getNativeBalance(_account: Address) {
    return this.lag(this.engine.balance(), 40);
  }

  getSettlementInfo(listingId: bigint) {
    return this.lag(this.engine.settlementInfo(listingId), 50);
  }

  getConnectionHealth() {
    return this.lag(this.engine.health(), 30);
  }

  getTokenMarket(_account?: Address) {
    return this.lag(this.engine.tokenMarket(), 120);
  }

  getPurchaseStats(account: Address) {
    return this.lag(this.engine.purchaseStats(account), 90);
  }

  async quoteSwap(input: { side: SwapSide; amountIn: bigint; slippageBps: number }) {
    return this.lag(this.engine.quoteSwap(input.side, input.amountIn, input.slippageBps), 120);
  }

  async swap(input: { quote: SwapQuote }) {
    return this.engine.swap(input.quote);
  }

  async quoteAcquisition(input: { quantity: number; driftToleranceBps: number }) {
    return this.lag(this.engine.quote(input.quantity, input.driftToleranceBps), 160);
  }

  // Writes are synchronous guard checks + async lifecycle inside the engine.
  async approveNFT(input: { collection: Address; tokenId: bigint }) {
    return this.engine.approveNFT(input.collection, input.tokenId);
  }
  async listNFT(input: { collection: Address; tokenId: bigint; backing: bigint }) {
    return this.engine.listNFT(input.collection, input.tokenId, input.backing);
  }
  async withdrawListing(input: { listingId: bigint }) {
    return this.engine.withdrawListing(input.listingId);
  }
  async acquire(input: { quote: AcquisitionQuote }) {
    return this.engine.acquire(input.quote);
  }
  async settle(input: { listingId: bigint; choice: SettlementChoice }) {
    return this.engine.settle(input.listingId, input.choice);
  }
  async recoverStuckNFT(input: { listingId: bigint }) {
    return this.engine.recoverStuckNFT(input.listingId);
  }
  async withdrawEarnings() {
    return this.engine.withdrawEarnings();
  }
  async withdrawAcquisitionRefund() {
    return this.engine.withdrawAcquisitionRefund();
  }
  async claimListingFees(input: { listingIds: bigint[] }) {
    return this.engine.claimListingFees(input.listingIds);
  }
  async claimCrown(input: { listingId: bigint }) {
    return this.engine.claimCrown(input.listingId);
  }
  async claimSplitterRevenue(_input: { tokenIds: bigint[] }): Promise<TrackedTransaction> {
    throw new ProtocolError("NOT_ELIGIBLE", "Snapshot-holder revenue is only exposed by a live deployment.");
  }
  async claimRewards(input: {
    epochs?: number[];
    listingIds?: bigint[];
    withdrawCredit?: boolean;
    claimAccruedMinOut?: bigint;
  }) {
    return this.engine.claimRewards(input.epochs, input.listingIds, input.withdrawCredit, input.claimAccruedMinOut);
  }

  getTrackedTransactions(): TrackedTransaction[] {
    // Clone: the engine mutates tx objects in place, and React Query's
    // structural sharing would otherwise see "unchanged" data and never
    // re-render phase transitions.
    return [...this.engine.world.txs.values()]
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((t) => ({ ...t, meta: { ...t.meta }, error: t.error ? { ...t.error } : undefined }));
  }

  resumeTracking(): void {
    // Engine resumes persisted txs/tickets in its constructor.
  }

  dismissTransaction(id: string): void {
    this.engine.dismissTx(id);
  }

  subscribe(listener: (event: ProtocolEvent) => void): () => void {
    return this.engine.subscribe(listener);
  }
}
