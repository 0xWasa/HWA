import { applyBps, weightFromBacking, WEI } from "@/lib/units";
import { ProtocolError } from "@/protocol/errors";
import { FWA_PARAMS } from "@/protocol/params";
import { rarityFromOdds } from "@/protocol/rarity";
import type {
  AcquisitionQuote,
  AcquisitionTicket,
  ActivityItem,
  Candle,
  ActivityQuery,
  ActivityType,
  Address,
  ConnectionHealth,
  Hex,
  Listing,
  ListingsQuery,
  Page,
  PoolSnapshot,
  PurchaseRecord,
  PurchaseStats,
  RewardsSnapshot,
  SettlementChoice,
  SettlementInfo,
  SwapQuote,
  SwapSide,
  TokenMarket,
  TrackedTransaction,
  TxKind,
  TxPhase,
  UserPositions,
} from "@/protocol/types";
import type { ProtocolEvent } from "@/protocol/client";
import { buildWorld, fakeTxHash, INITIAL_CROWN_POT, MOCK_USER, actorAt, type World } from "./fixtures";
import { nftArtDataUri } from "./nftArt";
import type { ScenarioConfig } from "./scenarios";

/**
 * MockEngine — a small in-memory world that behaves like the protocol from
 * the UI's point of view: staged→active listings, ordered acquisitions with
 * randomness delays, settlement windows, refunds, claimables, ambient
 * third-party activity and full transaction lifecycles (including rejects,
 * reverts and resume-after-reload).
 *
 * Simplifications vs. the contracts are intentional and documented in
 * INTEGRATION_NEEDS.md (e.g. staged reservations are not simulated).
 */
export class MockEngine {
  readonly world: World;
  private listeners = new Set<(e: ProtocolEvent) => void>();
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private ambient?: ReturnType<typeof setInterval>;
  private crownPot: bigint;
  private txSeq = 0;

  constructor(scenario: ScenarioConfig) {
    this.world = buildWorld(scenario, nowSec());
    this.crownPot = this.world.scenario.emptyPool ? 0n : INITIAL_CROWN_POT;
    this.resumeTracking();
    this.startAmbient();
  }

  destroy(): void {
    for (const t of this.timers) clearTimeout(t);
    if (this.ambient) clearInterval(this.ambient);
    this.listeners.clear();
  }

  // ------------------------------------------------------------ plumbing

  subscribe(cb: (e: ProtocolEvent) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private emit(...events: ProtocolEvent[]): void {
    for (const e of events) for (const l of this.listeners) l(e);
  }

  private after(ms: number, fn: () => void): void {
    const t = setTimeout(() => {
      this.timers.delete(t);
      fn();
    }, ms);
    this.timers.add(t);
  }

  blockNow(): bigint {
    return this.world.baseBlock + BigInt(Math.max(0, nowSec() - this.world.bootSec));
  }

  // -------------------------------------------------------------- wallet

  connectWallet(): void {
    if (this.world.wallet.status === "connected") return;
    this.world.wallet.status = "connecting";
    this.emit({ scope: "wallet" });
    this.after(650, () => {
      this.world.wallet.status = "connected";
      this.emit({ scope: "wallet" }, { scope: "positions" });
    });
  }

  disconnectWallet(): void {
    this.world.wallet.status = "disconnected";
    this.emit({ scope: "wallet" });
  }

  /** Resolves true if the wallet accepted the network switch. */
  switchNetwork(target: number): Promise<boolean> {
    return new Promise((resolve) => {
      this.after(700, () => {
        if (this.world.scenario.refuseSwitch) {
          resolve(false);
          return;
        }
        this.world.wallet.chainId = target;
        this.emit({ scope: "wallet" });
        resolve(true);
      });
    });
  }

  setDevFlag(flag: "rejectNextWallet" | "revertNextTx", value: boolean): void {
    this.world.devFlags[flag] = value;
  }

  // ------------------------------------------------------------- queries

  activeListings(): Listing[] {
    return [...this.world.listings.values()].filter((l) => l.status === "active");
  }

  poolSnapshot(): PoolSnapshot {
    const active = this.activeListings();
    const staged = [...this.world.listings.values()].filter((l) => l.status === "staged");
    let totalBacking = 0n;
    let totalWeight = 0n;
    let weightedBackingTotal = 0n;
    for (const l of active) {
      totalBacking += l.backing;
      totalWeight += l.weight;
      weightedBackingTotal += l.backing * l.weight;
    }
    const ev = totalWeight > 0n ? weightedBackingTotal / totalWeight : 0n;
    const acquisitionFee = applyBps(ev, BigInt(10_000 + FWA_PARAMS.surchargeBps));
    const serviceFee = this.world.serviceFee;
    const crown = active.find((l) => l.isCrown);
    const pending = [...this.world.tickets.values()].filter((t) =>
      ["requested", "randomness_pending", "randomness_cached", "processing"].includes(t.phase),
    ).length;
    return {
      chainId: this.world.chainId,
      blockNumber: this.blockNow(),
      timestamp: nowSec(),
      activeListingCount: active.length,
      stagedListingCount: staged.length,
      totalBacking,
      totalWeight,
      weightedBackingTotal,
      acquisitionFee,
      serviceFee,
      totalPrice: acquisitionFee + serviceFee,
      surchargeBps: FWA_PARAMS.surchargeBps,
      defaultDriftBps: FWA_PARAMS.defaultDriftBps,
      minBacking: FWA_PARAMS.minBacking,
      maxBatch: FWA_PARAMS.maxBatch,
      settlementWindowSec: FWA_PARAMS.settlementWindowSec,
      finalizeWindowSec: FWA_PARAMS.finalizeWindowSec,
      bidPayoutBps: FWA_PARAMS.bidPayoutBps,
      acquisitionsEnabled: this.world.acquisitionsEnabled && active.length > 0,
      pendingAcquisitions: pending,
      crown: crown
        ? {
            listingId: crown.id,
            pot: this.crownPot,
            shareBps: FWA_PARAMS.crownShareBps,
            thresholdBps: FWA_PARAMS.crownThresholdBps,
          }
        : undefined,
    };
  }

  queryListings(q: ListingsQuery): Page<Listing> {
    const snap = this.poolSnapshot();
    let items = [...this.world.listings.values()];

    switch (q.view) {
      case "pool":
        items = items.filter((l) => l.status === "active");
        break;
      case "deposits":
        items = items.filter((l) => l.status === "active" || l.status === "staged");
        break;
      case "top":
        items = items.filter((l) => l.status === "active");
        break;
      case "recent":
        items = items.filter((l) => l.status !== "withdrawn");
        break;
    }
    if (q.statuses?.length) items = items.filter((l) => q.statuses!.includes(l.status));
    if (q.collections?.length) items = items.filter((l) => q.collections!.includes(l.collection));
    if (q.rarities?.length) {
      items = items.filter((l) => q.rarities!.includes(rarityFromOdds(l.weight, snap.totalWeight)));
    }
    if (q.search) {
      const s = q.search.toLowerCase();
      items = items.filter(
        (l) =>
          l.nft.name?.toLowerCase().includes(s) ||
          l.nft.collectionName?.toLowerCase().includes(s) ||
          l.id.toString() === s.replace(/^#/, "") ||
          l.tokenId.toString() === s.replace(/^#/, ""),
      );
    }

    const dir = q.direction === "asc" ? 1 : -1;
    const byName = (a: Listing, b: Listing) => (a.nft.name ?? "").localeCompare(b.nft.name ?? "") * dir;
    items.sort((a, b) => {
      switch (q.sort) {
        case "value":
          return a.backing === b.backing ? 0 : a.backing > b.backing ? dir : -dir;
        case "odds":
          return a.weight === b.weight ? 0 : a.weight > b.weight ? dir : -dir;
        case "name":
          return byName(a, b);
        case "date":
        default:
          return (a.listedAt - b.listedAt) * dir;
      }
    });
    if (q.view === "top") {
      items.sort((a, b) => (a.backing === b.backing ? 0 : a.backing > b.backing ? -1 : 1));
    }
    if (q.view === "recent") {
      // Purchase feed sorts on allocation time; the listing feed on listing time.
      items.sort((a, b) => (b.allocatedAt ?? b.listedAt) - (a.allocatedAt ?? a.listedAt));
    }

    const start = q.cursor ? Number.parseInt(q.cursor, 10) : 0;
    const slice = items.slice(start, start + q.limit);
    return {
      items: slice.map(cloneListing),
      nextCursor: start + q.limit < items.length ? String(start + q.limit) : undefined,
      total: items.length,
    };
  }

  queryActivity(q: ActivityQuery): Page<ActivityItem> {
    let items = [...this.world.activity];
    if (q.scope === "user" && q.account) {
      const acc = q.account.toLowerCase();
      items = items.filter((a) => a.address?.toLowerCase() === acc);
    }
    if (q.types?.length) items = items.filter((a) => q.types!.includes(a.type));
    if (q.collections?.length) {
      items = items.filter((a) => {
        const listing = a.listingId ? this.world.listings.get(a.listingId) : undefined;
        const col = a.collection ?? listing?.collection;
        return col ? q.collections!.includes(col) : false;
      });
    }
    items.sort((a, b) => b.timestamp - a.timestamp);
    const start = q.cursor ? Number.parseInt(q.cursor, 10) : 0;
    const slice = items.slice(start, start + q.limit);
    return {
      // Clone: finality flips in place ("indexed" → "confirmed") and cached
      // references would otherwise never re-render.
      items: slice.map((a) => ({ ...a })),
      nextCursor: start + q.limit < items.length ? String(start + q.limit) : undefined,
      total: items.length,
    };
  }

  userPositions(account: Address): UserPositions {
    const acc = account.toLowerCase();
    const all = [...this.world.listings.values()];
    const deposited = all.filter(
      (l) => l.depositor.toLowerCase() === acc && (l.status === "active" || l.status === "staged"),
    );
    const allocated = all.filter((l) => l.status === "allocated" && l.purchaser?.toLowerCase() === acc);
    const depositedAllocated = all.filter(
      (l) => l.status === "allocated" && l.depositor.toLowerCase() === acc && l.purchaser?.toLowerCase() !== acc,
    );
    const settled = all.filter(
      (l) =>
        l.status === "settled" &&
        (l.depositor.toLowerCase() === acc || l.purchaser?.toLowerCase() === acc) &&
        !l.stuckRecipient,
    );
    const stuck = all.filter((l) => l.stuckRecipient?.toLowerCase() === acc);
    const pendingAcquisitions = [...this.world.tickets.values()]
      .filter((t) => t.purchaser.toLowerCase() === acc)
      .sort((a, b) => b.requestedAt - a.requestedAt);
    const crownListing = all.find((l) => l.isCrown && l.depositor.toLowerCase() === acc);
    return {
      account,
      deposited: deposited.map(cloneListing),
      allocated: allocated.map(cloneListing),
      depositedAllocated: depositedAllocated.map(cloneListing),
      pendingAcquisitions: pendingAcquisitions.map((t) => ({ ...t })),
      settled: settled.map(cloneListing),
      stuck: stuck.map(cloneListing),
      claimable: {
        earnings: this.world.claimable.earnings,
        acquisitionRefund: this.world.claimable.acquisitionRefund,
        listingFees: deposited
          .filter((l) => l.pendingFees > 0n)
          .map((l) => ({ listingId: l.id, amount: l.pendingFees })),
        crownPot: crownListing ? this.crownPot : 0n,
      },
    };
  }

  rewards(): RewardsSnapshot {
    const s = this.world.scenario;
    if (!s.rewardsActive) {
      return { moduleActive: false, tokenSymbol: "HWA" };
    }
    const started = this.world.bootSec - 3 * 86_400;
    const lastAcq = this.world.bootSec - 40; // hot at boot
    return {
      moduleActive: true,
      tokenSymbol: "HWA",
      tokenAddress: "0xf0a000000000000000000000000000000000f0a0",
      emission: {
        startedAt: started,
        endsAt: started + 45 * 86_400,
        currentSeason: 1,
        currentEpoch: 3,
        claimsEnabled: false,
        configured: true,
        // 10M HWA a day, the same shape the mainnet module was configured with.
        depositorRatePerSec: (10_000_000n * WEI) / 86_400n,
        reserveRemaining: 96_000_000n * WEI,
        emitted: 4_000_000n * WEI,
        burned: 1_000_000n * WEI,
        depositorEmitted: 2_000_000n * WEI,
        purchaserEmitted: 2_000_000n * WEI,
        effectiveQuoteX96: 1n << 96n,
        valueCapBps: 500,
        seasons: [
          { season: 1, startsAt: started, endsAt: started + 15 * 86_400, maxBudget: 50_000_000n * WEI },
          { season: 2, startsAt: started + 15 * 86_400, endsAt: started + 30 * 86_400, maxBudget: 30_000_000n * WEI },
          { season: 3, startsAt: started + 30 * 86_400, endsAt: started + 45 * 86_400, maxBudget: 20_000_000n * WEI },
        ],
      },
      buyback: { depositorRouted: 140_000n * WEI, purchaserRouted: 140_000n * WEI },
      epoch: {
        current: 3,
        mode: nowSec() - lastAcq < FWA_PARAMS.hotGapSec ? "hot" : "cold",
        hotGapSec: FWA_PARAMS.hotGapSec,
        coldGapSec: FWA_PARAMS.coldGapSec,
        lastAcquisitionAt: lastAcq,
      },
      swapRoute: { dex: "Project X", feeTierBps: 100, pool: "0x9001000000000000000000000000000000009001" },
      user: {
        depositorPending: this.world.rewardsUser.depositorPending,
        depositorCredit: this.world.rewardsUser.depositorCredit,
        purchaserClaimable: this.world.rewardsUser.purchaserClaimable,
        purchaserBuyAllowanceHype: this.world.rewardsUser.purchaserBuyAllowanceHype,
        claimed: this.world.rewardsUser.claimed,
        claimableEpochs: [...this.world.rewardsUser.claimableEpochs],
      },
    };
  }

  health(): ConnectionHealth {
    const s = this.world.scenario;
    const head = this.blockNow();
    const lag = BigInt(s.indexerLagBlocks);
    return {
      rpc: s.rpcDown ? "down" : "ok",
      indexer: {
        status: s.indexerLagBlocks > 0 ? "lagging" : "ok",
        lagBlocks: s.indexerLagBlocks,
        indexedBlock: head - lag,
        chainBlock: head,
      },
    };
  }

  settlementInfo(listingId: bigint): SettlementInfo | null {
    const l = this.world.listings.get(listingId);
    if (!l || l.status !== "allocated" || l.allocatedAt === undefined) return null;
    return {
      listingId,
      allocatedAt: l.allocatedAt,
      purchaserWindowEndsAt: l.allocatedAt + FWA_PARAMS.settlementWindowSec,
      finalizeOpensAt: l.allocatedAt + FWA_PARAMS.finalizeWindowSec,
      bidPayoutBps: FWA_PARAMS.bidPayoutBps,
      bidPayout: applyBps(l.backing, BigInt(FWA_PARAMS.bidPayoutBps)),
      netBackingToDepositor: l.backing - applyBps(l.backing, BigInt(FWA_PARAMS.ownerSettlementFeeBps)),
    };
  }

  quote(quantity: number, driftToleranceBps: number): AcquisitionQuote {
    this.assertRpcUp();
    const snap = this.poolSnapshot();
    if (!snap.acquisitionsEnabled) {
      throw new ProtocolError("ACQUISITIONS_DISABLED", "Acquisitions are not open on this pool.");
    }
    const qty = Math.max(1, Math.min(snap.maxBatch, Math.trunc(quantity)));
    const maxFee = applyBps(snap.acquisitionFee, BigInt(10_000 + driftToleranceBps));
    return {
      quantity: qty,
      poolFeePerItem: snap.acquisitionFee,
      serviceFeePerItem: snap.serviceFee,
      totalPerItem: snap.acquisitionFee + snap.serviceFee,
      total: (snap.acquisitionFee + snap.serviceFee) * BigInt(qty),
      maxAcquisitionFeePerItem: maxFee,
      driftToleranceBps,
      minWeightedValue: applyBps(snap.weightedBackingTotal, BigInt(10_000 - driftToleranceBps)),
      quotedAt: nowSec(),
      blockNumber: snap.blockNumber,
    };
  }

  balance(): bigint {
    return this.world.wallet.balance;
  }

  // ------------------------------------------------------------- tx core

  private makeTx(kind: TxKind, label: string, meta: Record<string, string> = {}): TrackedTransaction {
    const tx: TrackedTransaction = {
      id: `tx-${Date.now().toString(36)}-${(this.txSeq++).toString(36)}`,
      kind,
      label,
      phase: "review",
      createdAt: nowSec(),
      updatedAt: nowSec(),
      meta,
    };
    this.world.txs.set(tx.id, tx);
    return tx;
  }

  private setPhase(tx: TrackedTransaction, phase: TxPhase, error?: TrackedTransaction["error"]): void {
    tx.phase = phase;
    tx.updatedAt = nowSec();
    if (error) tx.error = error;
    if (phase === "submitted" && !tx.hash) {
      tx.hash = fakeTxHash(this.blockNow() + BigInt(this.txSeq));
    }
    this.persist();
    this.emit({ scope: "tx", txId: tx.id });
  }

  /**
   * Standard lifecycle: wallet → submitted → confirming → indexed → completed.
   * `apply` mutates the world at confirmation time (on-chain truth);
   * `indexed` fires when the mock indexer would have caught up.
   */
  private runTx(
    tx: TrackedTransaction,
    apply: () => void,
    opts: { confirmMs?: number; onIndexed?: () => void } = {},
  ): TrackedTransaction {
    this.setPhase(tx, "wallet");
    this.after(900, () => {
      if (this.world.devFlags.rejectNextWallet) {
        this.world.devFlags.rejectNextWallet = false;
        this.setPhase(tx, "rejected", { title: "Rejected in wallet" });
        return;
      }
      this.setPhase(tx, "submitted");
      this.after(500, () => {
        this.setPhase(tx, "confirming");
        this.after(opts.confirmMs ?? 1_300, () => {
          if (this.world.devFlags.revertNextTx) {
            this.world.devFlags.revertNextTx = false;
            this.setPhase(tx, "reverted", {
              title: "Transaction reverted",
              detail: "Execution reverted on-chain. No state was changed; the gas was spent.",
              raw: "0x08c379a0…(mock revert data)",
            });
            return;
          }
          try {
            apply();
          } catch (err) {
            this.setPhase(tx, "reverted", {
              title: "Transaction reverted",
              detail: err instanceof Error ? err.message : "Execution reverted",
            });
            return;
          }
          this.setPhase(tx, "indexed");
          const lagMs = this.world.scenario.indexerLagBlocks > 0 ? 2_500 : 600;
          this.after(lagMs, () => {
            this.setPhase(tx, "completed");
            opts.onIndexed?.();
          });
        });
      });
    });
    return tx;
  }

  private assertRpcUp(): void {
    if (this.world.scenario.rpcDown) {
      throw new ProtocolError("RPC_DOWN", "The HyperEVM RPC endpoint is unreachable.");
    }
  }

  private assertWritable(): void {
    this.assertRpcUp();
    const w = this.world.wallet;
    if (w.status !== "connected") {
      throw new ProtocolError("WALLET_NOT_CONNECTED", "Connect a wallet first.");
    }
    if (w.chainId !== this.world.chainId) {
      throw new ProtocolError(
        "WRONG_NETWORK",
        `Wallet is on chain ${w.chainId}; switch to HyperEVM Testnet (998).`,
      );
    }
  }

  // ------------------------------------------------------------- actions

  approveNFT(collection: Address, tokenId: bigint): TrackedTransaction {
    this.assertWritable();
    const owned = this.world.ownedNfts.find((n) => n.collection === collection && n.tokenId === tokenId);
    if (!owned) throw new ProtocolError("NOT_ELIGIBLE", "You do not own this NFT.");
    const tx = this.makeTx("approve_nft", `Approve ${owned.nft.collectionSymbol ?? "NFT"} #${tokenId}`, {
      collection,
      tokenId: tokenId.toString(),
    });
    return this.runTx(tx, () => {
      owned.approved = true;
      this.emit({ scope: "positions" });
    });
  }

  listNFT(collection: Address, tokenId: bigint, backing: bigint): TrackedTransaction {
    this.assertWritable();
    const col = this.world.collections.find((c) => c.address === collection);
    if (!col?.whitelisted) {
      throw new ProtocolError("COLLECTION_NOT_WHITELISTED", "This collection is not on the allowlist.");
    }
    if (backing < FWA_PARAMS.minBacking) {
      throw new ProtocolError("BELOW_MIN_BACKING", "Minimum backing is 0.1 HYPE.");
    }
    if (backing > this.world.wallet.balance) {
      throw new ProtocolError("INSUFFICIENT_BALANCE", "Backing exceeds your HYPE balance.");
    }
    const owned = this.world.ownedNfts.find((n) => n.collection === collection && n.tokenId === tokenId);
    if (!owned) throw new ProtocolError("NOT_ELIGIBLE", "You do not own this NFT.");
    if (!owned.approved) throw new ProtocolError("NOT_ELIGIBLE", "Approve the NFT for custody first.");

    const tx = this.makeTx("list_nft", `List ${owned.nft.collectionSymbol ?? "NFT"} #${tokenId}`, {
      collection,
      tokenId: tokenId.toString(),
      backing: backing.toString(),
    });
    return this.runTx(tx, () => {
      this.world.wallet.balance -= backing;
      const id = this.world.nextListingId++;
      const listing: Listing = {
        id,
        status: "staged",
        collection,
        tokenId,
        depositor: this.world.wallet.address,
        backing,
        weight: weightFromBacking(backing),
        listedAt: nowSec(),
        isCrown: false,
        pendingFees: 0n,
        nft: owned.nft,
      };
      this.world.listings.set(id, listing);
      this.world.ownedNfts = this.world.ownedNfts.filter((n) => n !== owned);
      this.pushActivity("deposit", { address: this.world.wallet.address, listingId: id, amount: backing });
      tx.meta.listingId = id.toString();
      this.emit({ scope: "listings" }, { scope: "pool" }, { scope: "positions" });
      // Staged deposits activate once the sequencer is idle (mock: short delay
      // when nothing is in flight, otherwise after in-flight requests resolve).
      this.after(6_000, () => this.tryActivate(id));
    });
  }

  private tryActivate(listingId: bigint): void {
    const l = this.world.listings.get(listingId);
    if (!l || l.status !== "staged") return;
    const inFlight = [...this.world.tickets.values()].some((t) =>
      ["requested", "randomness_pending", "randomness_cached", "processing"].includes(t.phase),
    );
    if (inFlight) {
      this.after(4_000, () => this.tryActivate(listingId));
      return;
    }
    l.status = "active";
    this.pushActivity("activation", { address: l.depositor, listingId: l.id });
    this.recomputeCrown();
    this.emit({ scope: "listings" }, { scope: "pool" }, { scope: "positions" }, { scope: "activity" });
  }

  withdrawListing(listingId: bigint): TrackedTransaction {
    this.assertWritable();
    const l = this.world.listings.get(listingId);
    if (!l || l.depositor !== this.world.wallet.address) {
      throw new ProtocolError("NOT_ELIGIBLE", "Not your listing.");
    }
    if (l.status !== "active" && l.status !== "staged") {
      throw new ProtocolError("NOT_ELIGIBLE", "Only staged or active listings can be withdrawn.");
    }
    const inFlight = [...this.world.tickets.values()].some((t) =>
      ["requested", "randomness_pending", "randomness_cached", "processing"].includes(t.phase),
    );
    if (inFlight) {
      throw new ProtocolError(
        "NOT_ELIGIBLE",
        "Exits are briefly locked while an acquisition request is in flight. Retry once it settles or expires.",
      );
    }
    const tx = this.makeTx("withdraw_listing", `Withdraw listing #${listingId}`, { listingId: listingId.toString() });
    return this.runTx(tx, () => {
      l.status = "withdrawn";
      this.world.wallet.balance += l.backing;
      this.world.ownedNfts.push({
        collection: l.collection,
        tokenId: l.tokenId,
        whitelisted: true,
        approved: true,
        nft: l.nft,
      });
      this.pushActivity("withdraw_listing", { address: l.depositor, listingId: l.id, amount: l.backing });
      this.recomputeCrown();
      this.emit({ scope: "listings" }, { scope: "pool" }, { scope: "positions" }, { scope: "activity" });
    });
  }

  acquire(quote: AcquisitionQuote): TrackedTransaction {
    this.assertWritable();
    const snap = this.poolSnapshot();
    if (!snap.acquisitionsEnabled) {
      throw new ProtocolError("ACQUISITIONS_DISABLED", "Acquisitions are not open on this pool.");
    }
    // Pre-transaction revalidation directly against live state — the indexed
    // quote is never trusted to authorize a spend.
    if (snap.acquisitionFee > quote.maxAcquisitionFeePerItem) {
      throw new ProtocolError(
        "PRICE_DRIFTED",
        `Live pool fee moved above your guarded maximum. Refresh the quote to continue.`,
      );
    }
    const liveTotal = (snap.acquisitionFee + snap.serviceFee) * BigInt(quote.quantity);
    if (liveTotal > this.world.wallet.balance) {
      throw new ProtocolError("INSUFFICIENT_BALANCE", "The total price exceeds your HYPE balance.");
    }

    const tx = this.makeTx(
      "acquire",
      quote.quantity === 1 ? "Acquire 1 position" : `Acquire ${quote.quantity} positions`,
      { quantity: String(quote.quantity), total: liveTotal.toString() },
    );
    return this.runTx(
      tx,
      () => {
        this.world.wallet.balance -= liveTotal;
        const requestIds: bigint[] = [];
        for (let i = 0; i < quote.quantity; i++) {
          const requestId = this.world.nextRequestId++;
          const sequence = this.world.nextSequence++;
          const ticket: AcquisitionTicket = {
            requestId,
            sequence,
            purchaser: this.world.wallet.address,
            feePaid: snap.acquisitionFee,
            serviceFeePaid: snap.serviceFee,
            requestedAt: nowSec(),
            txHash: tx.hash,
            phase: "requested",
            wordDeadlineBlock: this.blockNow() + 24n,
          };
          this.world.tickets.set(requestId, ticket);
          requestIds.push(requestId);
          this.pushActivity("acquisition_request", {
            address: ticket.purchaser,
            amount: ticket.feePaid + ticket.serviceFeePaid,
          });
          this.scheduleRandomness(requestId, i);
        }
        tx.meta.requestIds = requestIds.map(String).join(",");
        this.persist();
        this.emit({ scope: "pool" }, { scope: "positions" }, { scope: "activity" });
      },
      { confirmMs: 1_500 },
    );
  }

  private scheduleRandomness(requestId: bigint, indexInBatch: number): void {
    const t = this.world.tickets.get(requestId);
    if (!t) return;
    t.phase = "randomness_pending";
    this.persist();
    this.emit({ scope: "positions" });

    const delay = this.world.scenario.randomnessDelayMs;
    if (delay === null) {
      // The word never arrives: expire at the deadline and credit a refund.
      this.after(12_000, () => this.expireTicket(requestId));
      return;
    }
    this.after(delay + indexInBatch * 700, () => {
      const ticket = this.world.tickets.get(requestId);
      if (!ticket || ticket.phase !== "randomness_pending") return;
      ticket.phase = "randomness_cached";
      this.pushActivity("randomness_cached", { address: ticket.purchaser });
      this.persist();
      this.emit({ scope: "positions" }, { scope: "activity" });
      this.after(900, () => this.processTicket(requestId));
    });
  }

  private expireTicket(requestId: bigint): void {
    const t = this.world.tickets.get(requestId);
    if (!t || t.phase !== "randomness_pending") return;
    t.phase = "expired";
    t.refund = t.feePaid;
    this.world.claimable.acquisitionRefund += t.feePaid;
    this.pushActivity("acquisition_refund", { address: t.purchaser, amount: t.feePaid });
    this.persist();
    this.emit({ scope: "positions" }, { scope: "activity" }, { scope: "pool" });
  }

  private processTicket(requestId: bigint): void {
    const t = this.world.tickets.get(requestId);
    if (!t || t.phase !== "randomness_cached") return;
    t.phase = "processing";
    this.emit({ scope: "positions" });

    const active = this.activeListings();
    if (active.length === 0) {
      t.phase = "refunded";
      t.refund = t.feePaid;
      this.world.claimable.acquisitionRefund += t.feePaid;
      this.pushActivity("acquisition_refund", { address: t.purchaser, amount: t.feePaid });
      this.persist();
      this.emit({ scope: "positions" }, { scope: "activity" });
      return;
    }

    const chosen = pickWeighted(active);
    this.after(800, () => {
      const ticket = this.world.tickets.get(requestId);
      const listing = this.world.listings.get(chosen.id);
      if (!ticket || !listing || listing.status !== "active") return;
      listing.status = "allocated";
      listing.purchaser = ticket.purchaser;
      listing.allocatedAt = nowSec();
      listing.acquiredFor = ticket.feePaid + ticket.serviceFeePaid;
      ticket.phase = "allocated";
      ticket.listingId = listing.id;
      // Crown: 1% of each distributed fee feeds the pot; the crown's own
      // allocation settles the pot to its depositor.
      if (listing.isCrown) {
        this.pushActivity("crown_settled", {
          address: listing.depositor,
          listingId: listing.id,
          amount: this.crownPot,
        });
        if (listing.depositor === MOCK_USER) this.world.claimable.earnings += this.crownPot;
        this.crownPot = 0n;
        listing.isCrown = false;
      } else {
        this.crownPot += applyBps(ticket.feePaid, BigInt(FWA_PARAMS.crownShareBps));
      }
      // Fee sharing: equal split across remaining active listings (mock keeps
      // only the user's accrual observable).
      const remaining = this.activeListings();
      if (remaining.length > 0) {
        const perListing = (ticket.feePaid * 9_000n) / 10_000n / BigInt(remaining.length);
        for (const l of remaining) {
          if (l.depositor === MOCK_USER) l.pendingFees += perListing;
        }
      }
      this.pushActivity("allocation", {
        address: ticket.purchaser,
        listingId: listing.id,
        collection: listing.collection,
        tokenId: listing.tokenId,
        amount: listing.backing,
      });
      this.recomputeCrown();
      this.persist();
      this.emit({ scope: "positions" }, { scope: "listings" }, { scope: "pool" }, { scope: "activity" });
    });
  }

  settle(listingId: bigint, choice: SettlementChoice): TrackedTransaction {
    this.assertWritable();
    const l = this.world.listings.get(listingId);
    const info = this.settlementInfo(listingId);
    if (!l || !info) throw new ProtocolError("NOT_ELIGIBLE", "This listing is not awaiting settlement.");
    const me = this.world.wallet.address;
    const now = nowSec();
    const isPurchaser = l.purchaser === me;
    const isDepositor = l.depositor === me;

    const kindMap: Record<SettlementChoice["kind"], TxKind> = {
      keep: "settle_keep",
      relist: "settle_relist",
      acceptBidHype: "settle_accept_bid",
      acceptBidTokens: "settle_accept_bid_tokens",
      depositorReclaimNft: "depositor_reclaim",
      depositorReclaimBacking: "depositor_reclaim",
      finalize: "finalize",
    };

    // Window / role gating mirrors the contract rules.
    switch (choice.kind) {
      case "keep":
      case "relist":
      case "acceptBidHype":
      case "acceptBidTokens":
        if (!isPurchaser) throw new ProtocolError("NOT_ELIGIBLE", "Only the purchaser can settle this way.");
        break;
      case "depositorReclaimNft":
      case "depositorReclaimBacking":
        if (!isDepositor) throw new ProtocolError("NOT_ELIGIBLE", "Only the depositor can resolve this listing.");
        if (now < info.purchaserWindowEndsAt) {
          throw new ProtocolError("WINDOW_NOT_OPEN", "The purchaser's exclusive 24h window is still open.");
        }
        break;
      case "finalize":
        if (now < info.finalizeOpensAt) {
          throw new ProtocolError("WINDOW_NOT_OPEN", "Permissionless finalization opens 7 days after allocation.");
        }
        break;
    }
    if (choice.kind === "acceptBidTokens" && !this.world.scenario.rewardsActive) {
      throw new ProtocolError(
        "NOT_ELIGIBLE",
        "Token settlement requires the HWA rewards module, which is not activated.",
      );
    }
    if (choice.kind === "relist") {
      if (choice.newBacking < FWA_PARAMS.minBacking) {
        throw new ProtocolError("BELOW_MIN_BACKING", "Minimum backing is 0.1 HYPE.");
      }
      if (choice.newBacking > this.world.wallet.balance) {
        throw new ProtocolError("INSUFFICIENT_BALANCE", "New backing exceeds your HYPE balance.");
      }
    }

    const labels: Record<SettlementChoice["kind"], string> = {
      keep: `Keep NFT — listing #${listingId}`,
      relist: `Keep & relist — listing #${listingId}`,
      acceptBidHype: `Accept bid in HYPE — listing #${listingId}`,
      acceptBidTokens: `Accept bid as HWA — listing #${listingId}`,
      depositorReclaimNft: `Reclaim NFT — listing #${listingId}`,
      depositorReclaimBacking: `Reclaim backing — listing #${listingId}`,
      finalize: `Finalize listing #${listingId}`,
    };
    const tx = this.makeTx(kindMap[choice.kind], labels[choice.kind], { listingId: listingId.toString() });

    return this.runTx(tx, () => {
      const netBacking = info.netBackingToDepositor;
      const creditDepositor = (amount: bigint) => {
        if (l.depositor === MOCK_USER) this.world.claimable.earnings += amount;
      };
      switch (choice.kind) {
        case "keep": {
          l.status = "settled";
          l.settlement = "kept";
          creditDepositor(netBacking);
          this.world.ownedNfts.push({
            collection: l.collection,
            tokenId: l.tokenId,
            whitelisted: true,
            approved: false,
            nft: l.nft,
          });
          this.pushActivity("keep", { address: me, listingId, collection: l.collection, tokenId: l.tokenId });
          break;
        }
        case "relist": {
          l.status = "settled";
          l.settlement = "relisted";
          creditDepositor(netBacking);
          this.world.wallet.balance -= choice.newBacking;
          const id = this.world.nextListingId++;
          this.world.listings.set(id, {
            id,
            status: "staged",
            collection: l.collection,
            tokenId: l.tokenId,
            depositor: me,
            backing: choice.newBacking,
            weight: weightFromBacking(choice.newBacking),
            listedAt: nowSec(),
            isCrown: false,
            pendingFees: 0n,
            nft: l.nft,
          });
          this.pushActivity("relist", { address: me, listingId: id, amount: choice.newBacking });
          this.after(6_000, () => this.tryActivate(id));
          break;
        }
        case "acceptBidHype": {
          l.status = "settled";
          l.settlement = "bid_accepted";
          this.world.wallet.balance += info.bidPayout;
          this.pushActivity("bid_accepted", { address: me, listingId, amount: info.bidPayout });
          break;
        }
        case "acceptBidTokens": {
          l.status = "settled";
          l.settlement = "bid_accepted_tokens";
          const tokensOut = info.bidPayout * 120_000n; // mock rate: 1 HYPE → 120 000 HWA
          this.world.rewardsUser.purchaserBuyAllowanceHype += tokensOut;
          this.pushActivity("bid_accepted_tokens", { address: me, listingId, amount: info.bidPayout, tokenAmount: tokensOut });
          break;
        }
        case "depositorReclaimNft": {
          l.status = "settled";
          l.settlement = "depositor_reclaim_nft";
          this.world.ownedNfts.push({
            collection: l.collection,
            tokenId: l.tokenId,
            whitelisted: true,
            approved: false,
            nft: l.nft,
          });
          this.pushActivity("depositor_resolved", { address: me, listingId });
          break;
        }
        case "depositorReclaimBacking": {
          l.status = "settled";
          l.settlement = "depositor_reclaim_backing";
          this.world.wallet.balance += info.bidPayout; // economic equivalent of accept-bid
          this.pushActivity("depositor_resolved", { address: me, listingId, amount: info.bidPayout });
          break;
        }
        case "finalize": {
          l.status = "settled";
          l.settlement = "finalized";
          creditDepositor(netBacking);
          if (l.purchaser === MOCK_USER) {
            // Default outcome delivers the NFT to the purchaser (best-effort).
            this.world.ownedNfts.push({
              collection: l.collection,
              tokenId: l.tokenId,
              whitelisted: true,
              approved: false,
              nft: l.nft,
            });
          }
          this.pushActivity("finalized", { address: me, listingId });
          break;
        }
      }
      this.recomputeCrown();
      this.emit({ scope: "positions" }, { scope: "listings" }, { scope: "pool" }, { scope: "activity" });
    });
  }

  recoverStuckNFT(listingId: bigint): TrackedTransaction {
    this.assertWritable();
    const l = this.world.listings.get(listingId);
    if (!l || l.stuckRecipient !== this.world.wallet.address) {
      throw new ProtocolError("NOT_ELIGIBLE", "No stuck NFT recoverable by you on this listing.");
    }
    const tx = this.makeTx("recover_stuck_nft", `Retry NFT delivery — listing #${listingId}`, {
      listingId: listingId.toString(),
    });
    return this.runTx(tx, () => {
      l.stuckRecipient = undefined;
      this.world.ownedNfts.push({
        collection: l.collection,
        tokenId: l.tokenId,
        whitelisted: true,
        approved: false,
        nft: l.nft,
      });
      this.pushActivity("stuck_recovered", { address: this.world.wallet.address, listingId });
      this.emit({ scope: "positions" }, { scope: "activity" });
    });
  }

  withdrawEarnings(): TrackedTransaction {
    this.assertWritable();
    if (this.world.claimable.earnings <= 0n) throw new ProtocolError("NOT_ELIGIBLE", "No earnings to withdraw.");
    const tx = this.makeTx("withdraw_earnings", "Withdraw earnings");
    return this.runTx(tx, () => {
      const amount = this.world.claimable.earnings;
      this.world.claimable.earnings = 0n;
      this.world.wallet.balance += amount;
      this.pushActivity("earnings_withdraw", { address: this.world.wallet.address, amount });
      this.emit({ scope: "positions" }, { scope: "activity" });
    });
  }

  withdrawAcquisitionRefund(): TrackedTransaction {
    this.assertWritable();
    if (this.world.claimable.acquisitionRefund <= 0n) {
      throw new ProtocolError("NOT_ELIGIBLE", "No acquisition refund to withdraw.");
    }
    const tx = this.makeTx("withdraw_refund", "Withdraw acquisition refund");
    return this.runTx(tx, () => {
      const amount = this.world.claimable.acquisitionRefund;
      this.world.claimable.acquisitionRefund = 0n;
      this.world.wallet.balance += amount;
      this.pushActivity("acquisition_refund", { address: this.world.wallet.address, amount });
      this.emit({ scope: "positions" }, { scope: "activity" });
    });
  }

  claimListingFees(listingIds: bigint[]): TrackedTransaction {
    this.assertWritable();
    const mine = listingIds
      .map((id) => this.world.listings.get(id))
      .filter((l): l is Listing => !!l && l.depositor === this.world.wallet.address && l.pendingFees > 0n);
    if (mine.length === 0) throw new ProtocolError("NOT_ELIGIBLE", "No claimable fees on these listings.");
    const tx = this.makeTx("claim_listing_fees", `Claim fees on ${mine.length} listing${mine.length > 1 ? "s" : ""}`);
    return this.runTx(tx, () => {
      let total = 0n;
      for (const l of mine) {
        total += l.pendingFees;
        l.pendingFees = 0n;
      }
      this.world.wallet.balance += total;
      this.pushActivity("earnings_withdraw", { address: this.world.wallet.address, amount: total });
      this.emit({ scope: "positions" }, { scope: "activity" });
    });
  }

  claimCrown(listingId: bigint): TrackedTransaction {
    this.assertWritable();
    const l = this.world.listings.get(listingId);
    const snap = this.poolSnapshot();
    if (!l || l.depositor !== this.world.wallet.address || l.status !== "active") {
      throw new ProtocolError("NOT_ELIGIBLE", "Only your active listing can claim the top spot.");
    }
    const crown = snap.crown ? this.world.listings.get(snap.crown.listingId) : undefined;
    if (crown) {
      const required = applyBps(crown.backing, BigInt(10_000 + FWA_PARAMS.crownThresholdBps));
      if (l.backing < required) {
        throw new ProtocolError(
          "NOT_ELIGIBLE",
          "Your backing must beat the current top deposit by at least 10%.",
        );
      }
    }
    const tx = this.makeTx("claim_crown", `Claim top spot — listing #${listingId}`);
    return this.runTx(tx, () => {
      for (const other of this.world.listings.values()) other.isCrown = false;
      l.isCrown = true;
      this.pushActivity("crown_set", { address: l.depositor, listingId: l.id, amount: l.backing });
      this.emit({ scope: "pool" }, { scope: "listings" }, { scope: "activity" });
    });
  }

  claimRewards(
    epochs?: number[],
    listingIds?: bigint[],
    withdrawCredit = false,
    claimAccruedMinOut?: bigint,
  ): TrackedTransaction {
    this.assertWritable();
    if (!this.world.scenario.rewardsActive) {
      throw new ProtocolError("NOT_ELIGIBLE", "The rewards module is not activated.");
    }
    const r = this.world.rewardsUser;
    const total =
      (epochs?.length ? r.purchaserClaimable : 0n) +
      (listingIds?.length ? r.depositorPending : 0n) +
      (withdrawCredit ? r.depositorCredit : 0n) +
      (claimAccruedMinOut !== undefined ? r.purchaserBuyAllowanceHype : 0n);
    if (total <= 0n) throw new ProtocolError("NOT_ELIGIBLE", "Nothing claimable right now.");
    const tx = this.makeTx("claim_rewards", "Claim HWA rewards");
    return this.runTx(tx, () => {
      const claimedNow = total;
      r.claimed += claimedNow;
      if (listingIds?.length) r.depositorPending = 0n;
      if (withdrawCredit) r.depositorCredit = 0n;
      if (epochs?.length) {
        r.purchaserClaimable = 0n;
        r.claimableEpochs = [];
      }
      if (claimAccruedMinOut !== undefined) r.purchaserBuyAllowanceHype = 0n;
      this.pushActivity("reward_claim", { address: this.world.wallet.address, tokenAmount: claimedNow });
      this.emit({ scope: "rewards" }, { scope: "activity" });
    });
  }


  // ---------------------------------------------------------- token market

  /** Deterministic synthetic price series - mock only, clearly labeled in UI. */
  tokenMarket(): TokenMarket {
    if (!this.world.scenario.rewardsActive) {
      return { moduleActive: false, symbol: "HWA" };
    }
    const now = nowSec();
    const buckets = 96; // 24h of 15-minute candles
    const step = 900;
    const candles: Candle[] = [];
    // Price walk in HYPE wei per HWA around 8.3e12 wei (1 HYPE ~ 120k HWA)
    let price = 8_300_000_000_000n;
    const seedRnd = mulberry(this.world.bootSec);
    for (let i = buckets; i > 0; i--) {
      const t = now - i * step;
      const drift = BigInt(Math.floor((seedRnd() - 0.47) * 260));
      const o = price;
      price = price + (price * drift) / 10_000n;
      if (price < 1_000_000_000_000n) price = 1_000_000_000_000n;
      const c = price;
      const spread = (c * BigInt(20 + Math.floor(seedRnd() * 60))) / 10_000n;
      const h = (o > c ? o : c) + spread;
      const l = (o < c ? o : c) - spread / 2n;
      const v = BigInt(Math.floor(seedRnd() * 40_000)) * (WEI / 1000n);
      candles.push({ t, o, h, l, c, v });
    }
    const first = candles[0]!;
    const change24hBps = Number(((price - first.o) * 10_000n) / (first.o === 0n ? 1n : first.o));
    const supply = 1_000_000_000n * WEI;
    const vol = candles.reduce((a, c) => a + c.v, 0n);
    return {
      moduleActive: true,
      symbol: "HWA",
      tokenAddress: "0x0a0a00000000000000000000000000000000hwa1" as Address,
      price,
      change24hBps,
      marketCapHype: (supply / WEI) * price,
      volume24hHype: vol,
      volume24hToken: (vol * WEI) / price,
      poolSwaps: 12_480 + Math.floor((now - this.world.bootSec) / 30),
      poolAddress: "0x9001000000000000000000000000000000009001" as Address,
      dex: "Project X",
      feeTierBps: 100,
      candles,
      user: { hypeBalance: this.world.wallet.balance, tokenBalance: this.world.rewardsUser.claimed },
    };
  }

  quoteSwap(side: SwapSide, amountIn: bigint, slippageBps: number): SwapQuote {
    this.assertRpcUp();
    const market = this.tokenMarket();
    if (!market.moduleActive || !market.price) {
      throw new ProtocolError("NOT_ELIGIBLE", "The HWA market is not live yet.");
    }
    if (amountIn <= 0n) throw new ProtocolError("NOT_ELIGIBLE", "Enter an amount to swap.");
    const feeBps = market.feeTierBps ?? 100;
    const afterFee = amountIn - applyBps(amountIn, BigInt(feeBps));
    // buy: HYPE in -> HWA out; sell: HWA in -> HYPE out
    const gross = side === "buy" ? (afterFee * WEI) / market.price : (afterFee * market.price) / WEI;
    // Shallow-pool impact: grows with size, capped for sanity in the mock.
    const impactBps = Math.min(900, Number(amountIn / (WEI * 25n)) * 4);
    const amountOut = gross - applyBps(gross, BigInt(impactBps));
    return {
      side,
      amountIn,
      amountOut,
      minOut: amountOut - applyBps(amountOut, BigInt(slippageBps)),
      slippageBps,
      priceImpactBps: impactBps,
      feeBps,
      quotedAt: nowSec(),
    };
  }

  swap(quote: SwapQuote): TrackedTransaction {
    this.assertWritable();
    const market = this.tokenMarket();
    if (!market.moduleActive) throw new ProtocolError("NOT_ELIGIBLE", "The HWA market is not live yet.");
    if (quote.side === "buy" && quote.amountIn > this.world.wallet.balance) {
      throw new ProtocolError("INSUFFICIENT_BALANCE", "Not enough HYPE for this swap.");
    }
    if (quote.side === "sell" && quote.amountIn > this.world.rewardsUser.claimed) {
      throw new ProtocolError("INSUFFICIENT_BALANCE", "Not enough HWA for this swap.");
    }
    const tx = this.makeTx("swap", quote.side === "buy" ? "Buy HWA" : "Sell HWA", {
      side: quote.side,
      amountIn: quote.amountIn.toString(),
    });
    return this.runTx(tx, () => {
      if (quote.side === "buy") {
        this.world.wallet.balance -= quote.amountIn;
        this.world.rewardsUser.claimed += quote.amountOut;
      } else {
        this.world.rewardsUser.claimed -= quote.amountIn;
        this.world.wallet.balance += quote.amountOut;
      }
      this.emit({ scope: "rewards" }, { scope: "positions" });
    });
  }

  // ------------------------------------------------------ purchase analytics

  purchaseStats(account: Address): PurchaseStats {
    const acc = account.toLowerCase();
    const tickets = [...this.world.tickets.values()].filter((t) => t.purchaser.toLowerCase() === acc);
    const seeded = [...this.world.listings.values()].filter(
      (l) => l.purchaser?.toLowerCase() === acc && (l.status === "settled" || l.status === "allocated"),
    );

    const history: PurchaseRecord[] = [];
    for (const t of tickets) {
      const listing = t.listingId ? this.world.listings.get(t.listingId) : undefined;
      history.push({
        requestId: t.requestId,
        timestamp: t.requestedAt,
        txHash: t.txHash,
        allInPaid: t.feePaid + t.serviceFeePaid,
        listingId: t.listingId,
        backingReceived: listing?.backing ?? 0n,
        outcome:
          t.phase === "allocated"
            ? (listing?.settlement ?? "allocated")
            : ["expired", "refunded"].includes(t.phase)
              ? "refunded"
              : "pending",
        nft: listing?.nft,
      });
    }
    // Pre-session purchases reconstructed from the seeded world.
    for (const l of seeded) {
      if (history.some((h) => h.listingId === l.id)) continue;
      history.push({
        requestId: 6_000n + l.id,
        timestamp: l.allocatedAt ?? l.listedAt,
        allInPaid: applyBps(l.backing, 9_000n),
        listingId: l.id,
        backingReceived: l.backing,
        outcome: l.settlement ?? "allocated",
        nft: l.nft,
      });
    }
    history.sort((a, b) => b.timestamp - a.timestamp);

    const settled = history.filter((h) => h.outcome !== "pending" && h.outcome !== "refunded");
    const allInSpend = settled.reduce((a, h) => a + h.allInPaid, 0n);
    const received = settled.reduce((a, h) => a + h.backingReceived, 0n);
    return {
      purchases: settled.length,
      avgAllInPrice: settled.length > 0 ? allInSpend / BigInt(settled.length) : 0n,
      allInSpend,
      netListingPL: received - allInSpend,
      history,
    };
  }

  // -------------------------------------------------------------- helpers

  private pushActivity(
    type: ActivityType,
    fields: Partial<Omit<ActivityItem, "id" | "type" | "timestamp" | "finality" | "txHash" | "blockNumber">>,
  ): void {
    const block = this.blockNow();
    this.world.activity.push({
      id: `live-${this.world.activity.length}-${Date.now().toString(36)}`,
      type,
      txHash: fakeTxHash(block + BigInt(this.world.activity.length)),
      blockNumber: block,
      timestamp: nowSec(),
      finality: "indexed",
      ...fields,
    });
    // Older entries harden into confirmed.
    for (const a of this.world.activity) {
      if (a.finality === "indexed" && nowSec() - a.timestamp > 90) a.finality = "confirmed";
    }
  }

  private recomputeCrown(): void {
    const active = this.activeListings();
    if (active.length === 0) return;
    const current = active.find((l) => l.isCrown);
    if (current) return; // crown only moves when vacated or explicitly claimed
    let best: Listing | undefined;
    for (const l of active) if (!best || l.backing > best.backing) best = l;
    if (best) {
      best.isCrown = true;
      this.pushActivity("crown_set", { address: best.depositor, listingId: best.id, amount: best.backing });
    }
  }

  // ------------------------------------------------------------- ambient

  /** Synthetic third-party flow so the terminal feels alive and quotes can drift. */
  private startAmbient(): void {
    const s = this.world.scenario;
    if (s.rpcDown || s.emptyPool) return;
    const period = s.freezeQuote ? 12_000 : 30_000;
    this.ambient = setInterval(() => {
      const roll = Math.random();
      if (roll < 0.55) this.ambientAcquisition();
      else this.ambientDeposit();
    }, period);
  }

  private ambientDeposit(): void {
    const symbols = ["HYPURR", "HYPIO", "PIP", "HYPERS", "MADKIN"] as const;
    const symbol = symbols[Math.floor(Math.random() * symbols.length)]!;
    const col = this.world.collections.find((c) => c.symbol === symbol)!;
    const tokenId = BigInt(1_200 + Math.floor(Math.random() * 8_000));
    // Skewed small (0.02–5 HYPE) so long sessions keep a believable EV curve.
    const backing = (BigInt(2 + Math.floor(Math.random() ** 2 * 500)) * WEI) / 100n;
    const depositor = actorAt(Math.floor(Math.random() * 6));
    const id = this.world.nextListingId++;
    this.world.listings.set(id, {
      id,
      status: "staged",
      collection: col.address,
      tokenId,
      depositor,
      backing,
      weight: weightFromBacking(backing),
      listedAt: nowSec(),
      isCrown: false,
      pendingFees: 0n,
      nft: {
        name: `${col.name} #${tokenId}`,
        imageUrl: nftArtDataUri(symbol, tokenId),
        collectionName: col.name,
        collectionSymbol: symbol,
      },
    });
    this.pushActivity("deposit", { address: depositor, listingId: id, amount: backing });
    this.after(6_000, () => this.tryActivate(id));
    this.emit({ scope: "listings" }, { scope: "pool" }, { scope: "activity" });
  }

  private ambientAcquisition(): void {
    const active = this.activeListings();
    if (active.length <= 4) return;
    const snap = this.poolSnapshot();
    const buyer = actorAt(Math.floor(Math.random() * 6));
    this.pushActivity("acquisition_request", { address: buyer, amount: snap.totalPrice });
    this.emit({ scope: "activity" }, { scope: "pool" });
    this.after(3_000, () => {
      const nowActive = this.activeListings().filter((l) => l.depositor !== MOCK_USER || Math.random() < 0.25);
      if (nowActive.length === 0) return;
      const chosen = pickWeighted(nowActive);
      const listing = this.world.listings.get(chosen.id);
      if (!listing || listing.status !== "active") return;
      listing.status = "allocated";
      listing.purchaser = buyer;
      listing.allocatedAt = nowSec();
      listing.acquiredFor = snap.totalPrice;
      if (listing.isCrown) {
        listing.isCrown = false;
        this.crownPot = 0n;
      } else {
        this.crownPot += applyBps(snap.acquisitionFee, BigInt(FWA_PARAMS.crownShareBps));
      }
      const remaining = this.activeListings();
      if (remaining.length > 0) {
        const perListing = (snap.acquisitionFee * 9_000n) / 10_000n / BigInt(remaining.length);
        for (const l of remaining) if (l.depositor === MOCK_USER) l.pendingFees += perListing;
      }
      this.pushActivity("allocation", {
        address: buyer,
        listingId: listing.id,
        collection: listing.collection,
        tokenId: listing.tokenId,
        amount: listing.backing,
      });
      this.recomputeCrown();
      this.emit({ scope: "listings" }, { scope: "pool" }, { scope: "activity" });
      // Third parties usually accept the bid shortly after.
      this.after(9_000, () => {
        if (listing.status !== "allocated") return;
        listing.status = "settled";
        listing.settlement = "bid_accepted";
        this.pushActivity("bid_accepted", {
          address: buyer,
          listingId: listing.id,
          amount: applyBps(listing.backing, BigInt(FWA_PARAMS.bidPayoutBps)),
        });
        this.emit({ scope: "listings" }, { scope: "activity" });
      });
    });
  }

  // ---------------------------------------------------------- persistence

  private storageKey(): string {
    return `fwa.mock.${this.world.scenario.id}.v1`;
  }

  private persist(): void {
    if (typeof window === "undefined") return;
    try {
      const txs = [...this.world.txs.values()].map((t) => ({ ...t }));
      const tickets = [...this.world.tickets.values()].map((t) => ({
        requestId: t.requestId.toString(),
        sequence: t.sequence.toString(),
        purchaser: t.purchaser,
        feePaid: t.feePaid.toString(),
        serviceFeePaid: t.serviceFeePaid.toString(),
        requestedAt: t.requestedAt,
        txHash: t.txHash,
        phase: t.phase,
        listingId: t.listingId?.toString(),
        refund: t.refund?.toString(),
      }));
      window.localStorage.setItem(this.storageKey(), JSON.stringify({ txs, tickets }));
    } catch {
      // Storage may be unavailable (private mode) — resume is best-effort.
    }
  }

  resumeTracking(): void {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(this.storageKey());
      if (!raw) return;
      const data = JSON.parse(raw) as {
        txs?: (Omit<TrackedTransaction, "phase"> & { phase: TxPhase })[];
        tickets?: {
          requestId: string;
          sequence: string;
          purchaser: Address;
          feePaid: string;
          serviceFeePaid: string;
          requestedAt: number;
          txHash?: Hex;
          phase: AcquisitionTicket["phase"];
          listingId?: string;
          refund?: string;
        }[];
      };
      for (const t of data.txs ?? []) {
        const tx: TrackedTransaction = { ...t };
        if (tx.phase === "wallet" || tx.phase === "review") {
          // Reload while the wallet prompt was open: outcome unknown → stale.
          tx.phase = "timeout";
          tx.error = {
            title: "Interrupted before submission",
            detail: "The page reloaded while the wallet prompt was open. Nothing was sent — retry the action.",
          };
        } else if (tx.phase === "submitted" || tx.phase === "confirming" || tx.phase === "indexed") {
          // Was in flight: resolve shortly after resume.
          this.after(1_800, () => {
            const live = this.world.txs.get(tx.id);
            if (live && (live.phase === "submitted" || live.phase === "confirming" || live.phase === "indexed")) {
              this.setPhase(live, "completed");
            }
          });
        }
        this.world.txs.set(tx.id, tx);
      }
      for (const s of data.tickets ?? []) {
        const ticket: AcquisitionTicket = {
          requestId: BigInt(s.requestId),
          sequence: BigInt(s.sequence),
          purchaser: s.purchaser,
          feePaid: BigInt(s.feePaid),
          serviceFeePaid: BigInt(s.serviceFeePaid),
          requestedAt: s.requestedAt,
          txHash: s.txHash,
          phase: s.phase,
          listingId: s.listingId ? BigInt(s.listingId) : undefined,
          refund: s.refund ? BigInt(s.refund) : undefined,
        };
        // Only user-side tickets are persisted; in-flight ones resume their flow.
        this.world.tickets.set(ticket.requestId, ticket);
        if (["requested", "randomness_pending", "randomness_cached", "processing"].includes(ticket.phase)) {
          ticket.phase = "randomness_pending";
          this.after(2_500, () => {
            const live = this.world.tickets.get(ticket.requestId);
            if (live && live.phase === "randomness_pending") {
              live.phase = "randomness_cached";
              this.after(700, () => this.processTicket(live.requestId));
            }
          });
        }
        if (ticket.requestId >= this.world.nextRequestId) this.world.nextRequestId = ticket.requestId + 1n;
        if (ticket.sequence >= this.world.nextSequence) this.world.nextSequence = ticket.sequence + 1n;
      }
    } catch {
      // Corrupt storage: ignore, fixtures stand alone.
    }
  }

  dismissTx(id: string): void {
    this.world.txs.delete(id);
    this.persist();
    this.emit({ scope: "tx", txId: id });
  }
}

// ------------------------------------------------------------------ utils

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

/** Seeded PRNG so the mock price series is stable within a session. */
function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function cloneListing(l: Listing): Listing {
  return { ...l, nft: { ...l.nft } };
}

/** Weighted random pick over listing weights (bigint-safe). */
function pickWeighted(listings: Listing[]): Listing {
  let total = 0n;
  for (const l of listings) total += l.weight;
  const r = randomBigint(total);
  let acc = 0n;
  for (const l of listings) {
    acc += l.weight;
    if (r < acc) return l;
  }
  return listings[listings.length - 1]!;
}

function randomBigint(maxExclusive: bigint): bigint {
  if (maxExclusive <= 1n) return 0n;
  const a = BigInt(Math.floor(Math.random() * 0x1_0000_0000));
  const b = BigInt(Math.floor(Math.random() * 0x1_0000_0000));
  const c = BigInt(Math.floor(Math.random() * 0x1_0000_0000));
  return ((a << 64n) | (b << 32n) | c) % maxExclusive;
}
