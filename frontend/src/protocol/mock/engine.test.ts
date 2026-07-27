import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProtocolError } from "@/protocol/errors";
import { applyBps } from "@/lib/units";
import { MockEngine } from "./engine";
import { MOCK_USER } from "./fixtures";
import { SCENARIOS } from "./scenarios";

/**
 * Engine behavior tests — the mock is the reference implementation the UI is
 * developed against, so its protocol semantics are tested like real code.
 */

let engine: MockEngine;

function makeEngine(scenario: keyof typeof SCENARIOS = "default") {
  engine = new MockEngine(SCENARIOS[scenario]);
  return engine;
}

function connect() {
  engine.connectWallet();
  vi.advanceTimersByTime(700);
}

/** Drive a standard tx lifecycle to completion (wallet→submitted→confirming→apply→indexed→completed). */
function driveTx(ms = 5_000) {
  vi.advanceTimersByTime(ms);
}

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
});

afterEach(() => {
  engine?.destroy();
  vi.useRealTimers();
});

describe("pool math", () => {
  it("prices from the harmonic mean with the 10% surcharge", () => {
    makeEngine();
    const snap = engine.poolSnapshot();
    const ev = snap.weightedBackingTotal / snap.totalWeight;
    expect(snap.acquisitionFee).toBe(applyBps(ev, 11_000n));
    expect(snap.totalPrice).toBe(snap.acquisitionFee + snap.serviceFee);
    expect(snap.activeListingCount).toBeGreaterThan(15);
    expect(snap.crown).toBeDefined();
  });

  it("quote scales with quantity and applies the drift guard", () => {
    makeEngine();
    const q = engine.quote(3, 1_000);
    expect(q.total).toBe(q.totalPerItem * 3n);
    expect(q.maxAcquisitionFeePerItem).toBe(applyBps(q.poolFeePerItem, 11_000n));
  });

  it("empty pool disables acquisitions", () => {
    makeEngine("emptyPool");
    const snap = engine.poolSnapshot();
    expect(snap.acquisitionsEnabled).toBe(false);
    expect(() => engine.quote(1, 1_000)).toThrowError(ProtocolError);
  });
});

describe("write guards", () => {
  it("requires a connected wallet on the right chain", () => {
    makeEngine();
    expect(() => engine.acquire(engineQuote())).toThrowError(/Connect a wallet/);
    connect();
    expect(engine.world.wallet.status).toBe("connected");
  });

  it("blocks writes on the wrong network", () => {
    makeEngine("wrongNetwork");
    connect();
    try {
      engine.acquire(engineQuote());
      expect.unreachable("should have thrown");
    } catch (e) {
      expect((e as ProtocolError).code).toBe("WRONG_NETWORK");
    }
  });

  it("rejects an acquire whose guarded max fee is below the live fee", () => {
    makeEngine();
    connect();
    const q = engineQuote();
    const doctored = { ...q, maxAcquisitionFeePerItem: 1n };
    try {
      engine.acquire(doctored);
      expect.unreachable("should have thrown");
    } catch (e) {
      expect((e as ProtocolError).code).toBe("PRICE_DRIFTED");
    }
  });

  it("rejects an acquire beyond the balance", () => {
    makeEngine("poorWallet");
    connect();
    try {
      engine.acquire(engineQuote());
      expect.unreachable("should have thrown");
    } catch (e) {
      expect((e as ProtocolError).code).toBe("INSUFFICIENT_BALANCE");
    }
  });
});

describe("acquisition lifecycle", () => {
  it("escrows, requests randomness, allocates a listing and starts the settlement window", () => {
    makeEngine();
    connect();
    const before = engine.balance();
    const q = engineQuote();
    engine.acquire(q);
    driveTx(3_500); // wallet + submitted + confirming

    const tickets = [...engine.world.tickets.values()];
    expect(tickets).toHaveLength(1);
    expect(engine.balance()).toBe(before - q.total);
    expect(tickets[0]!.phase).toBe("randomness_pending");

    vi.advanceTimersByTime(7_000); // randomness + processing + allocation
    const ticket = [...engine.world.tickets.values()][0]!;
    expect(ticket.phase).toBe("allocated");
    expect(ticket.listingId).toBeDefined();

    const listing = engine.world.listings.get(ticket.listingId!)!;
    expect(listing.status).toBe("allocated");
    expect(listing.purchaser).toBe(MOCK_USER);
    expect(listing.allocatedAt).toBeDefined();
    expect(engine.settlementInfo(listing.id)).not.toBeNull();
  });

  it("expires and credits a refund when the word never arrives", () => {
    makeEngine("randomnessTimeout");
    connect();
    const refundBefore = engine.world.claimable.acquisitionRefund;
    const q = engineQuote();
    engine.acquire(q);
    driveTx(3_500);
    vi.advanceTimersByTime(13_000); // past the mock word deadline

    const ticket = [...engine.world.tickets.values()][0]!;
    expect(ticket.phase).toBe("expired");
    expect(engine.world.claimable.acquisitionRefund).toBe(refundBefore + q.poolFeePerItem);
  });

  it("locks listing withdrawals while a request is in flight", () => {
    makeEngine();
    connect();
    engine.acquire(engineQuote());
    driveTx(3_500);
    const mine = engine.userPositions(MOCK_USER).deposited.find((l) => l.status === "active")!;
    expect(() => engine.withdrawListing(mine.id)).toThrowError(/locked while an acquisition/);
  });
});

describe("settlement", () => {
  it("keep: NFT to purchaser, net backing to depositor, listing settled", () => {
    makeEngine();
    connect();
    const allocated = engine.userPositions(MOCK_USER).allocated[0]!;
    const nftCountBefore = engine.world.ownedNfts.length;
    engine.settle(allocated.id, { kind: "keep" });
    driveTx(5_000);

    const listing = engine.world.listings.get(allocated.id)!;
    expect(listing.status).toBe("settled");
    expect(listing.settlement).toBe("kept");
    expect(engine.world.ownedNfts.length).toBe(nftCountBefore + 1);
  });

  it("accept-bid pays 85% of backing to the purchaser", () => {
    makeEngine();
    connect();
    const allocated = engine.userPositions(MOCK_USER).allocated[0]!;
    const info = engine.settlementInfo(allocated.id)!;
    expect(info.bidPayout).toBe(applyBps(allocated.backing, 8_500n));

    const balBefore = engine.balance();
    engine.settle(allocated.id, { kind: "acceptBidHype" });
    driveTx(5_000);
    expect(engine.balance()).toBe(balBefore + info.bidPayout);
    expect(engine.world.listings.get(allocated.id)!.settlement).toBe("bid_accepted");
  });

  it("token settlement is refused while the rewards module is inactive", () => {
    makeEngine();
    connect();
    const allocated = engine.userPositions(MOCK_USER).allocated[0]!;
    expect(() => engine.settle(allocated.id, { kind: "acceptBidTokens", minTokensOut: 0n })).toThrowError(
      /rewards module/,
    );
  });

  it("depositor reclaim is gated by the 24h purchaser window", () => {
    makeEngine(); // default: user's depositor-side allocation is 26h old → open
    connect();
    const dep = engine.userPositions(MOCK_USER).depositedAllocated[0]!;
    engine.settle(dep.id, { kind: "depositorReclaimBacking" });
    driveTx(5_000);
    expect(engine.world.listings.get(dep.id)!.settlement).toBe("depositor_reclaim_backing");
  });

  it("finalize opens only after 7 days", () => {
    makeEngine(); // purchaser-side allocation is 3h old
    connect();
    const allocated = engine.userPositions(MOCK_USER).allocated[0]!;
    try {
      engine.settle(allocated.id, { kind: "finalize" });
      expect.unreachable("should have thrown");
    } catch (e) {
      expect((e as ProtocolError).code).toBe("WINDOW_NOT_OPEN");
    }
  });
});

describe("claims and recovery", () => {
  it("withdraws earnings and refunds into the balance", () => {
    makeEngine();
    connect();
    const { earnings, acquisitionRefund } = engine.world.claimable;
    expect(earnings).toBeGreaterThan(0n);
    const before = engine.balance();
    engine.withdrawEarnings();
    driveTx(5_000);
    engine.withdrawAcquisitionRefund();
    driveTx(5_000);
    expect(engine.balance()).toBe(before + earnings + acquisitionRefund);
    expect(engine.world.claimable.earnings).toBe(0n);
    expect(engine.world.claimable.acquisitionRefund).toBe(0n);
  });

  it("recovers a stuck NFT on retry", () => {
    makeEngine();
    connect();
    const stuck = engine.userPositions(MOCK_USER).stuck[0]!;
    const before = engine.world.ownedNfts.length;
    engine.recoverStuckNFT(stuck.id);
    driveTx(5_000);
    expect(engine.world.ownedNfts.length).toBe(before + 1);
    expect(engine.world.listings.get(stuck.id)!.stuckRecipient).toBeUndefined();
  });
});

describe("deposit lifecycle", () => {
  it("approve → list → staged → activates when idle", () => {
    makeEngine();
    connect();
    const nft = engine.world.ownedNfts.find((n) => n.whitelisted && !n.approved)!;
    engine.approveNFT(nft.collection, nft.tokenId);
    driveTx(5_000);
    expect(nft.approved).toBe(true);

    const backing = 5n * 10n ** 17n; // 0.5 HYPE
    const balBefore = engine.balance();
    const tx = engine.listNFT(nft.collection, nft.tokenId, backing);
    driveTx(5_000);
    expect(engine.balance()).toBe(balBefore - backing);
    const listingId = BigInt(tx.meta.listingId!);
    expect(engine.world.listings.get(listingId)!.status).toBe("staged");

    vi.advanceTimersByTime(6_500); // idle activation delay
    expect(engine.world.listings.get(listingId)!.status).toBe("active");
  });

  it("refuses non-allowlisted collections and dust backing", () => {
    makeEngine();
    connect();
    const rug = engine.world.ownedNfts.find((n) => !n.whitelisted)!;
    expect(() => engine.listNFT(rug.collection, rug.tokenId, 10n ** 18n)).toThrowError(/allowlist/);

    const ok = engine.world.ownedNfts.find((n) => n.whitelisted && n.approved)!;
    try {
      engine.listNFT(ok.collection, ok.tokenId, 10n ** 15n); // 0.001 HYPE < min
      expect.unreachable("should have thrown");
    } catch (e) {
      expect((e as ProtocolError).code).toBe("BELOW_MIN_BACKING");
    }
  });
});

describe("tx machine", () => {
  it("supports wallet rejection via the dev flag", () => {
    makeEngine();
    connect();
    engine.setDevFlag("rejectNextWallet", true);
    const tx = engine.withdrawEarnings();
    vi.advanceTimersByTime(1_000);
    expect(engine.world.txs.get(tx.id)!.phase).toBe("rejected");
    // and the claimable was untouched
    expect(engine.world.claimable.earnings).toBeGreaterThan(0n);
  });

  it("supports reverts without state mutation", () => {
    makeEngine();
    connect();
    engine.setDevFlag("revertNextTx", true);
    const before = engine.world.claimable.earnings;
    const tx = engine.withdrawEarnings();
    driveTx(5_000);
    expect(engine.world.txs.get(tx.id)!.phase).toBe("reverted");
    expect(engine.world.claimable.earnings).toBe(before);
  });
});

function engineQuote() {
  return engine.quote(1, 1_000);
}
