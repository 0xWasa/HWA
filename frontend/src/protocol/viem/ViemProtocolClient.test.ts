import { afterEach, describe, expect, it, vi } from "vitest";
import type { DeploymentManifest } from "@/config/manifest";
import { nextLogDiscoveryWindow, ViemProtocolClient } from "./ViemProtocolClient";

const manifest: DeploymentManifest = {
  schemaVersion: 1,
  chainId: 999,
  deployedAtBlock: 100,
  contracts: {
    fwa: "0x0000000000000000000000000000000000000001",
    whitelist: "0x0000000000000000000000000000000000000002",
    vrfService: "0x0000000000000000000000000000000000000003",
    randomnessCoordinator: "0x0000000000000000000000000000000000000004",
    splitter: "0x0000000000000000000000000000000000000005",
  },
  features: {
    writesEnabled: false,
    depositsEnabled: false,
    acquisitionsEnabled: false,
    rewardClaimsEnabled: false,
    externalBuysEnabled: false,
    randomnessMode: "drand-bn254",
    dexMode: "projectx",
  },
  collections: [
    {
      address: "0x0000000000000000000000000000000000000010",
      name: "Hyper Test",
      symbol: "HYP",
      deploymentBlock: 1,
      testnetFixture: false,
      snapshotCollection: false,
    },
  ],
};

function response(data: unknown): Response {
  return { ok: true, json: async () => ({ data }) } as Response;
}

afterEach(() => vi.restoreAllMocks());

describe("ViemProtocolClient indexer boundary", () => {
  it("never plans an emergency log request wider than the reviewed provider range", () => {
    expect(nextLogDiscoveryWindow(100n, 50_000n, 10_000n)).toEqual({ fromBlock: 100n, toBlock: 10_099n });
    expect(nextLogDiscoveryWindow(49_000n, 50_000n, 10_000n)).toEqual({ fromBlock: 49_000n, toBlock: 50_000n });
    expect(() => nextLogDiscoveryWindow(100n, 50_000n, 50n)).toThrow(/1,000-block/);
  });

  it("fails closed instead of scanning the public RPC when no dedicated log endpoint is configured", async () => {
    const client = new ViemProtocolClient(manifest, "http://localhost:8545", 999);
    const emergencyDiscovery = client as unknown as {
      getAccountStateDirectFromLogs(account: `0x${string}`): Promise<unknown>;
    };

    await expect(
      emergencyDiscovery.getAccountStateDirectFromLogs("0x0000000000000000000000000000000000000020"),
    ).rejects.toMatchObject({ code: "INDEXER_DOWN" });
  });

  it("uses only provider-sized windows when emergency discovery is explicitly configured", async () => {
    const client = new ViemProtocolClient(
      manifest,
      "http://localhost:8545",
      999,
      "",
      "https://logs.example",
      10_000,
    );
    const getLogs = vi.fn(async (_request: { fromBlock: bigint; toBlock: bigint }) => []);
    Object.assign(client, {
      pub: { getBlockNumber: vi.fn(async () => 20_500n) },
      logPub: {
        getLogs,
      },
    });
    const emergencyDiscovery = client as unknown as {
      getAccountStateDirectFromLogs(account: `0x${string}`): Promise<{ listings: unknown[]; tickets: unknown[] }>;
    };

    await expect(
      emergencyDiscovery.getAccountStateDirectFromLogs("0x0000000000000000000000000000000000000020"),
    ).resolves.toEqual({ listings: [], tickets: [] });

    const windows = getLogs.mock.calls.map(([request]) => [request.fromBlock, request.toBlock] as const);
    expect(new Set(windows.map(([fromBlock, toBlock]) => `${fromBlock}-${toBlock}`))).toEqual(
      new Set(["100-10099", "10100-20099", "20100-20500"]),
    );
    expect(windows.every(([fromBlock, toBlock]) => toBlock - fromBlock + 1n <= 10_000n)).toBe(true);
  });

  it("maps indexed activity and keeps finality tied to the RPC head", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        response({
          activities: [
            {
              id: "event-1",
              type: "allocation",
              txHash: `0x${"11".repeat(32)}`,
              blockNumber: "120",
              timestamp: "1700000000",
              address: "0x0000000000000000000000000000000000000020",
              listingId: "7",
              collection: "0x0000000000000000000000000000000000000010",
              tokenId: "42",
              amount: "1000",
              tokenAmount: null,
            },
          ],
        }),
      ),
    );
    const client = new ViemProtocolClient(manifest, "http://localhost:8545", 999, "https://indexer.example/graphql");
    Object.assign(client, { pub: { getBlockNumber: vi.fn(async () => 125n) } });

    const page = await client.getActivity({ scope: "global", limit: 20 });

    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({
      type: "allocation",
      blockNumber: 120n,
      listingId: 7n,
      tokenId: 42n,
      amount: 1000n,
      finality: "confirmed",
    });
  });

  it("reports indexer lag independently from RPC availability", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response({ _meta: { block: { number: 100 }, hasIndexingErrors: false } })));
    const client = new ViemProtocolClient(manifest, "http://localhost:8545", 999, "https://indexer.example/graphql");
    Object.assign(client, { pub: { getBlockNumber: vi.fn(async () => 150n) } });

    await expect(client.getConnectionHealth()).resolves.toEqual({
      rpc: "ok",
      indexer: { status: "lagging", lagBlocks: 50, indexedBlock: 100n, chainBlock: 150n },
    });
  });

  it("asks the indexer for active and staged rows only in the pool explorer", async () => {
    let indexerQuery = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        indexerQuery = (JSON.parse(String(init?.body)) as { query: string }).query;
        return response({ listings: [] });
      }),
    );
    const client = new ViemProtocolClient(manifest, "http://localhost:8545", 999, "https://indexer.example/graphql");
    Object.assign(client, {
      pub: {
        readContract: vi.fn(async () => 0n),
      },
    });

    await client.getListings({ view: "deposits", sort: "value", direction: "desc", limit: 1_000 });

    expect(indexerQuery).toContain('status_in: ["active", "staged"]');
  });
  it("uses the indexer for discovery but rehydrates listing state on-chain", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        response({
          listings: [
            {
              id: "7",
              listingId: "7",
              status: "active",
              collection: "0x0000000000000000000000000000000000000010",
              tokenId: "42",
              depositor: "0x0000000000000000000000000000000000000020",
              purchaser: null,
              backing: "1000",
              weight: "100",
              listedAt: "1700000000",
              allocatedAt: null,
              acquiredFor: null,
              settlement: null,
              isCrown: true,
            },
          ],
        }),
      ),
    );
    const client = new ViemProtocolClient(manifest, "http://localhost:8545", 999, "https://indexer.example/graphql");
    const listing = [
      "0x0000000000000000000000000000000000000010",
      "0x0000000000000000000000000000000000000020",
      "0x0000000000000000000000000000000000000000",
      42n, 100n, 1_001n, 0n, 0n, 1n, 0n, 1,
    ] as const;
    const readContract = vi.fn(async ({ functionName }: { functionName: string }) => {
      if (functionName === "totalWeight") return 100n;
      throw new Error(`Unexpected read: ${functionName}`);
    });
    const multicall = vi.fn(async (_args: { contracts: unknown[] }) => [listing, 7n] as const);
    Object.assign(client, { pub: { readContract, multicall } });

    const page = await client.getListings({ view: "pool", sort: "value", direction: "desc", limit: 24, includeMetadata: false });

    expect(multicall).toHaveBeenCalledOnce();
    expect(multicall.mock.calls[0]![0].contracts).toHaveLength(2);
    expect(page.items[0]?.backing).toBe(1_001n);
    expect(page.items[0]?.listedAt).toBe(1_700_000_000);
    expect(page.items[0]?.isCrown).toBe(true);
  });
  it("refuses a pool whose indexed rows describe a different core deployment", async () => {
    // Every id resolves on both cores, so the only tell is that the struct the
    // core returns is not the NFT the indexer said that id holds.
    const rows = Array.from({ length: 8 }, (_, i) => ({
      id: `${i + 1}`,
      listingId: `${i + 1}`,
      status: "active",
      collection: "0x0000000000000000000000000000000000000010",
      tokenId: `${100 + i}`,
      depositor: "0x0000000000000000000000000000000000000020",
      purchaser: null,
      backing: "1000",
      weight: "100",
      listedAt: "1700000000",
      allocatedAt: null,
      acquiredFor: null,
      settlement: null,
      isCrown: false,
    }));
    vi.stubGlobal("fetch", vi.fn(async () => response({ listings: rows })));
    const client = new ViemProtocolClient(manifest, "http://localhost:8545", 999, "https://indexer.example/graphql");
    // The other deployment holds a different collection under the same ids.
    const foreign = [
      "0x00000000000000000000000000000000000000ff",
      "0x0000000000000000000000000000000000000020",
      "0x0000000000000000000000000000000000000000",
      999n, 100n, 5_000n, 0n, 0n, 1n, 0n, 1,
    ] as const;
    const readContract = vi.fn(async () => 0n);
    const multicall = vi.fn(async ({ contracts }: { contracts: { functionName: string }[] }) =>
      contracts.map((c) => (c.functionName === "topListingId" ? 1n : foreign)),
    );
    Object.assign(client, { pub: { readContract, multicall } });

    const page = await client.getListings({ view: "pool", sort: "value", direction: "desc", limit: 24, includeMetadata: false });

    // Fails closed onto the direct core reader: an empty pool is the honest
    // answer, and not one row of the foreign deployment reaches the UI.
    expect(page.items).toEqual([]);
    expect(readContract).toHaveBeenCalledWith(expect.objectContaining({ functionName: "nextListingId" }));
  });

  it("drops a single stale row without condemning the whole pool", async () => {
    const rows = Array.from({ length: 8 }, (_, i) => ({
      id: `${i + 1}`,
      listingId: `${i + 1}`,
      status: "active",
      collection: "0x0000000000000000000000000000000000000010",
      tokenId: `${100 + i}`,
      depositor: "0x0000000000000000000000000000000000000020",
      purchaser: null,
      backing: "1000",
      weight: "100",
      listedAt: "1700000000",
      allocatedAt: null,
      acquiredFor: null,
      settlement: null,
      isCrown: false,
    }));
    vi.stubGlobal("fetch", vi.fn(async () => response({ listings: rows })));
    const client = new ViemProtocolClient(manifest, "http://localhost:8545", 999, "https://indexer.example/graphql");
    const at = (tokenId: bigint) =>
      [
        "0x0000000000000000000000000000000000000010",
        "0x0000000000000000000000000000000000000020",
        "0x0000000000000000000000000000000000000000",
        tokenId, 100n, 1_000n, 0n, 0n, 1n, 0n, 1,
      ] as const;
    const readContract = vi.fn(async ({ functionName }: { functionName: string }) => {
      if (functionName === "totalWeight") return 800n;
      throw new Error(`Unexpected read: ${functionName}`);
    });
    let seen = 0;
    const multicall = vi.fn(async ({ contracts }: { contracts: { functionName: string }[] }) =>
      contracts.map((c) => {
        if (c.functionName === "topListingId") return 1n;
        const i = seen++;
        // One row the core has since re-used for another token.
        return at(i === 3 ? 777n : BigInt(100 + i));
      }),
    );
    Object.assign(client, { pub: { readContract, multicall } });

    const page = await client.getListings({ view: "pool", sort: "value", direction: "desc", limit: 24, includeMetadata: false });

    expect(page.items).toHaveLength(7);
  });

  it("orders the acquisition feed by when a position was drawn, not when it was deposited", async () => {
    let indexerQuery = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        indexerQuery = (JSON.parse(String(init?.body)) as { query: string }).query;
        return response({ listings: [] });
      }),
    );
    const client = new ViemProtocolClient(manifest, "http://localhost:8545", 999, "https://indexer.example/graphql");
    Object.assign(client, { pub: { readContract: vi.fn(async () => 0n) } });

    // A fresh draw on a listing deposited hours earlier must lead the feed.
    await client.getListings({ view: "recent", sort: "date", direction: "desc", limit: 24 });
    expect(indexerQuery).toContain("orderBy: allocatedAt");

    // Every other view still means deposit time by "date".
    await client.getListings({ view: "pool", sort: "date", direction: "desc", limit: 24 });
    expect(indexerQuery).toContain("orderBy: listedAt");
  });

  it("reports a token exit as a token exit on the detail view, where ownerOf cannot tell", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        response({
          listings: [
            {
              id: "113",
              listingId: "113",
              status: "settled",
              collection: "0x0000000000000000000000000000000000000010",
              tokenId: "121",
              depositor: "0x0000000000000000000000000000000000000020",
              purchaser: "0x0000000000000000000000000000000000000030",
              backing: "300",
              weight: "0",
              listedAt: "1700000000",
              allocatedAt: "1700000100",
              acquiredFor: "270",
              settlement: "bid_accepted_tokens",
              isCrown: false,
            },
          ],
        }),
      ),
    );
    const client = new ViemProtocolClient(manifest, "http://localhost:8545", 999, "https://indexer.example/graphql");
    const readContract = vi.fn(async ({ functionName }: { functionName: string }) => {
      if (functionName === "listings") {
        return [
          "0x0000000000000000000000000000000000000010",
          "0x0000000000000000000000000000000000000020",
          "0x0000000000000000000000000000000000000030",
          121n, 0n, 300n, 0n, 0n, 1n, 1_700_000_100n, 4,
        ] as const;
      }
      // The NFT went back to the depositor, which a HYPE exit does too.
      if (functionName === "ownerOf") return "0x0000000000000000000000000000000000000020";
      return 0n;
    });
    Object.assign(client, { pub: { readContract } });

    const listing = await client.getListing(113n);

    expect(listing?.settlement).toBe("bid_accepted_tokens");
  });

  it("carries the indexed settlement outcome that on-chain state cannot express", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        response({
          listings: [
            {
              id: "2",
              listingId: "2",
              status: "settled",
              collection: "0x0000000000000000000000000000000000000010",
              tokenId: "42",
              depositor: "0x0000000000000000000000000000000000000020",
              purchaser: "0x0000000000000000000000000000000000000030",
              backing: "1000",
              weight: "0",
              listedAt: "1700000000",
              allocatedAt: "1700000100",
              acquiredFor: "1200",
              settlement: "bid_accepted_tokens",
              isCrown: false,
            },
          ],
        }),
      ),
    );
    const client = new ViemProtocolClient(manifest, "http://localhost:8545", 999, "https://indexer.example/graphql");
    // Status code 4 is "settled"; the NFT is back with the depositor, which is
    // indistinguishable from a HYPE bid on-chain.
    const listing = [
      "0x0000000000000000000000000000000000000010",
      "0x0000000000000000000000000000000000000020",
      "0x0000000000000000000000000000000000000030",
      42n, 0n, 1_000n, 0n, 0n, 1n, 0n, 4,
    ] as const;
    const readContract = vi.fn(async ({ functionName }: { functionName: string }) => {
      if (functionName === "totalWeight") return 0n;
      throw new Error(`Unexpected read: ${functionName}`);
    });
    const multicall = vi.fn(async (_args: { contracts: unknown[] }) => [listing, 9n] as const);
    Object.assign(client, { pub: { readContract, multicall } });

    const page = await client.getListings({ view: "recent", sort: "value", direction: "desc", limit: 24, includeMetadata: false });

    expect(page.items[0]?.status).toBe("settled");
    expect(page.items[0]?.settlement).toBe("bid_accepted_tokens");
  });
  it("ignores an unrecognised settlement string instead of trusting the indexer blindly", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        response({
          listings: [
            {
              id: "3",
              listingId: "3",
              status: "settled",
              collection: "0x0000000000000000000000000000000000000010",
              tokenId: "43",
              depositor: "0x0000000000000000000000000000000000000020",
              purchaser: "0x0000000000000000000000000000000000000030",
              backing: "1000",
              weight: "0",
              listedAt: "1700000000",
              allocatedAt: "1700000100",
              acquiredFor: "1200",
              settlement: "rug_pulled",
              isCrown: false,
            },
          ],
        }),
      ),
    );
    const client = new ViemProtocolClient(manifest, "http://localhost:8545", 999, "https://indexer.example/graphql");
    const listing = [
      "0x0000000000000000000000000000000000000010",
      "0x0000000000000000000000000000000000000020",
      "0x0000000000000000000000000000000000000030",
      43n, 0n, 1_000n, 0n, 0n, 1n, 0n, 4,
    ] as const;
    const readContract = vi.fn(async ({ functionName }: { functionName: string }) => {
      if (functionName === "totalWeight") return 0n;
      throw new Error(`Unexpected read: ${functionName}`);
    });
    const multicall = vi.fn(async (_args: { contracts: unknown[] }) => [listing, 9n] as const);
    Object.assign(client, { pub: { readContract, multicall } });

    const page = await client.getListings({ view: "recent", sort: "value", direction: "desc", limit: 24, includeMetadata: false });

    expect(page.items[0]?.settlement).toBeUndefined();
  });
});


describe("ViemProtocolClient RPC budget", () => {
  it("reads the pool snapshot through one Multicall3 aggregation", async () => {
    const client = new ViemProtocolClient(manifest, "http://localhost:8545", 999);
    const multicall = vi.fn(async (_args: { contracts: unknown[] }) => [
      2n, 1n, 1_000n, 20n, 500n, 1n, 100n, 200n, 10n, 5n,
      86_400n, 604_800n, 8_500n, true, false, 7n, 9n, 100n, 1_000n,
    ] as const);
    Object.assign(client, {
      pub: {
        getBlock: vi.fn(async () => ({ number: 123n, timestamp: 1_700_000_000n })),
        multicall,
      },
    });
    const internals = client as unknown as {
      readQuote(): Promise<{ quote: readonly [bigint, bigint, bigint]; gasPrice: bigint }>;
    };
    vi.spyOn(internals, "readQuote").mockResolvedValue({ quote: [11n, 2n, 13n], gasPrice: 1n });

    await expect(client.getPoolSnapshot()).resolves.toMatchObject({
      blockNumber: 123n,
      activeListingCount: 2,
      stagedListingCount: 1,
      acquisitionFee: 11n,
      serviceFee: 2n,
      totalPrice: 13n,
    });
    expect(multicall).toHaveBeenCalledOnce();
    expect(multicall).toHaveBeenCalledWith(expect.objectContaining({
      allowFailure: false,
      multicallAddress: "0xcA11bde05977b3631167028862bE2a173976CA11",
      contracts: expect.arrayContaining([expect.objectContaining({ functionName: "activeListingCount" })]),
    }));
    expect(multicall.mock.calls[0]![0].contracts).toHaveLength(19);
  });
});

describe("ViemProtocolClient HWA identity boundary", () => {
  const token = "0x0000000000000000000000000000000000000021" as const;
  const pool = "0x0000000000000000000000000000000000000022" as const;
  const whype = "0x0000000000000000000000000000000000000023" as const;
  const marketManifest: DeploymentManifest = {
    ...manifest,
    contracts: { ...manifest.contracts, token, projectXPool: pool },
  };

  function marketReader(symbol: string) {
    return vi.fn(async ({ functionName }: { functionName: string }) => {
      if (functionName === "externalBuysEnabled") return false;
      if (functionName === "token0") return token;
      if (functionName === "token1") return whype;
      if (functionName === "slot0") return [2n ** 96n];
      if (functionName === "totalSupply") return 1_000_000_000n * 10n ** 18n;
      if (functionName === "name") return "Hyper World Assets";
      if (functionName === "symbol") return symbol;
      if (functionName === "decimals") return 18;
      throw new Error(`Unexpected read: ${functionName}`);
    });
  }


  function marketMulticall(symbol: string) {
    const read = marketReader(symbol);
    return vi.fn(async ({ contracts }: { contracts: { functionName: string }[] }) =>
      Promise.all(contracts.map((contract) => read(contract))),
    );
  }
  it("accepts the canonical Hyper World Assets metadata", async () => {
    const client = new ViemProtocolClient(marketManifest, "http://localhost:8545", 999);
    Object.assign(client, { pub: { multicall: marketMulticall("HWA") } });

    await expect(client.getTokenMarket()).resolves.toMatchObject({
      moduleActive: true,
      symbol: "HWA",
      tokenAddress: token,
      poolAddress: pool,
    });
  });

  it("fails closed when a manifest points to the legacy FWA token", async () => {
    const client = new ViemProtocolClient(marketManifest, "http://localhost:8545", 999);
    Object.assign(client, { pub: { multicall: marketMulticall("FWA") } });

    await expect(client.getTokenMarket()).rejects.toMatchObject({ code: "CONTRACT_MISCONFIGURED" });
  });
});

describe("ViemProtocolClient settlement slippage guard", () => {
  // `acceptBidAsTokens` spends the entire settlement payout buying HWA on a public V3 pool, so a
  // zero minimum is an unbounded-slippage order. Both settlement surfaces initialise the field to
  // 0n, which previously flowed straight through to the signed transaction.
  it("refuses a token settlement with no minimum out, before prompting a wallet", async () => {
    const client = new ViemProtocolClient(manifest, "http://localhost:8545", 999);

    await expect(
      client.settle({ listingId: 1n, choice: { kind: "acceptBidTokens", minTokensOut: 0n } }),
    ).rejects.toMatchObject({ code: "PRICE_DRIFTED" });
  });

  it("does not mistake a real minimum for a missing one", async () => {
    const client = new ViemProtocolClient(manifest, "http://localhost:8545", 999);

    // A non-zero minimum passes the guard and fails later, on the wallet requirement.
    await expect(
      client.settle({ listingId: 1n, choice: { kind: "acceptBidTokens", minTokensOut: 1n } }),
    ).rejects.toMatchObject({ code: "WALLET_NOT_CONNECTED" });
  });
});

describe("ViemProtocolClient NFT metadata hydration", () => {
  it("hydrates direct listing deep links and resolves an unmanifested collection identity", async () => {
    const collection = "0x0000000000000000000000000000000000000099" as const;
    const depositor = "0x0000000000000000000000000000000000000020" as const;
    const client = new ViemProtocolClient(manifest, "http://localhost:8545", 999);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ name: "Tiny Hyper Cat #780", imageUrl: "data:image/svg+xml;base64,PHN2Zy8+" }),
      })),
    );
    const readContract = vi.fn(async ({ functionName }: { functionName: string }) => {
      if (functionName === "listings") {
        return [collection, depositor, "0x0000000000000000000000000000000000000000", 780n, 10n, 3n, 0n, 0n, 1n, 0n, 1] as const;
      }
      if (functionName === "pendingFees") return 0n;
      if (functionName === "stuckNFTRecipient") return "0x0000000000000000000000000000000000000000";
      if (functionName === "name") return "TinyHyperCats";
      if (functionName === "symbol") return "THC";
      if (functionName === "tokenURI") return "data:application/json;base64,e30=";
      throw new Error(`Unexpected read: ${functionName}`);
    });
    Object.assign(client, { pub: { readContract } });

    await expect(client.getListing(93n)).resolves.toMatchObject({
      id: 93n,
      tokenId: 780n,
      nft: {
        name: "Tiny Hyper Cat #780",
        collectionName: "TinyHyperCats",
        collectionSymbol: "THC",
        imageUrl: "data:image/svg+xml;base64,PHN2Zy8+",
      },
    });
    expect(readContract).toHaveBeenCalledWith(expect.objectContaining({ functionName: "tokenURI", args: [780n] }));
  });
});

describe("ViemProtocolClient swap quoting", () => {
  // Live mainnet pool state, wHYPE/HWA at the 1% tier: spot is 822,383 HWA per
  // wHYPE and a 1 wHYPE buy fills at 812,478. That gap is what pins the maths
  // here, because a quote that drifts from the venue mis-sets the slippage
  // floor, and the floor is the only thing standing between a trader and a
  // sandwich on a market that moves double digits in minutes.
  const SQRT_P = 71848321534485703177456971898997n;
  const LIQUIDITY = 433857376235755102553485n;
  const WHYPE = "0x5555555555555555555555555555555555555555";

  function client() {
    const c = new ViemProtocolClient(
      { ...manifest, contracts: { ...manifest.contracts, token: "0x00000000000000000000000000000000000000aa", projectXAdapter: "0x00000000000000000000000000000000000000bb" } } as DeploymentManifest,
      "http://localhost:8545",
      999,
    );
    const readContract = vi.fn(async ({ functionName }: { functionName: string }) => {
      switch (functionName) {
        case "ROUTER": return "0x00000000000000000000000000000000000000cc";
        case "WHYPE": return WHYPE;
        case "POOL": return "0x00000000000000000000000000000000000000dd";
        case "POOL_FEE": return 10_000;
        case "slot0": return [SQRT_P, 0, 0, 0, 0, 0, true];
        case "liquidity": return LIQUIDITY;
        case "token0": return WHYPE;
        default: throw new Error(`Unexpected read: ${functionName}`);
      }
    });
    Object.assign(c, { pub: { readContract } });
    return c;
  }

  it("prices a buy within a hair of the venue and always below spot", async () => {
    const quote = await client().quoteSwap({ side: "buy", amountIn: 10n ** 18n, slippageBps: 100 });
    const out = Number(quote.amountOut) / 1e18;
    expect(out).toBeGreaterThan(810_000);
    expect(out).toBeLessThan(815_000);
    // The 1% pool fee alone puts impact above 100bps; it can never be negative.
    expect(quote.priceImpactBps).toBeGreaterThan(100);
    expect(quote.feeBps).toBe(100);
  });

  it("floors the output by the requested slippage so a swap is never unguarded", async () => {
    const quote = await client().quoteSwap({ side: "buy", amountIn: 10n ** 18n, slippageBps: 250 });
    expect(quote.minOut).toBe((quote.amountOut * 9_750n) / 10_000n);
    expect(quote.minOut).toBeGreaterThan(0n);
  });

  it("refuses to quote an amount the pool cannot fill", async () => {
    await expect(client().quoteSwap({ side: "buy", amountIn: 0n, slippageBps: 100 })).rejects.toMatchObject({
      code: "NOT_ELIGIBLE",
    });
  });
});
