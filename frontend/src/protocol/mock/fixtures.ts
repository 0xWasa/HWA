import { WEI, weightFromBacking } from "@/lib/units";
import type {
  ActivityItem,
  ActivityType,
  Address,
  AcquisitionTicket,
  CollectionInfo,
  Hex,
  Listing,
  OwnedNFT,
  TrackedTransaction,
} from "@/protocol/types";
import { nftArtDataUri } from "./nftArt";
import type { ScenarioConfig } from "./scenarios";

/** The entire simulated universe the mock engine operates on. */
export interface World {
  scenario: ScenarioConfig;
  bootSec: number;
  baseBlock: bigint;
  chainId: 998;
  wallet: {
    status: "disconnected" | "connecting" | "connected";
    address: Address;
    chainId: number;
    balance: bigint;
  };
  devFlags: { rejectNextWallet: boolean; revertNextTx: boolean };
  collections: CollectionInfo[];
  listings: Map<bigint, Listing>;
  nextListingId: bigint;
  nextRequestId: bigint;
  nextSequence: bigint;
  tickets: Map<bigint, AcquisitionTicket>;
  activity: ActivityItem[];
  ownedNfts: OwnedNFT[];
  claimable: {
    earnings: bigint;
    acquisitionRefund: bigint;
    crownPot: bigint;
  };
  rewardsUser: {
    depositorPending: bigint;
    depositorCredit: bigint;
    purchaserClaimable: bigint;
    purchaserBuyAllowanceHype: bigint;
    claimed: bigint;
    claimableEpochs: number[];
  };
  serviceFee: bigint;
  acquisitionsEnabled: boolean;
  txs: Map<string, TrackedTransaction>;
}

export const MOCK_USER: Address = "0xe11000000000000000000000000000000000cafe";

/**
 * Placeholder addresses for the intended first HyperEVM collections. Real
 * addresses only ever come from the deployment manifest (INTEGRATION_NEEDS §1);
 * these exist so the mock world can be browsed without a chain.
 */
export const COLLECTION_ADDR = {
  HYPURR: "0xc011ec7101000000000000000000000000000001" as Address,
  HYPIO: "0xc011ec7102000000000000000000000000000002" as Address,
  PIP: "0xc011ec7103000000000000000000000000000003" as Address,
  HYPERS: "0xc011ec7104000000000000000000000000000004" as Address,
  MADKIN: "0xc011ec7105000000000000000000000000000005" as Address,
  DRIP: "0xc011ec7106000000000000000000000000000006" as Address,
} as const;

const COLLECTION_META: Record<keyof typeof COLLECTION_ADDR, { name: string; whitelisted: boolean }> = {
  HYPURR: { name: "Hypurr", whitelisted: true },
  HYPIO: { name: "Wealthy Hypio Babies", whitelisted: true },
  PIP: { name: "PiP & Friends", whitelisted: true },
  HYPERS: { name: "Hypers", whitelisted: true },
  MADKIN: { name: "Mad Kins", whitelisted: true },
  // Not on the allowlist — demonstrates the ineligible-collection path.
  DRIP: { name: "Driploops", whitelisted: false },
};

const ACTORS: Address[] = [
  "0xa11ce00000000000000000000000000000000001",
  "0xb0b0000000000000000000000000000000000002",
  "0xca140000000000000000000000000000000003aa",
  "0xd00d000000000000000000000000000000000004",
  "0xfeed000000000000000000000000000000000005",
  "0xbeef000000000000000000000000000000000006",
];

export function actorAt(i: number): Address {
  return ACTORS[i % ACTORS.length]!;
}

export function fakeTxHash(n: bigint): Hex {
  return `0x${n.toString(16).padStart(8, "0")}${"ab".repeat(28)}` as Hex;
}

function nftMeta(symbol: keyof typeof COLLECTION_ADDR, tokenId: bigint, broken = false, missing = false) {
  return {
    name: missing ? undefined : `${COLLECTION_META[symbol].name} #${tokenId.toString()}`,
    imageUrl: broken ? "https://invalid.invalid/broken.png" : missing ? undefined : nftArtDataUri(symbol, tokenId),
    collectionName: COLLECTION_META[symbol].name,
    collectionSymbol: symbol,
  };
}

interface SeedListing {
  symbol: keyof typeof COLLECTION_ADDR;
  tokenId: number;
  backingHypeMilli: number; // backing in 1/1000 HYPE to stay integer
  depositor: Address;
  ageHours: number;
  status?: Listing["status"];
  purchaser?: Address;
  allocatedAgeSec?: number;
  pendingFeesMilli?: number;
  settlement?: Listing["settlement"];
  stuckRecipient?: Address;
  broken?: boolean;
  missingMeta?: boolean;
}

function milli(n: number): bigint {
  return (BigInt(n) * WEI) / 1000n;
}

export function buildWorld(scenario: ScenarioConfig, nowSec: number): World {
  const listings = new Map<bigint, Listing>();
  const activity: ActivityItem[] = [];
  let id = 1n;
  let block = 9_400_000n - 60_000n;

  const pushListing = (seed: SeedListing): Listing => {
    const backing = milli(seed.backingHypeMilli);
    const listing: Listing = {
      id,
      status: seed.status ?? "active",
      collection: COLLECTION_ADDR[seed.symbol],
      tokenId: BigInt(seed.tokenId),
      depositor: seed.depositor,
      purchaser: seed.purchaser,
      backing,
      weight: weightFromBacking(backing),
      listedAt: nowSec - Math.round(seed.ageHours * 3600),
      allocatedAt: seed.allocatedAgeSec !== undefined ? nowSec - seed.allocatedAgeSec : undefined,
      // Seeded acquisitions record what the purchaser paid, for the feed.
      acquiredFor: seed.allocatedAgeSec !== undefined ? (backing * 9_000n) / 10_000n : undefined,
      isCrown: false,
      pendingFees: seed.pendingFeesMilli !== undefined ? milli(seed.pendingFeesMilli) : 0n,
      stuckRecipient: seed.stuckRecipient,
      settlement: seed.settlement,
      nft: nftMeta(seed.symbol, BigInt(seed.tokenId), seed.broken, seed.missingMeta),
    };
    listings.set(id, listing);
    id += 1n;
    return listing;
  };

  const pushActivity = (
    type: ActivityType,
    ageSec: number,
    fields: Partial<Omit<ActivityItem, "id" | "type" | "timestamp" | "finality" | "txHash" | "blockNumber">> = {},
  ) => {
    block += 7n;
    const ts = nowSec - ageSec;
    activity.push({
      id: `seed-${activity.length}`,
      type,
      txHash: fakeTxHash(block),
      blockNumber: block,
      timestamp: ts,
      finality: ageSec > 90 ? "confirmed" : "indexed",
      ...fields,
    });
  };

  // ---------------------------------------------------------------- pool
  if (!scenario.emptyPool) {
    // Broad, believable pool: backings from 0.01 to 150 HYPE.
    const poolSeeds: SeedListing[] = [
      { symbol: "HYPURR", tokenId: 214, backingHypeMilli: 150_000, depositor: actorAt(0), ageHours: 310 }, // crown
      { symbol: "HYPERS", tokenId: 7, backingHypeMilli: 64_000, depositor: actorAt(1), ageHours: 250 },
      { symbol: "MADKIN", tokenId: 88, backingHypeMilli: 32_500, depositor: actorAt(2), ageHours: 190 },
      { symbol: "HYPIO", tokenId: 456, backingHypeMilli: 18_000, depositor: actorAt(3), ageHours: 170 },
      { symbol: "PIP", tokenId: 12, backingHypeMilli: 9_800, depositor: actorAt(4), ageHours: 122 },
      { symbol: "HYPURR", tokenId: 519, backingHypeMilli: 7_400, depositor: actorAt(5), ageHours: 96 },
      { symbol: "HYPIO", tokenId: 1043, backingHypeMilli: 5_000, depositor: actorAt(0), ageHours: 90 },
      { symbol: "HYPERS", tokenId: 133, backingHypeMilli: 3_600, depositor: actorAt(1), ageHours: 76 },
      { symbol: "MADKIN", tokenId: 501, backingHypeMilli: 2_450, depositor: actorAt(2), ageHours: 61, broken: true },
      { symbol: "PIP", tokenId: 77, backingHypeMilli: 1_900, depositor: actorAt(3), ageHours: 55 },
      { symbol: "HYPURR", tokenId: 731, backingHypeMilli: 1_310, depositor: actorAt(4), ageHours: 47 },
      { symbol: "HYPIO", tokenId: 92, backingHypeMilli: 980, depositor: actorAt(5), ageHours: 40 },
      { symbol: "HYPERS", tokenId: 245, backingHypeMilli: 720, depositor: actorAt(0), ageHours: 33, missingMeta: true },
      { symbol: "MADKIN", tokenId: 350, backingHypeMilli: 540, depositor: actorAt(1), ageHours: 28 },
      { symbol: "PIP", tokenId: 208, backingHypeMilli: 400, depositor: actorAt(2), ageHours: 22 },
      { symbol: "HYPURR", tokenId: 902, backingHypeMilli: 260, depositor: actorAt(3), ageHours: 18 },
      { symbol: "HYPIO", tokenId: 611, backingHypeMilli: 150, depositor: actorAt(4), ageHours: 14 },
      { symbol: "HYPERS", tokenId: 512, backingHypeMilli: 90, depositor: actorAt(5), ageHours: 11 },
      { symbol: "MADKIN", tokenId: 129, backingHypeMilli: 60, depositor: actorAt(0), ageHours: 8 },
      { symbol: "PIP", tokenId: 333, backingHypeMilli: 35, depositor: actorAt(1), ageHours: 6 },
      { symbol: "HYPIO", tokenId: 274, backingHypeMilli: 20, depositor: actorAt(2), ageHours: 4 },
      { symbol: "HYPURR", tokenId: 1105, backingHypeMilli: 10, depositor: actorAt(3), ageHours: 2 },
      // Freshly staged deposits (not yet in the selection pool)
      { symbol: "HYPERS", tokenId: 618, backingHypeMilli: 5_500, depositor: actorAt(4), ageHours: 0.4, status: "staged" },
      { symbol: "MADKIN", tokenId: 47, backingHypeMilli: 300, depositor: actorAt(5), ageHours: 0.2, status: "staged" },
    ];
    for (const seed of poolSeeds) pushListing(seed);
  }

  // ------------------------------------------------------------- user set
  const userL: bigint[] = [];
  if (scenario.userHasHistory && !scenario.emptyPool) {
    // Active deposits by the user
    userL.push(
      pushListing({
        symbol: "HYPURR",
        tokenId: 42,
        backingHypeMilli: 40_000,
        depositor: MOCK_USER,
        ageHours: 140,
        pendingFeesMilli: 610,
      }).id,
    );
    userL.push(
      pushListing({
        symbol: "HYPIO",
        tokenId: 65,
        backingHypeMilli: 2_100,
        depositor: MOCK_USER,
        ageHours: 52,
        pendingFeesMilli: 84,
      }).id,
    );
    userL.push(
      pushListing({
        symbol: "HYPERS",
        tokenId: 909,
        backingHypeMilli: 450,
        depositor: MOCK_USER,
        ageHours: 0.3,
        status: "staged",
      }).id,
    );

    // Allocated TO the user (purchaser side) — drives the settlement demo.
    pushListing({
      symbol: "PIP",
      tokenId: 555,
      backingHypeMilli: 6_200,
      depositor: actorAt(1),
      ageHours: 130,
      status: "allocated",
      purchaser: MOCK_USER,
      allocatedAgeSec: scenario.allocatedAgeSec,
    });

    // User is depositor of a listing allocated to someone else >24h ago
    pushListing({
      symbol: "MADKIN",
      tokenId: 233,
      backingHypeMilli: 1_150,
      depositor: MOCK_USER,
      ageHours: 200,
      status: "allocated",
      purchaser: actorAt(2),
      allocatedAgeSec: 26 * 3600,
    });

    // Stuck NFT: settlement paid out, delivery failed, user can retry
    pushListing({
      symbol: "HYPIO",
      tokenId: 313,
      backingHypeMilli: 780,
      depositor: actorAt(3),
      ageHours: 400,
      status: "settled",
      purchaser: MOCK_USER,
      allocatedAgeSec: 5 * 24 * 3600,
      settlement: "kept",
      stuckRecipient: MOCK_USER,
    });

    // Settled history
    pushListing({
      symbol: "HYPERS",
      tokenId: 21,
      backingHypeMilli: 3_200,
      depositor: MOCK_USER,
      ageHours: 500,
      status: "settled",
      purchaser: actorAt(4),
      allocatedAgeSec: 12 * 24 * 3600,
      settlement: "bid_accepted",
    });
    pushListing({
      symbol: "HYPURR",
      tokenId: 77,
      backingHypeMilli: 900,
      depositor: actorAt(5),
      ageHours: 420,
      status: "settled",
      purchaser: MOCK_USER,
      allocatedAgeSec: 9 * 24 * 3600,
      settlement: "kept",
    });
    pushListing({
      symbol: "PIP",
      tokenId: 404,
      backingHypeMilli: 1_500,
      depositor: MOCK_USER,
      ageHours: 610,
      status: "settled",
      purchaser: actorAt(0),
      allocatedAgeSec: 20 * 24 * 3600,
      settlement: "finalized",
    });
  }

  // Crown: highest-backed active listing
  let crownId: bigint | undefined;
  let crownBacking = -1n;
  for (const l of listings.values()) {
    if (l.status === "active" && l.backing > crownBacking) {
      crownBacking = l.backing;
      crownId = l.id;
    }
  }
  if (crownId !== undefined) listings.get(crownId)!.isCrown = true;

  // --------------------------------------------------------- activity feed
  if (!scenario.emptyPool) {
    const feed: [ActivityType, number, Partial<ActivityItem>][] = [
      ["deposit", 36_000, { address: actorAt(4), listingId: 23n, amount: milli(5_500) }],
      ["activation", 34_000, { address: actorAt(4), listingId: 23n }],
      ["acquisition_request", 30_500, { address: actorAt(2), amount: milli(3_950) }],
      ["randomness_cached", 30_420, { address: actorAt(2) }],
      ["allocation", 30_300, { address: actorAt(2), listingId: 9n, amount: milli(2_450) }],
      ["bid_accepted", 28_600, { address: actorAt(2), listingId: 9n, amount: milli(2_082) }],
      ["deposit", 26_000, { address: MOCK_USER, listingId: userL[2] ?? 27n, amount: milli(450) }],
      ["acquisition_request", 21_500, { address: actorAt(5), amount: milli(3_890) }],
      ["allocation", 21_300, { address: actorAt(5), listingId: 17n, amount: milli(150) }],
      ["keep", 20_100, { address: actorAt(5), listingId: 17n }],
      ["crown_set", 18_000, { address: actorAt(0), listingId: crownId, amount: crownBacking > 0n ? crownBacking : undefined }],
      ["deposit", 12_400, { address: actorAt(5), listingId: 24n, amount: milli(300) }],
      ["withdraw_listing", 9_800, { address: actorAt(3), listingId: 4n, amount: milli(18_000) }],
      ["acquisition_request", 6_400, { address: actorAt(1), amount: milli(3_910) }],
      ["acquisition_refund", 6_100, { address: actorAt(1), amount: milli(3_780) }],
      ["earnings_withdraw", 3_700, { address: actorAt(0), amount: milli(1_240) }],
      ["deposit", 1_400, { address: actorAt(4), listingId: 23n, amount: milli(5_500) }],
      ["acquisition_request", 55, { address: actorAt(3), amount: milli(3_960) }],
    ];
    for (const [type, age, fields] of feed) pushActivity(type, age, fields);
  }

  // ------------------------------------------------------------ owned NFTs
  const ownedNfts: OwnedNFT[] = scenario.emptyPool
    ? []
    : [
        {
          collection: COLLECTION_ADDR.HYPERS,
          tokenId: 1201n,
          whitelisted: true,
          approved: false,
          nft: nftMeta("HYPERS", 1201n),
        },
        {
          collection: COLLECTION_ADDR.HYPURR,
          tokenId: 640n,
          whitelisted: true,
          approved: false,
          nft: nftMeta("HYPURR", 640n),
        },
        {
          collection: COLLECTION_ADDR.MADKIN,
          tokenId: 15n,
          whitelisted: true,
          approved: true,
          nft: nftMeta("MADKIN", 15n),
        },
        {
          collection: COLLECTION_ADDR.HYPIO,
          tokenId: 2077n,
          whitelisted: true,
          approved: false,
          nft: nftMeta("HYPIO", 2077n, true), // broken image in the picker
        },
        {
          collection: COLLECTION_ADDR.DRIP,
          tokenId: 8n,
          whitelisted: false,
          approved: false,
          nft: nftMeta("DRIP", 8n),
        },
      ];

  return {
    scenario,
    bootSec: nowSec,
    baseBlock: 9_400_000n,
    chainId: 998,
    wallet: {
      status: "disconnected",
      address: MOCK_USER,
      chainId: scenario.walletChainId,
      balance: scenario.balanceHype,
    },
    devFlags: { rejectNextWallet: false, revertNextTx: false },
    collections: (Object.keys(COLLECTION_ADDR) as (keyof typeof COLLECTION_ADDR)[]).map((symbol) => ({
      address: COLLECTION_ADDR[symbol],
      name: COLLECTION_META[symbol].name,
      symbol,
      whitelisted: COLLECTION_META[symbol].whitelisted,
    })),
    listings,
    nextListingId: id,
    nextRequestId: 7_001n,
    nextSequence: 91n,
    tickets: new Map(),
    activity,
    ownedNfts,
    claimable: {
      earnings: scenario.userHasHistory ? milli(1_830) : 0n,
      acquisitionRefund: scenario.userHasHistory ? milli(420) : 0n,
      crownPot: 0n,
    },
    rewardsUser: scenario.rewardsActive
      ? {
          depositorPending: 42_318n * WEI,
          depositorCredit: 1_204n * WEI,
          purchaserClaimable: 9_876n * WEI,
          purchaserBuyAllowanceHype: milli(8),
          claimed: 3_500n * WEI,
          claimableEpochs: [1, 2],
        }
      : {
          depositorPending: 0n,
          depositorCredit: 0n,
          purchaserClaimable: 0n,
          purchaserBuyAllowanceHype: 0n,
          claimed: 0n,
          claimableEpochs: [],
        },
    serviceFee: milli(2), // 0.002 HYPE — placeholder randomness service cost (see INTEGRATION_NEEDS.md)
    acquisitionsEnabled: !scenario.emptyPool,
    txs: new Map(),
  };
}

/** Crown pot shown on the featured card (accrues during the session). */
export const INITIAL_CROWN_POT = (21n * WEI) / 10n; // 2.1 HYPE
