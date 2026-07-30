import { afterEach, describe, expect, it, vi } from "vitest";
import type { DeploymentManifest } from "@/config/manifest";
import type { Listing } from "@/protocol/types";
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
      pub: {
        getBlockNumber: vi.fn(async () => 20_500n),
      },
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
    const liveListing: Listing = {
      id: 7n,
      status: "active",
      collection: "0x0000000000000000000000000000000000000010",
      tokenId: 42n,
      depositor: "0x0000000000000000000000000000000000000020",
      backing: 1_001n,
      weight: 100n,
      listedAt: 0,
      isCrown: false,
      pendingFees: 0n,
      nft: { name: "HYP #42", collectionName: "Hyper Test", collectionSymbol: "HYP" },
    };
    vi.spyOn(client, "getListing").mockResolvedValue(liveListing);
    Object.assign(client, { pub: { readContract: vi.fn(async () => 7n) } });

    const page = await client.getListings({ view: "pool", sort: "value", direction: "desc", limit: 24 });

    expect(page.items[0]?.backing).toBe(1_001n);
    expect(page.items[0]?.listedAt).toBe(1_700_000_000);
    expect(page.items[0]?.isCrown).toBe(true);
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

  it("accepts the canonical Hyper World Assets metadata", async () => {
    const client = new ViemProtocolClient(marketManifest, "http://localhost:8545", 999);
    Object.assign(client, { pub: { readContract: marketReader("HWA") } });

    await expect(client.getTokenMarket()).resolves.toMatchObject({
      moduleActive: true,
      symbol: "HWA",
      tokenAddress: token,
      poolAddress: pool,
    });
  });

  it("fails closed when a manifest points to the legacy FWA token", async () => {
    const client = new ViemProtocolClient(marketManifest, "http://localhost:8545", 999);
    Object.assign(client, { pub: { readContract: marketReader("FWA") } });

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
