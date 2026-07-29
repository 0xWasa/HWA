import { getAccount } from "wagmi/actions";
import {
  createPublicClient,
  createWalletClient,
  custom,
  decodeFunctionResult,
  encodeFunctionData,
  http,
  parseAbiItem,
  type EIP1193Provider,
  type Hash,
  type PublicClient,
} from "viem";
import { chainById } from "@/config/chains";
import { HWA_NFT_DEPOSITS_PAUSED, HWA_REWARD_CLAIMS_PAUSED } from "@/config/featureFlags";
import type { DeploymentManifest } from "@/config/manifest";
import { wagmiConfig } from "@/wallet/wagmi";
import { ProtocolError } from "@/protocol/errors";
import { rarityFromOdds } from "@/protocol/rarity";
import type { ProtocolClient, ProtocolEvent } from "@/protocol/client";
import type {
  AcquisitionQuote,
  AcquisitionTicket,
  ActivityItem,
  ActivityQuery,
  Address,
  CollectionInfo,
  ConnectionHealth,
  Hex,
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
  TxKind,
  TxPhase,
  UserPositions,
} from "@/protocol/types";
import {
  erc20Abi,
  erc721Abi,
  fwaCoreAbi,
  fwaRewardsAbi,
  LISTING_STATUS_BY_CODE,
  v3PoolAbi,
  splitterAbi,
} from "./abi";
import { hypePerHwaFromSqrtPrice } from "./price";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as Address;
const MAX_ENUMERATED_LISTINGS = 1_000n;
const INDEXER_PAGE_SIZE = 200;
const MAX_INDEXER_PAGES = 25;
const MAX_REWARD_EPOCH_SCAN = 1_024;
const MAX_UNINDEXED_SNAPSHOT_SCAN = 1_000n;
const MIN_DEDICATED_LOG_RANGE_BLOCKS = 1_000n;
const MAX_LOG_DISCOVERY_BLOCK_SPAN = 50_000_000n;
const MAX_ACCOUNT_LOG_RESULTS = 5_000;
const HWA_TOKEN_NAME = "Hyper World Assets";
const HWA_TOKEN_SYMBOL = "HWA";
const HWA_TOKEN_DECIMALS = 18;
const NFT_LISTED_EVENT = parseAbiItem(
  "event NFTListed(uint256 indexed listingId, uint256 indexed slot, address indexed depositor, address collection, uint256 tokenId, uint256 weight, uint256 value)",
);
const LISTING_STAGED_EVENT = parseAbiItem(
  "event ListingStaged(uint256 indexed listingId, address indexed depositor, address collection, uint256 tokenId, uint256 value, uint256 stagedAtBlock)",
);
const NFT_ALLOCATED_EVENT = parseAbiItem(
  "event NFTAllocated(uint256 indexed requestId, uint256 indexed listingId, address indexed purchaser, address depositor, uint256 value, uint256 randomWord)",
);
const ACQUISITION_REQUESTED_EVENT = parseAbiItem(
  "event AcquisitionRequested(uint256 indexed requestId, address indexed purchaser, uint256 acquisitionFee, uint256 totalWeight)",
);
// Hyperliquid's public EVM RPC is IP-rate-limited. The live screen fans out
// several independent contract reads at once, so coalesce them into a single
// JSON-RPC batch instead of spending one HTTP request per field.
const RPC_TRANSPORT_OPTIONS = {
  batch: { batchSize: 40, wait: 20 },
  retryCount: 2,
  retryDelay: 500,
} as const;

// Wallet discovery can surface hundreds of NFTs at once. Pace metadata calls
// so a legitimate collection view does not trip the public Nginx/API limits or
// create hundreds of simultaneous upstream IPFS requests.
const NFT_METADATA_MAX_CONCURRENCY = 8;
const NFT_METADATA_START_INTERVAL_MS = 50;
type MetadataJob<T> = {
  run: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
};
const metadataJobs: MetadataJob<unknown>[] = [];
let activeMetadataJobs = 0;
let lastMetadataJobStartedAt = 0;
let metadataDrainTimer: ReturnType<typeof setTimeout> | undefined;

function drainMetadataJobs(): void {
  if (metadataDrainTimer || activeMetadataJobs >= NFT_METADATA_MAX_CONCURRENCY || metadataJobs.length === 0) return;
  const delay = Math.max(0, lastMetadataJobStartedAt + NFT_METADATA_START_INTERVAL_MS - Date.now());
  if (delay > 0) {
    metadataDrainTimer = setTimeout(() => {
      metadataDrainTimer = undefined;
      drainMetadataJobs();
    }, delay);
    return;
  }
  const job = metadataJobs.shift()!;
  activeMetadataJobs += 1;
  lastMetadataJobStartedAt = Date.now();
  void job.run().then(job.resolve, job.reject).finally(() => {
    activeMetadataJobs -= 1;
    drainMetadataJobs();
  });
  drainMetadataJobs();
}

function scheduleMetadataRequest<T>(run: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    metadataJobs.push({ run, resolve, reject } as MetadataJob<unknown>);
    drainMetadataJobs();
  });
}

function sameAddress(a: Address | undefined, b: Address | undefined): boolean {
  return !!a && !!b && a.toLowerCase() === b.toLowerCase();
}

function nowSec(): number {
  return Math.floor(Date.now() / 1_000);
}

function txId(): string {
  return `live-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

interface GraphListingRow {
  id: string;
  listingId: string;
  status: string;
  collection: string;
  tokenId: string;
  tokenURI?: string | null;
  depositor: string;
  purchaser?: string | null;
  backing: string;
  weight: string;
  listedAt: string;
  allocatedAt?: string | null;
  acquiredFor?: string | null;
  settlement?: string | null;
  isCrown: boolean;
}

interface GraphActivityRow {
  id: string;
  type: ActivityItem["type"];
  txHash: string;
  blockNumber: string;
  timestamp: string;
  address?: string | null;
  listingId?: string | null;
  collection?: string | null;
  tokenId?: string | null;
  amount?: string | null;
  tokenAmount?: string | null;
}

interface GraphAcquisitionRow {
  requestId: string;
  purchaser: string;
  acquisitionFee: string;
  sequence?: string | null;
  wordDeadlineBlock?: string | null;
  status: "pending" | "ready" | "fulfilled" | "expired" | "refunded" | "timed_out";
  listingId?: string | null;
  refund?: string | null;
  requestedAt: string;
  requestedBlock: string;
  txHash: string;
  context: { serviceFeeTotal: string; requestCount: number };
}

interface GraphMeta {
  block: { number: number };
  hasIndexingErrors: boolean;
}

interface GraphOwnedTokenRow {
  collection: string;
  tokenId: string;
  owner: string;
  tokenURI?: string | null;
}

interface LogDiscoveryCheckpoint {
  deploymentBlock: string;
  nextBlock: string;
  listingIds: string[];
  requestHashes: [string, Hex][];
}

export function nextLogDiscoveryWindow(fromBlock: bigint, head: bigint, maxBlockRange: bigint) {
  if (maxBlockRange < MIN_DEDICATED_LOG_RANGE_BLOCKS) {
    throw new Error("Dedicated log RPC range is below the 1,000-block production minimum.");
  }
  const candidate = fromBlock + maxBlockRange - 1n;
  return { fromBlock, toBlock: candidate > head ? head : candidate };
}

/**
 * HyperEVM live client. Critical reads and every pre-signature guard come
 * directly from chain 998/999. Until a standalone indexer exists, the small
 * testnet fixture set is enumerated through `nextListingId` and the manifest's
 * bounded collection token ranges.
 */
export class ViemProtocolClient implements ProtocolClient {
  readonly kind = "viem" as const;
  private pub: PublicClient;
  private logPub?: PublicClient;
  private logRpcMaxBlockRange = 0n;
  private listeners = new Set<(event: ProtocolEvent) => void>();
  private txs: TrackedTransaction[] = [];
  private receiptWatchers = new Set<string>();
  private metadataCache = new Map<string, Promise<{ name?: string; imageUrl?: string }>>();

  constructor(
    private manifest: DeploymentManifest,
    rpcUrl: string,
    private chainId: 998 | 999,
    private indexerUrl = "",
    logRpcUrl = "",
    logRpcMaxBlockRange = 0,
  ) {
    this.pub = createPublicClient({
      chain: chainById(chainId),
      transport: http(rpcUrl || undefined, RPC_TRANSPORT_OPTIONS),
    });
    if (logRpcUrl && logRpcMaxBlockRange >= Number(MIN_DEDICATED_LOG_RANGE_BLOCKS)) {
      this.logPub = createPublicClient({
        chain: chainById(chainId),
        transport: http(logRpcUrl, RPC_TRANSPORT_OPTIONS),
      });
      this.logRpcMaxBlockRange = BigInt(logRpcMaxBlockRange);
    }
    this.loadTransactions();
  }

  private logCheckpointKey(account: Address): string {
    return `hwa:log-discovery:${this.chainId}:${this.core.toLowerCase()}:${account.toLowerCase()}`;
  }

  private loadLogCheckpoint(account: Address, deploymentBlock: bigint): LogDiscoveryCheckpoint | null {
    if (typeof window === "undefined") return null;
    try {
      const raw = window.localStorage.getItem(this.logCheckpointKey(account));
      if (!raw) return null;
      const parsed = JSON.parse(raw) as LogDiscoveryCheckpoint;
      if (parsed.deploymentBlock !== deploymentBlock.toString()) return null;
      if (!Array.isArray(parsed.listingIds) || !Array.isArray(parsed.requestHashes)) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  private saveLogCheckpoint(account: Address, checkpoint: LogDiscoveryCheckpoint | null): void {
    if (typeof window === "undefined") return;
    try {
      if (checkpoint) window.localStorage.setItem(this.logCheckpointKey(account), JSON.stringify(checkpoint));
      else window.localStorage.removeItem(this.logCheckpointKey(account));
    } catch {
      // Storage can be disabled or full. Discovery remains correct, but resumes from deployment.
    }
  }

  private async indexerQuery<T>(query: string): Promise<T> {
    if (!this.indexerUrl) throw new ProtocolError("INDEXER_DOWN", "The event indexer is not configured.");
    try {
      const response = await fetch(this.indexerUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query }),
        cache: "no-store",
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = (await response.json()) as { data?: T; errors?: { message?: string }[] };
      if (!payload.data || payload.errors?.length) {
        throw new Error(payload.errors?.[0]?.message ?? "Indexer returned no data");
      }
      return payload.data;
    } catch (error) {
      throw new ProtocolError(
        "INDEXER_DOWN",
        "The event indexer did not answer. Transaction-critical reads still use the chain.",
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  private async assertIndexerHealthyForCriticalDiscovery(): Promise<void> {
    if (!this.indexerUrl) return;
    const [result, chainBlock] = await Promise.all([
      this.indexerQuery<{ _meta: GraphMeta }>("{ _meta { block { number } hasIndexingErrors } }"),
      this.pub.getBlockNumber(),
    ]);
    const indexedBlock = BigInt(result._meta.block.number);
    const lag = chainBlock > indexedBlock ? chainBlock - indexedBlock : 0n;
    if (result._meta.hasIndexingErrors || lag > 20n) {
      throw new ProtocolError(
        "INDEXER_DOWN",
        `Position discovery is fail-closed because the indexer is ${lag.toString()} blocks behind or reports errors.`,
      );
    }
  }

  private async indexedListingRows(input: {
    where?: string[];
    first?: number;
    skip?: number;
    orderBy?: "backing" | "weight" | "listedAt" | "listingId";
    direction?: "asc" | "desc";
  }): Promise<GraphListingRow[]> {
    const first = Math.max(1, Math.min(input.first ?? INDEXER_PAGE_SIZE, 1_000));
    const skip = Math.max(0, input.skip ?? 0);
    const orderBy = input.orderBy ?? "listedAt";
    const direction = input.direction ?? "desc";
    const where = input.where?.length ? `, where: { ${input.where.join(", ")} }` : "";
    const data = await this.indexerQuery<{ listings: GraphListingRow[] }>(`{
      listings(first: ${first}, skip: ${skip}, orderBy: ${orderBy}, orderDirection: ${direction}${where}) {
        id listingId status collection tokenId tokenURI depositor purchaser backing weight listedAt allocatedAt
        acquiredFor settlement isCrown
      }
    }`);
    return data.listings;
  }

  private async hydrateIndexedListing(row: GraphListingRow): Promise<Listing | null> {
    const listing = await this.getListing(BigInt(row.listingId));
    if (!listing) return null;
    listing.listedAt = Number(row.listedAt);
    // Economic outcome, settlement and crown state stay on-chain-derived. Indexer values are
    // discovery hints only and never overwrite a core/ownerOf read.
    try {
      const tokenURI = await this.pub.readContract({
        address: listing.collection,
        abi: erc721Abi,
        functionName: "tokenURI",
        args: [listing.tokenId],
      });
      const metadata = await this.resolveNFTMetadata(tokenURI);
      listing.nft.name = metadata.name ?? listing.nft.name;
      listing.nft.imageUrl = metadata.imageUrl;
    } catch {
      // Metadata is display-only. The listing's identity and all transaction
      // guards remain sourced from the core and ERC-721 ownership reads.
    }
    return listing;
  }

  private async hydrateIndexedListings(rows: GraphListingRow[]): Promise<Listing[]> {
    const [items, topId] = await Promise.all([
      Promise.all(rows.map((row) => this.hydrateIndexedListing(row))),
      this.pub.readContract({ address: this.core, abi: fwaCoreAbi, functionName: "topListingId" }),
    ]);
    const listings = items.filter((listing): listing is Listing => listing !== null);
    for (const listing of listings) listing.isCrown = listing.id === topId;
    return listings;
  }

  private resolveNFTMetadata(tokenURI: string): Promise<{ name?: string; imageUrl?: string }> {
    const existing = this.metadataCache.get(tokenURI);
    if (existing) return existing;
    const request = scheduleMetadataRequest(() =>
      fetch(`/api/nft-metadata?uri=${encodeURIComponent(tokenURI)}`, { cache: "force-cache" }),
    )
      .then(async (response) => {
        if (!response.ok) return {};
        const value = (await response.json()) as { name?: unknown; imageUrl?: unknown };
        return {
          name: typeof value.name === "string" ? value.name : undefined,
          imageUrl: typeof value.imageUrl === "string" ? value.imageUrl : undefined,
        };
      })
      .catch(() => ({}));
    this.metadataCache.set(tokenURI, request);
    return request;
  }

  private get core(): Address {
    return this.manifest.contracts.fwa;
  }

  private emit(event: ProtocolEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  private collectionInfo(address: Address): CollectionInfo | undefined {
    const item = this.manifest.collections.find((collection) => sameAddress(collection.address, address));
    return item
      ? { address: item.address, name: item.name, symbol: item.symbol, whitelisted: true }
      : undefined;
  }

  private storageKey(): string {
    return `fwa:live-transactions:${this.chainId}:${this.core.toLowerCase()}`;
  }

  private loadTransactions(): void {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(this.storageKey());
      if (!raw) return;
      const parsed = JSON.parse(raw) as TrackedTransaction[];
      this.txs = parsed.filter((tx) => tx && typeof tx.id === "string" && typeof tx.phase === "string").slice(0, 30);
    } catch {
      this.txs = [];
    }
  }

  private persistTransactions(): void {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(this.storageKey(), JSON.stringify(this.txs.slice(0, 30)));
  }

  private createTransaction(kind: TxKind, label: string, meta: Record<string, string>): TrackedTransaction {
    const timestamp = nowSec();
    const tx: TrackedTransaction = {
      id: txId(),
      kind,
      label,
      phase: "wallet",
      createdAt: timestamp,
      updatedAt: timestamp,
      meta,
    };
    this.txs.unshift(tx);
    this.persistTransactions();
    this.emit({ scope: "tx", txId: tx.id });
    return tx;
  }

  private updateTransaction(
    id: string,
    patch: Partial<Pick<TrackedTransaction, "phase" | "hash" | "error">>,
  ): TrackedTransaction {
    const index = this.txs.findIndex((tx) => tx.id === id);
    if (index < 0) throw new Error(`Unknown transaction ${id}`);
    const updated = { ...this.txs[index]!, ...patch, updatedAt: nowSec() };
    this.txs[index] = updated;
    this.persistTransactions();
    this.emit({ scope: "tx", txId: id });
    return updated;
  }

  private async connectedWallet() {
    const state = getAccount(wagmiConfig);
    if (!state.address || state.status !== "connected") {
      throw new ProtocolError("WALLET_NOT_CONNECTED", "Connect a wallet to continue.");
    }
    if (state.chainId !== this.chainId) {
      throw new ProtocolError("WRONG_NETWORK", `Switch the wallet to HyperEVM chain ${this.chainId}.`);
    }
    const injected = (window as unknown as { ethereum?: EIP1193Provider }).ethereum;
    if (!injected) throw new ProtocolError("WALLET_NOT_CONNECTED", "No injected wallet provider is available.");
    const account = state.address as Address;
    const rawWallet = createWalletClient({ account, chain: chainById(this.chainId), transport: custom(injected) });
    const wallet = {
      writeContract: async (request: {
        account: Address;
        address: Address;
        abi: readonly unknown[];
        functionName: string;
        args?: readonly unknown[];
        value?: bigint;
        gasPrice?: bigint;
      }): Promise<Hash> => {
        // Simulate against the authoritative public RPC before opening the
        // wallet prompt. This catches stale guards, permissions and reverts
        // without asking the user to sign a transaction that cannot succeed.
        const simulation = await this.pub.simulateContract(request as never);
        return rawWallet.writeContract(simulation.request as never);
      },
    };
    return { wallet, account };
  }

  private normalizeWriteError(error: unknown): ProtocolError {
    const message = error instanceof Error ? error.message : String(error);
    if (/user rejected|rejected the request|denied transaction signature/i.test(message)) {
      return new ProtocolError("USER_REJECTED", "The wallet request was rejected.", message);
    }
    if (/insufficient funds/i.test(message)) {
      return new ProtocolError("INSUFFICIENT_BALANCE", "Not enough HYPE for value and gas.", message);
    }
    if (/AcquisitionsNotEnabled/i.test(message)) {
      return new ProtocolError("ACQUISITIONS_DISABLED", "Acquisitions are operator-paused.", message);
    }
    if (/timed?\s*out|timeout|deadline exceeded|network.*unreachable|fetch failed/i.test(message)) {
      return new ProtocolError(
        "RPC_DOWN",
        "Receipt confirmation timed out. The transaction outcome is unknown; check the explorer before retrying.",
        message,
      );
    }
    return new ProtocolError("REVERTED", "The on-chain call failed. Open technical details for the revert.", message);
  }

  private async followReceipt(tx: TrackedTransaction): Promise<TrackedTransaction> {
    if (!tx.hash || this.receiptWatchers.has(tx.id)) return tx;
    this.receiptWatchers.add(tx.id);
    try {
      this.updateTransaction(tx.id, { phase: "confirming" });
      const receipt = await this.pub.waitForTransactionReceipt({
        hash: tx.hash,
        confirmations: 1,
        onReplaced: (replacement) => {
          this.updateTransaction(tx.id, { hash: replacement.transaction.hash as Hash, phase: "submitted" });
        },
      });
      if (receipt.status !== "success") {
        throw new ProtocolError("REVERTED", "Transaction reverted on-chain.", tx.hash);
      }
      const completed = this.updateTransaction(tx.id, { phase: "completed" });
      this.emit({ scope: "pool" });
      this.emit({ scope: "listings" });
      this.emit({ scope: "positions" });
      this.emit({ scope: "rewards" });
      return completed;
    } catch (error) {
      const normalized = error instanceof ProtocolError ? error : this.normalizeWriteError(error);
      return this.updateTransaction(tx.id, {
        phase: normalized.code === "USER_REJECTED" ? "rejected" : normalized.code === "RPC_DOWN" ? "timeout" : "reverted",
        error: { title: normalized.message, raw: normalized.raw },
      });
    } finally {
      this.receiptWatchers.delete(tx.id);
    }
  }

  private async executeWrite(
    kind: TxKind,
    label: string,
    meta: Record<string, string>,
    submit: () => Promise<Hash>,
    allowInReadOnly = false,
  ): Promise<TrackedTransaction> {
    if (!this.manifest.features.writesEnabled && !allowInReadOnly) {
      throw new ProtocolError("NOT_ELIGIBLE", "This deployment is in read-only mode.");
    }
    const tx = this.createTransaction(kind, label, meta);
    try {
      const hash = await submit();
      const submitted = this.updateTransaction(tx.id, { hash, phase: "submitted" });
      const terminal = await this.followReceipt(submitted);
      if (terminal.phase === "reverted" || terminal.phase === "rejected" || terminal.phase === "timeout") {
        throw new ProtocolError(
          terminal.phase === "rejected" ? "USER_REJECTED" : terminal.phase === "timeout" ? "RPC_DOWN" : "REVERTED",
          terminal.error?.title ?? "Transaction failed.",
          terminal.error?.raw,
        );
      }
      return terminal;
    } catch (error) {
      const existing = this.txs.find((item) => item.id === tx.id);
      if (existing?.phase === "reverted" || existing?.phase === "rejected" || existing?.phase === "timeout") throw error;
      const normalized = this.normalizeWriteError(error);
      this.updateTransaction(tx.id, {
        phase: normalized.code === "USER_REJECTED" ? "rejected" : normalized.code === "RPC_DOWN" ? "timeout" : "reverted",
        error: { title: normalized.message, raw: normalized.raw },
      });
      throw normalized;
    }
  }

  private async readQuote() {
    const gasPrice = await this.pub.getGasPrice();
    const data = encodeFunctionData({
      abi: fwaCoreAbi,
      functionName: "quoteAcquisitionPrice",
    });
    const call = await this.pub.call({
      to: this.core,
      data,
      gasPrice,
      account: ZERO_ADDRESS,
    });
    if (!call.data) throw new ProtocolError("RPC_DOWN", "The RPC returned an empty acquisition quote.");
    const quote = decodeFunctionResult({ abi: fwaCoreAbi, functionName: "quoteAcquisitionPrice", data: call.data });
    return { quote, gasPrice };
  }

  async getPoolSnapshot(): Promise<PoolSnapshot> {
    const [block, priced, activeCount, stagedCount, activeBackingTotal, totalWeight, weightedBackingTotal, pending, slippageBps, surchargeBps, minBacking, maxBatch, settlementWindow, finalizeWindow, settlementDiscountBps, onchainAcquisitionsEnabled, withdrawOnly, topId, topPot, topShare, topThreshold] =
      await Promise.all([
        this.pub.getBlock(),
        this.readQuote(),
        this.pub.readContract({ address: this.core, abi: fwaCoreAbi, functionName: "activeListingCount" }),
        this.pub.readContract({ address: this.core, abi: fwaCoreAbi, functionName: "stagedCount" }),
        this.pub.readContract({ address: this.core, abi: fwaCoreAbi, functionName: "activeBackingTotal" }),
        this.pub.readContract({ address: this.core, abi: fwaCoreAbi, functionName: "totalWeight" }),
        this.pub.readContract({ address: this.core, abi: fwaCoreAbi, functionName: "weightedBackingTotal" }),
        this.pub.readContract({ address: this.core, abi: fwaCoreAbi, functionName: "pendingAcquisitionCount" }),
        this.pub.readContract({ address: this.core, abi: fwaCoreAbi, functionName: "selectionSlippageBps" }),
        this.pub.readContract({ address: this.core, abi: fwaCoreAbi, functionName: "surchargeBps" }),
        this.pub.readContract({ address: this.core, abi: fwaCoreAbi, functionName: "minBacking" }),
        this.pub.readContract({ address: this.core, abi: fwaCoreAbi, functionName: "maxAcquisitionsPerTx" }),
        this.pub.readContract({ address: this.core, abi: fwaCoreAbi, functionName: "settlementWindow" }),
        this.pub.readContract({ address: this.core, abi: fwaCoreAbi, functionName: "finalizeWindow" }),
        this.pub.readContract({ address: this.core, abi: fwaCoreAbi, functionName: "settlementDiscountBps" }),
        this.pub.readContract({ address: this.core, abi: fwaCoreAbi, functionName: "acquisitionsEnabled" }),
        this.pub.readContract({ address: this.core, abi: fwaCoreAbi, functionName: "withdrawOnly" }),
        this.pub.readContract({ address: this.core, abi: fwaCoreAbi, functionName: "topListingId" }),
        this.pub.readContract({ address: this.core, abi: fwaCoreAbi, functionName: "topListingPot" }),
        this.pub.readContract({ address: this.core, abi: fwaCoreAbi, functionName: "topListingShareBps" }),
        this.pub.readContract({ address: this.core, abi: fwaCoreAbi, functionName: "topThresholdBps" }),
      ]);
    const [fee, vrf, total] = priced.quote;
    return {
      chainId: this.chainId,
      blockNumber: block.number,
      timestamp: Number(block.timestamp),
      activeListingCount: Number(activeCount),
      stagedListingCount: Number(stagedCount),
      totalBacking: activeBackingTotal,
      totalWeight,
      weightedBackingTotal,
      acquisitionFee: fee,
      serviceFee: vrf,
      totalPrice: total,
      surchargeBps: Number(surchargeBps),
      defaultDriftBps: Number(slippageBps),
      minBacking,
      maxBatch: Number(maxBatch),
      settlementWindowSec: Number(settlementWindow),
      finalizeWindowSec: Number(finalizeWindow),
      bidPayoutBps: Number(settlementDiscountBps),
      acquisitionsEnabled:
        this.manifest.features.acquisitionsEnabled && onchainAcquisitionsEnabled && !withdrawOnly && total > 0n && Number(activeCount) > 0,
      pendingAcquisitions: Number(pending),
      crown:
        topId > 0n
          ? { listingId: topId, pot: topPot, shareBps: Number(topShare), thresholdBps: Number(topThreshold) }
          : undefined,
    };
  }

  async getListing(id: bigint): Promise<Listing | null> {
    const raw = await this.pub.readContract({ address: this.core, abi: fwaCoreAbi, functionName: "listings", args: [id] });
    const status = LISTING_STATUS_BY_CODE[raw[10] as keyof typeof LISTING_STATUS_BY_CODE];
    if (!status) return null;
    const [pendingFees, stuckRecipient] = await Promise.all([
      this.pub.readContract({ address: this.core, abi: fwaCoreAbi, functionName: "pendingFees", args: [id] }),
      this.pub.readContract({ address: this.core, abi: fwaCoreAbi, functionName: "stuckNFTRecipient", args: [id] }),
    ]);
    const collection = this.collectionInfo(raw[0]);
    let settlement: Listing["settlement"];
    if (status === "settled") {
      try {
        const nftOwner = await this.pub.readContract({
          address: raw[0],
          abi: erc721Abi,
          functionName: "ownerOf",
          args: [raw[3]],
        });
        if (raw[2] !== ZERO_ADDRESS && sameAddress(nftOwner, raw[2])) settlement = "kept";
        else if (sameAddress(nftOwner, raw[1])) settlement = "bid_accepted";
        else if (sameAddress(nftOwner, this.core)) settlement = "relisted";
      } catch {
        // A burned or hostile ERC-721 may make ownerOf unavailable. The UI then
        // reports the outcome as unknown instead of inventing an event history.
      }
    }
    return {
      id,
      status,
      collection: raw[0],
      depositor: raw[1],
      purchaser: raw[2] !== ZERO_ADDRESS ? raw[2] : undefined,
      tokenId: raw[3],
      weight: raw[4],
      backing: raw[5],
      listedAt: 0,
      allocatedAt: raw[9] > 0n ? Number(raw[9]) : undefined,
      isCrown: false,
      pendingFees,
      settlement,
      stuckRecipient: stuckRecipient !== ZERO_ADDRESS ? stuckRecipient : undefined,
      nft: {
        name: `${collection?.symbol ?? "NFT"} #${raw[3].toString()}`,
        collectionName: collection?.name,
        collectionSymbol: collection?.symbol,
      },
    };
  }

  private async getAllListingsDirect(): Promise<Listing[]> {
    const nextId = await this.pub.readContract({ address: this.core, abi: fwaCoreAbi, functionName: "nextListingId" });
    if (nextId > MAX_ENUMERATED_LISTINGS + 1n) {
      throw new ProtocolError("INDEXER_DOWN", "The direct testnet reader reached its 1,000-listing safety bound.");
    }
    const items = await Promise.all(
      Array.from({ length: Number(nextId > 0n ? nextId - 1n : 0n) }, (_, index) => this.getListing(BigInt(index + 1))),
    );
    const listings = items.filter((item): item is Listing => item !== null);
    const topId = await this.pub.readContract({ address: this.core, abi: fwaCoreAbi, functionName: "topListingId" });
    for (const listing of listings) listing.isCrown = listing.id === topId;
    return listings;
  }

  private async getAllListings(): Promise<Listing[]> {
    if (!this.indexerUrl) return this.getAllListingsDirect();
    const rows: GraphListingRow[] = [];
    for (let skip = 0; ; skip += INDEXER_PAGE_SIZE) {
      if (skip >= INDEXER_PAGE_SIZE * MAX_INDEXER_PAGES) {
        throw new ProtocolError("INDEXER_DOWN", "Indexer pagination exceeded the 5,000-row safety bound.");
      }
      const page = await this.indexedListingRows({ first: INDEXER_PAGE_SIZE, skip, orderBy: "listingId", direction: "asc" });
      rows.push(...page);
      if (page.length < INDEXER_PAGE_SIZE) break;
    }
    return this.hydrateIndexedListings(rows);
  }

  private async getIndexedListingsForAccount(account: Address): Promise<Listing[]> {
    if (!this.indexerUrl) return this.getAllListingsDirect();
    const normalized = account.toLowerCase();
    const rowsById = new Map<string, GraphListingRow>();
    for (const field of ["depositor", "purchaser"] as const) {
      for (let skip = 0; ; skip += INDEXER_PAGE_SIZE) {
        if (skip >= INDEXER_PAGE_SIZE * MAX_INDEXER_PAGES) {
          throw new ProtocolError("INDEXER_DOWN", "Account position pagination exceeded the safety bound.");
        }
        const page = await this.indexedListingRows({
          where: [`${field}: ${JSON.stringify(normalized)}`],
          first: INDEXER_PAGE_SIZE,
          skip,
          orderBy: "listingId",
          direction: "desc",
        });
        for (const row of page) rowsById.set(row.id, row);
        if (page.length < INDEXER_PAGE_SIZE) break;
      }
    }
    return this.hydrateIndexedListings([...rowsById.values()]);
  }

  async getListings(query: ListingsQuery): Promise<Page<Listing>> {
    if (this.indexerUrl) return this.getIndexedListings(query);
    const snapshot = await this.getAllListingsDirect();
    const totalWeight = snapshot
      .filter((listing) => listing.status === "active")
      .reduce((sum, listing) => sum + listing.weight, 0n);
    const search = query.search?.trim().toLowerCase();
    let items = snapshot.filter((listing) => {
      if (query.view === "pool" && listing.status !== "active") return false;
      if (query.view === "top" && !listing.isCrown) return false;
      if (query.collections?.length && !query.collections.some((address) => sameAddress(address, listing.collection))) return false;
      if (query.statuses?.length && !query.statuses.includes(listing.status)) return false;
      if (query.rarities?.length && !query.rarities.includes(rarityFromOdds(listing.weight, totalWeight))) return false;
      if (search && !`${listing.id} ${listing.tokenId} ${listing.nft.name ?? ""} ${listing.nft.collectionName ?? ""}`.toLowerCase().includes(search)) return false;
      return true;
    });
    const direction = query.direction === "asc" ? 1 : -1;
    items = items.sort((a, b) => {
      if (query.sort === "value") return (a.backing < b.backing ? -1 : a.backing > b.backing ? 1 : 0) * direction;
      if (query.sort === "odds") return (a.weight < b.weight ? -1 : a.weight > b.weight ? 1 : 0) * direction;
      if (query.sort === "name") return (a.nft.name ?? "").localeCompare(b.nft.name ?? "") * direction;
      return (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) * direction;
    });
    const offset = Number.parseInt(query.cursor ?? "0", 10) || 0;
    const page = items.slice(offset, offset + query.limit);
    return { items: page, total: items.length, nextCursor: offset + page.length < items.length ? String(offset + page.length) : undefined };
  }

  private async getIndexedListings(query: ListingsQuery): Promise<Page<Listing>> {
    const where: string[] = [];
    if (query.view === "pool") where.push('status: "active"');
    if (query.view === "top") where.push("isCrown: true");
    if (query.statuses?.length) {
      where.push(`status_in: [${query.statuses.map((status) => JSON.stringify(status)).join(", ")}]`);
    }
    if (query.collections?.length) {
      where.push(
        `collection_in: [${query.collections.map((address) => JSON.stringify(address.toLowerCase())).join(", ")}]`,
      );
    }
    const orderBy =
      query.sort === "value" ? "backing" : query.sort === "odds" ? "weight" : query.sort === "date" ? "listedAt" : "listingId";
    const offset = Number.parseInt(query.cursor ?? "0", 10) || 0;
    const scanSize = Math.min(1_000, Math.max(query.limit * 4, query.limit + 1));
    const rows = await this.indexedListingRows({
      where,
      first: scanSize,
      skip: offset,
      orderBy,
      direction: query.direction,
    });
    const totalWeight = await this.pub.readContract({ address: this.core, abi: fwaCoreAbi, functionName: "totalWeight" });
    const hydrated = await this.hydrateIndexedListings(rows);
    const search = query.search?.trim().toLowerCase();
    const filtered = hydrated.filter((listing): listing is Listing => {
      if (query.rarities?.length && !query.rarities.includes(rarityFromOdds(listing.weight, totalWeight))) return false;
      if (
        search &&
        !`${listing.id} ${listing.tokenId} ${listing.nft.name ?? ""} ${listing.nft.collectionName ?? ""}`
          .toLowerCase()
          .includes(search)
      ) {
        return false;
      }
      return true;
    });
    const items = filtered.slice(0, query.limit);
    const scanned = rows.length;
    const hasNext = rows.length === scanSize || filtered.length > query.limit;
    return {
      items,
      total: offset + items.length + (hasNext ? 1 : 0),
      nextCursor: hasNext ? String(offset + scanned) : undefined,
    };
  }

  async quoteAcquisition(input: { quantity: number; driftToleranceBps: number }): Promise<AcquisitionQuote> {
    const maxBatch = Number(
      await this.pub.readContract({ address: this.core, abi: fwaCoreAbi, functionName: "maxAcquisitionsPerTx" }),
    );
    if (!Number.isInteger(input.quantity) || input.quantity < 1 || input.quantity > maxBatch) {
      throw new ProtocolError("NOT_ELIGIBLE", `Choose between 1 and ${maxBatch} acquisitions.`);
    }
    if (!Number.isInteger(input.driftToleranceBps) || input.driftToleranceBps < 0 || input.driftToleranceBps > 10_000) {
      throw new ProtocolError("NOT_ELIGIBLE", "Drift tolerance must be between 0 and 10,000 bps.");
    }
    const [block, priced, weightedBackingTotal] = await Promise.all([
      this.pub.getBlock(),
      this.readQuote(),
      this.pub.readContract({ address: this.core, abi: fwaCoreAbi, functionName: "weightedBackingTotal" }),
    ]);
    const [fee, vrf] = priced.quote;
    return {
      quantity: input.quantity,
      poolFeePerItem: fee,
      serviceFeePerItem: vrf,
      totalPerItem: fee + vrf,
      total: (fee + vrf) * BigInt(input.quantity),
      maxAcquisitionFeePerItem: (fee * BigInt(10_000 + input.driftToleranceBps)) / 10_000n,
      driftToleranceBps: input.driftToleranceBps,
      minWeightedValue: (weightedBackingTotal * BigInt(10_000 - input.driftToleranceBps)) / 10_000n,
      quotedAt: Number(block.timestamp),
      blockNumber: block.number,
    };
  }

  async getNativeBalance(account: Address): Promise<bigint> {
    return this.pub.getBalance({ address: account });
  }

  async getConnectionHealth(): Promise<ConnectionHealth> {
    try {
      const block = await this.pub.getBlockNumber();
      if (!this.indexerUrl) {
        return { rpc: "ok", indexer: { status: "down", lagBlocks: 0, indexedBlock: 0n, chainBlock: block } };
      }
      try {
        const result = await this.indexerQuery<{ _meta: GraphMeta }>(
          "{ _meta { block { number } hasIndexingErrors } }",
        );
        const indexedBlock = BigInt(result._meta.block.number);
        const lag = block > indexedBlock ? Number(block - indexedBlock) : 0;
        return {
          rpc: "ok",
          indexer: {
            status: result._meta.hasIndexingErrors ? "down" : lag > 20 ? "lagging" : "ok",
            lagBlocks: lag,
            indexedBlock,
            chainBlock: block,
          },
        };
      } catch {
        return { rpc: "ok", indexer: { status: "down", lagBlocks: 0, indexedBlock: 0n, chainBlock: block } };
      }
    } catch {
      return { rpc: "down", indexer: { status: "down", lagBlocks: 0, indexedBlock: 0n, chainBlock: 0n } };
    }
  }

  async getActivity(query: ActivityQuery): Promise<Page<ActivityItem>> {
    if (!this.indexerUrl) return { items: [], total: 0 };
    const where: string[] = [];
    if (query.scope === "user" && query.account) where.push(`address: ${JSON.stringify(query.account.toLowerCase())}`);
    if (query.types?.length) where.push(`type_in: [${query.types.map((type) => JSON.stringify(type)).join(", ")}]`);
    if (query.collections?.length) {
      where.push(
        `collection_in: [${query.collections.map((address) => JSON.stringify(address.toLowerCase())).join(", ")}]`,
      );
    }
    const offset = Number.parseInt(query.cursor ?? "0", 10) || 0;
    const first = Math.min(5_000, query.limit + 1);
    const whereClause = where.length ? `, where: { ${where.join(", ")} }` : "";
    const [data, chainBlock] = await Promise.all([
      this.indexerQuery<{ activities: GraphActivityRow[] }>(`{
        activities(first: ${first}, skip: ${offset}, orderBy: timestamp, orderDirection: desc${whereClause}) {
          id type txHash blockNumber timestamp address listingId collection tokenId amount tokenAmount
        }
      }`),
      this.pub.getBlockNumber(),
    ]);
    const hasNext = data.activities.length > query.limit;
    const rows = data.activities.slice(0, query.limit);
    const items: ActivityItem[] = rows.map((row) => ({
      id: row.id,
      type: row.type,
      txHash: row.txHash as Hex,
      blockNumber: BigInt(row.blockNumber),
      timestamp: Number(row.timestamp),
      address: row.address ? (row.address as Address) : undefined,
      listingId: row.listingId ? BigInt(row.listingId) : undefined,
      collection: row.collection ? (row.collection as Address) : undefined,
      tokenId: row.tokenId ? BigInt(row.tokenId) : undefined,
      amount: row.amount ? BigInt(row.amount) : undefined,
      tokenAmount: row.tokenAmount ? BigInt(row.tokenAmount) : undefined,
      finality: chainBlock >= BigInt(row.blockNumber) + 2n ? "confirmed" : "indexed",
    }));
    return {
      items,
      total: offset + items.length + (hasNext ? 1 : 0),
      nextCursor: hasNext ? String(offset + items.length) : undefined,
    };
  }

  private async acquisitionTickets(account?: Address): Promise<AcquisitionTicket[]> {
    if (this.indexerUrl && account) return this.indexedAcquisitionTickets(account);
    const lastSequence = await this.pub.readContract({ address: this.core, abi: fwaCoreAbi, functionName: "lastIssuedSequence" });
    const sequences = Array.from({ length: Number(lastSequence) }, (_, index) => BigInt(index + 1));
    const requestIds = await Promise.all(
      sequences.map((sequence) =>
        this.pub.readContract({ address: this.core, abi: fwaCoreAbi, functionName: "requestIdAtSequence", args: [sequence] }),
      ),
    );
    const rows = await Promise.all(
      requestIds.map(async (requestId, index) => {
        const [acquisition, meta] = await Promise.all([
          this.pub.readContract({ address: this.core, abi: fwaCoreAbi, functionName: "acquisitions", args: [requestId] }),
          this.pub.readContract({ address: this.core, abi: fwaCoreAbi, functionName: "acquisitionMeta", args: [requestId] }),
        ]);
        if (account && !sameAddress(acquisition[0], account)) return null;
        let requestedAt = 0;
        try {
          requestedAt = Number((await this.pub.getBlock({ blockNumber: acquisition[1] })).timestamp);
        } catch {
          requestedAt = nowSec();
        }
        const statusCode = acquisition[4];
        const phase =
          statusCode === 1
            ? "randomness_pending"
            : statusCode === 5
              ? "randomness_cached"
              : statusCode === 6
                ? "timed_out"
                : statusCode === 2
                  ? "allocated"
                  : statusCode === 3
                    ? "expired"
                    : "refunded";
        return {
          requestId,
          sequence: meta[0] || sequences[index]!,
          purchaser: acquisition[0],
          feePaid: acquisition[2],
          serviceFeePaid: 0n,
          requestedAt,
          requestBlock: acquisition[1],
          wordDeadlineBlock: meta[1],
          phase,
          listingId: acquisition[3] > 0n ? acquisition[3] : undefined,
          refund: statusCode === 3 || statusCode === 4 ? acquisition[2] : undefined,
        } satisfies AcquisitionTicket;
      }),
    );
    const tickets: AcquisitionTicket[] = [];
    for (const row of rows) if (row !== null) tickets.push(row);
    return tickets;
  }

  private async indexedAcquisitionRows(account: Address): Promise<GraphAcquisitionRow[]> {
    const rows: GraphAcquisitionRow[] = [];
    for (let skip = 0; ; skip += 1_000) {
      if (skip >= 1_000 * MAX_INDEXER_PAGES) {
        throw new ProtocolError("INDEXER_DOWN", "Acquisition pagination exceeded the 25,000-row safety bound.");
      }
      const data = await this.indexerQuery<{ acquisitions: GraphAcquisitionRow[] }>(`{
        acquisitions(
          first: 1000,
          skip: ${skip},
          orderBy: requestedAt,
          orderDirection: desc,
          where: { purchaser: ${JSON.stringify(account.toLowerCase())} }
        ) {
          requestId purchaser acquisitionFee sequence wordDeadlineBlock status listingId refund
          requestedAt requestedBlock txHash context { serviceFeeTotal requestCount }
        }
      }`);
      rows.push(...data.acquisitions);
      if (data.acquisitions.length < 1_000) break;
    }
    return rows;
  }

  private async indexedAcquisitionTickets(account: Address): Promise<AcquisitionTicket[]> {
    const rows = await this.indexedAcquisitionRows(account);
    return rows.map((row) => {
      const phase: AcquisitionTicket["phase"] =
        row.status === "pending"
          ? "randomness_pending"
          : row.status === "ready"
            ? "randomness_cached"
            : row.status === "fulfilled"
              ? "allocated"
              : row.status === "timed_out"
                ? "timed_out"
                : row.status === "expired"
                  ? "expired"
                  : "refunded";
      const requestCount = Math.max(1, row.context.requestCount);
      return {
        requestId: BigInt(row.requestId),
        sequence: BigInt(row.sequence ?? "0"),
        purchaser: row.purchaser as Address,
        feePaid: BigInt(row.acquisitionFee),
        serviceFeePaid: BigInt(row.context.serviceFeeTotal) / BigInt(requestCount),
        requestedAt: Number(row.requestedAt),
        requestBlock: BigInt(row.requestedBlock),
        txHash: row.txHash as Hex,
        wordDeadlineBlock: row.wordDeadlineBlock ? BigInt(row.wordDeadlineBlock) : undefined,
        phase,
        listingId: row.listingId ? BigInt(row.listingId) : undefined,
        refund: row.refund ? BigInt(row.refund) : undefined,
      };
    });
  }

  private async getAccountStateDirectFromLogs(account: Address): Promise<{
    listings: Listing[];
    tickets: AcquisitionTicket[];
  }> {
    if (this.manifest.deployedAtBlock === undefined) {
      throw new ProtocolError("INDEXER_DOWN", "The deployment block is required for on-chain account discovery.");
    }
    const logPub = this.logPub;
    if (!logPub || this.logRpcMaxBlockRange < MIN_DEDICATED_LOG_RANGE_BLOCKS) {
      throw new ProtocolError(
        "INDEXER_DOWN",
        "Emergency discovery requires the reviewed archival/log RPC configured for production; the public HyperEVM RPC is intentionally not used for historical scans.",
      );
    }
    const head = await logPub.getBlockNumber();
    const deploymentBlock = BigInt(this.manifest.deployedAtBlock);
    if (head - deploymentBlock > MAX_LOG_DISCOVERY_BLOCK_SPAN) {
      throw new ProtocolError("INDEXER_DOWN", "Emergency discovery exceeded its 50-million-block checkpoint horizon.");
    }
    const checkpoint = this.loadLogCheckpoint(account, deploymentBlock);
    const listingIds = new Set<bigint>((checkpoint?.listingIds ?? []).map(BigInt));
    const requestHashes = new Map<bigint, Hex>(
      (checkpoint?.requestHashes ?? []).map(([requestId, hash]) => [BigInt(requestId), hash]),
    );
    let fromBlock = checkpoint ? BigInt(checkpoint.nextBlock) : deploymentBlock;
    while (fromBlock <= head) {
      const { toBlock } = nextLogDiscoveryWindow(fromBlock, head, this.logRpcMaxBlockRange);
      const [listed, staged, allocated, requested] = await Promise.all([
        logPub.getLogs({
          address: this.core,
          event: NFT_LISTED_EVENT,
          args: { depositor: account },
          fromBlock,
          toBlock,
        }),
        logPub.getLogs({
          address: this.core,
          event: LISTING_STAGED_EVENT,
          args: { depositor: account },
          fromBlock,
          toBlock,
        }),
        logPub.getLogs({
          address: this.core,
          event: NFT_ALLOCATED_EVENT,
          args: { purchaser: account },
          fromBlock,
          toBlock,
        }),
        logPub.getLogs({
          address: this.core,
          event: ACQUISITION_REQUESTED_EVENT,
          args: { purchaser: account },
          fromBlock,
          toBlock,
        }),
      ]);
      for (const log of listed) if (log.args.listingId !== undefined) listingIds.add(log.args.listingId);
      for (const log of staged) if (log.args.listingId !== undefined) listingIds.add(log.args.listingId);
      for (const log of allocated) if (log.args.listingId !== undefined) listingIds.add(log.args.listingId);
      for (const log of requested) {
        if (log.args.requestId !== undefined && log.transactionHash) {
          requestHashes.set(log.args.requestId, log.transactionHash as Hex);
        }
      }
      if (listingIds.size > MAX_ACCOUNT_LOG_RESULTS || requestHashes.size > MAX_ACCOUNT_LOG_RESULTS) {
        throw new ProtocolError("INDEXER_DOWN", "Emergency account discovery exceeded its 5,000-result safety bound.");
      }
      fromBlock = toBlock + 1n;
      this.saveLogCheckpoint(account, {
        deploymentBlock: deploymentBlock.toString(),
        nextBlock: fromBlock.toString(),
        listingIds: [...listingIds].map(String),
        requestHashes: [...requestHashes].map(([requestId, hash]) => [requestId.toString(), hash]),
      });
    }
    this.saveLogCheckpoint(account, null);

    const hydratedListings = await Promise.all([...listingIds].map((id) => this.getListing(id)));
    const listings = hydratedListings.filter((listing): listing is Listing => listing !== null);
    const ticketRows = await Promise.all(
      [...requestHashes].map(async ([requestId, hash]): Promise<AcquisitionTicket | null> => {
        const [acquisition, meta] = await Promise.all([
          this.pub.readContract({ address: this.core, abi: fwaCoreAbi, functionName: "acquisitions", args: [requestId] }),
          this.pub.readContract({ address: this.core, abi: fwaCoreAbi, functionName: "acquisitionMeta", args: [requestId] }),
        ]);
        if (!sameAddress(acquisition[0], account)) return null;
        let requestedAt = 0;
        try {
          requestedAt = Number((await logPub.getBlock({ blockNumber: acquisition[1] })).timestamp);
        } catch {
          requestedAt = nowSec();
        }
        const statusCode = acquisition[4];
        const phase: AcquisitionTicket["phase"] =
          statusCode === 1
            ? "randomness_pending"
            : statusCode === 5
              ? "randomness_cached"
              : statusCode === 6
                ? "timed_out"
                : statusCode === 2
                  ? "allocated"
                  : statusCode === 3
                    ? "expired"
                    : "refunded";
        return {
          requestId,
          sequence: meta[0],
          purchaser: acquisition[0],
          feePaid: acquisition[2],
          serviceFeePaid: 0n,
          requestedAt,
          requestBlock: acquisition[1],
          txHash: hash,
          wordDeadlineBlock: meta[1],
          phase,
          listingId: acquisition[3] > 0n ? acquisition[3] : undefined,
          refund: statusCode === 3 || statusCode === 4 ? acquisition[2] : undefined,
        };
      }),
    );
    return { listings, tickets: ticketRows.filter((ticket): ticket is AcquisitionTicket => ticket !== null) };
  }

  async getUserPositions(account: Address): Promise<UserPositions> {
    let listings: Listing[];
    let tickets: AcquisitionTicket[];
    try {
      await this.assertIndexerHealthyForCriticalDiscovery();
      [listings, tickets] = await Promise.all([
        this.getIndexedListingsForAccount(account),
        this.acquisitionTickets(account),
      ]);
    } catch (error) {
      if (!(error instanceof ProtocolError) || error.code !== "INDEXER_DOWN") throw error;
      ({ listings, tickets } = await this.getAccountStateDirectFromLogs(account));
    }
    const [earnings, acquisitionRefund, topId, topPot] = await Promise.all([
      this.pub.readContract({ address: this.core, abi: fwaCoreAbi, functionName: "feeCredit", args: [account] }),
      this.pub.readContract({ address: this.core, abi: fwaCoreAbi, functionName: "acquisitionRefundCredit", args: [account] }),
      this.pub.readContract({ address: this.core, abi: fwaCoreAbi, functionName: "topListingId" }),
      this.pub.readContract({ address: this.core, abi: fwaCoreAbi, functionName: "topListingPot" }),
    ]);
    const mineAsDepositor = listings.filter((listing) => sameAddress(listing.depositor, account));
    return {
      account,
      deposited: mineAsDepositor.filter((listing) => listing.status === "active" || listing.status === "staged"),
      allocated: listings.filter((listing) => listing.status === "allocated" && sameAddress(listing.purchaser, account)),
      depositedAllocated: mineAsDepositor.filter((listing) => listing.status === "allocated"),
      // Keep allocated tickets visible while their position is awaiting a
      // settlement choice. The reveal queue watches the Pending -> Allocated
      // transition; dropping the ticket here made the real RPC client miss the
      // reveal even though the mock client behaved correctly.
      pendingAcquisitions: tickets.filter((ticket) => {
        if (["requested", "randomness_pending", "randomness_cached", "processing", "timed_out"].includes(ticket.phase)) {
          return true;
        }
        if (ticket.phase !== "allocated" || ticket.listingId === undefined) return false;
        return listings.some((listing) => listing.id === ticket.listingId && listing.status === "allocated");
      }),
      settled: listings.filter(
        (listing) =>
          listing.status === "settled" && (sameAddress(listing.depositor, account) || sameAddress(listing.purchaser, account)),
      ),
      stuck: listings.filter((listing) => sameAddress(listing.stuckRecipient, account)),
      claimable: {
        earnings,
        acquisitionRefund,
        listingFees: mineAsDepositor
          .filter((listing) => listing.status === "active" && listing.pendingFees > 0n)
          .map((listing) => ({ listingId: listing.id, amount: listing.pendingFees })),
        crownPot:
          topId > 0n && mineAsDepositor.some((listing) => listing.id === topId) ? topPot : 0n,
      },
    };
  }

  async getRewards(account?: Address): Promise<RewardsSnapshot> {
    const rewards = this.manifest.contracts.rewards;
    const token = this.manifest.contracts.token;
    const holderRevenue = await this.getHolderRevenue(account);
    if (!rewards || !token) return { moduleActive: false, tokenSymbol: "HWA", holderRevenue };

    const [
      start,
      emissionDuration,
      configured,
      claimsEnabled,
      currentSeason,
      currentEpoch,
      reserveRemaining,
      seasonalEmitted,
      seasonalBurned,
      depositorEmitted,
      purchaserEmitted,
      buybackDepositorRouted,
      buybackPurchaserRouted,
      effectiveQuoteX96,
      valueCapBps,
      seasonOne,
      seasonTwo,
      seasonThree,
      hotGap,
      coldGap,
      lastAcquisitionAt,
      tokenName,
      tokenSymbol,
      tokenDecimals,
    ] = await Promise.all([
      this.pub.readContract({ address: rewards, abi: fwaRewardsAbi, functionName: "emissionStart" }),
      this.pub.readContract({ address: rewards, abi: fwaRewardsAbi, functionName: "EMISSION_DURATION" }),
      this.pub.readContract({ address: rewards, abi: fwaRewardsAbi, functionName: "emissionConfigured" }),
      this.pub.readContract({ address: rewards, abi: fwaRewardsAbi, functionName: "claimsEnabled" }),
      this.pub.readContract({ address: rewards, abi: fwaRewardsAbi, functionName: "currentSeason" }),
      this.pub.readContract({ address: rewards, abi: fwaRewardsAbi, functionName: "currentEpoch" }),
      this.pub.readContract({ address: rewards, abi: fwaRewardsAbi, functionName: "seasonalReserveRemaining" }),
      this.pub.readContract({ address: rewards, abi: fwaRewardsAbi, functionName: "seasonalEmitted" }),
      this.pub.readContract({ address: rewards, abi: fwaRewardsAbi, functionName: "seasonalBurned" }),
      this.pub.readContract({ address: rewards, abi: fwaRewardsAbi, functionName: "seasonalDepositorEmitted" }),
      this.pub.readContract({ address: rewards, abi: fwaRewardsAbi, functionName: "seasonalPurchaserEmitted" }),
      this.pub.readContract({ address: rewards, abi: fwaRewardsAbi, functionName: "buybackDepositorRouted" }),
      this.pub.readContract({ address: rewards, abi: fwaRewardsAbi, functionName: "buybackPurchaserRouted" }),
      this.pub.readContract({ address: rewards, abi: fwaRewardsAbi, functionName: "effectiveSeasonQuoteX96" }),
      this.pub.readContract({ address: rewards, abi: fwaRewardsAbi, functionName: "VALUE_CAP_BPS" }),
      this.pub.readContract({ address: rewards, abi: fwaRewardsAbi, functionName: "seasonBudget", args: [0n] }),
      this.pub.readContract({ address: rewards, abi: fwaRewardsAbi, functionName: "seasonBudget", args: [1n] }),
      this.pub.readContract({ address: rewards, abi: fwaRewardsAbi, functionName: "seasonBudget", args: [2n] }),
      this.pub.readContract({ address: rewards, abi: fwaRewardsAbi, functionName: "hotGap" }),
      this.pub.readContract({ address: rewards, abi: fwaRewardsAbi, functionName: "coldGap" }),
      this.pub.readContract({ address: rewards, abi: fwaRewardsAbi, functionName: "lastAcquisitionTs" }),
      this.pub.readContract({ address: token, abi: erc20Abi, functionName: "name" }),
      this.pub.readContract({ address: token, abi: erc20Abi, functionName: "symbol" }),
      this.pub.readContract({ address: token, abi: erc20Abi, functionName: "decimals" }),
    ]);
    if (tokenName !== HWA_TOKEN_NAME || tokenSymbol !== HWA_TOKEN_SYMBOL || tokenDecimals !== HWA_TOKEN_DECIMALS) {
      throw new ProtocolError("CONTRACT_MISCONFIGURED", "The configured rewards token is not Hyper World Assets ($HWA).");
    }

    let depositorPending = 0n;
    let depositorCredit = 0n;
    let purchaserBuyAllowanceHype = 0n;
    let purchaserClaimable = 0n;
    let claimableEpochs: number[] = [];
    if (account) {
      const listings = (await this.getIndexedListingsForAccount(account)).filter(
        (listing) => listing.status === "active" && sameAddress(listing.depositor, account),
      );
      const pending = await Promise.all(
        listings.map((listing) =>
          this.pub.readContract({ address: rewards, abi: fwaRewardsAbi, functionName: "pendingDepositorTokens", args: [listing.id] }),
        ),
      );
      depositorPending = pending.reduce((sum, amount) => sum + amount, 0n);
      [depositorCredit, purchaserBuyAllowanceHype] = await Promise.all([
        this.pub.readContract({ address: rewards, abi: fwaRewardsAbi, functionName: "tokenCredit", args: [account] }),
        this.pub.readContract({ address: rewards, abi: fwaRewardsAbi, functionName: "tokenBuyAllowance", args: [account] }),
      ]);

      const epochCount = Number(currentEpoch);
      if (epochCount > MAX_REWARD_EPOCH_SCAN) {
        throw new ProtocolError("INDEXER_DOWN", "The rewards epoch reader reached its 1,024-epoch safety bound.");
      }
      const epochRows = await Promise.all(
        Array.from({ length: epochCount }, async (_, epoch) => {
          const epochId = BigInt(epoch);
          const [mine, total, pendingCount, finalized, claimed, swept, pot] = await Promise.all([
            this.pub.readContract({ address: rewards, abi: fwaRewardsAbi, functionName: "userSettledHypeInEpoch", args: [epochId, account] }),
            this.pub.readContract({ address: rewards, abi: fwaRewardsAbi, functionName: "settledHypeInEpoch", args: [epochId] }),
            this.pub.readContract({ address: rewards, abi: fwaRewardsAbi, functionName: "pendingAcquisitionsInEpoch", args: [epochId] }),
            this.pub.readContract({ address: rewards, abi: fwaRewardsAbi, functionName: "epochFinalized", args: [epochId] }),
            this.pub.readContract({ address: rewards, abi: fwaRewardsAbi, functionName: "purchaserClaimed", args: [epochId, account] }),
            this.pub.readContract({ address: rewards, abi: fwaRewardsAbi, functionName: "purchaserEpochSwept", args: [epochId] }),
            this.pub.readContract({ address: rewards, abi: fwaRewardsAbi, functionName: "purchaserEpochAmount", args: [epochId] }),
          ]);
          const seasonalClosed = epoch >= 45 || finalized;
          if (mine === 0n || total === 0n || pendingCount !== 0n || !seasonalClosed || claimed || swept) return null;
          return { epoch, amount: (pot * mine) / total };
        }),
      );
      const eligible = epochRows.filter((row): row is { epoch: number; amount: bigint } => row !== null);
      claimableEpochs = eligible.map((row) => row.epoch);
      purchaserClaimable = eligible.reduce((sum, row) => sum + row.amount, 0n);
    }

    const startNumber = Number(start);
    const durationNumber = Number(emissionDuration);
    const chainNow = Number((await this.pub.getBlock()).timestamp);
    const seasonBudgets = [seasonOne, seasonTwo, seasonThree];
    return {
      moduleActive: true,
      tokenSymbol: "HWA",
      tokenAddress: token,
      emission: {
        startedAt: startNumber,
        endsAt: startNumber === 0 ? 0 : startNumber + durationNumber,
        currentSeason: Number(currentSeason),
        currentEpoch: Number(currentEpoch),
        claimsEnabled,
        configured,
        reserveRemaining,
        emitted: seasonalEmitted,
        burned: seasonalBurned,
        depositorEmitted,
        purchaserEmitted,
        effectiveQuoteX96,
        valueCapBps: Number(valueCapBps),
        seasons: seasonBudgets.map((maxBudget, index) => ({
          season: index + 1,
          startsAt: startNumber === 0 ? 0 : startNumber + index * 15 * 86_400,
          endsAt: startNumber === 0 ? 0 : startNumber + (index + 1) * 15 * 86_400,
          maxBudget,
        })),
      },
      buyback: { depositorRouted: buybackDepositorRouted, purchaserRouted: buybackPurchaserRouted },
      epoch: {
        current: Number(currentEpoch),
        mode: Number(lastAcquisitionAt) > 0 && chainNow - Number(lastAcquisitionAt) <= Number(hotGap) ? "hot" : "cold",
        hotGapSec: Number(hotGap),
        coldGapSec: Number(coldGap),
        lastAcquisitionAt: Number(lastAcquisitionAt),
      },
      swapRoute: { dex: "Project X", feeTierBps: 100, pool: this.manifest.contracts.projectXPool },
      user: { depositorPending, depositorCredit, purchaserClaimable, purchaserBuyAllowanceHype, claimableEpochs },
      holderRevenue,
    };
  }

  private async getHolderRevenue(account?: Address): Promise<NonNullable<RewardsSnapshot["holderRevenue"]>> {
    const splitter = this.manifest.contracts.splitter;
    const [snapshotNft, snapshotSupply, maxTokenId, sweepAvailableAt, claimsClosed, splitFrozen, nftShareBps, claimablePerToken] =
      await Promise.all([
        this.pub.readContract({ address: splitter, abi: splitterAbi, functionName: "NFT_ADDRESS" }),
        this.pub.readContract({ address: splitter, abi: splitterAbi, functionName: "SNAPSHOT_SUPPLY" }),
        this.pub.readContract({ address: splitter, abi: splitterAbi, functionName: "MAX_TOKEN_ID" }),
        this.pub.readContract({ address: splitter, abi: splitterAbi, functionName: "SWEEP_AVAILABLE_AT" }),
        this.pub.readContract({ address: splitter, abi: splitterAbi, functionName: "claimsClosed" }),
        this.pub.readContract({ address: splitter, abi: splitterAbi, functionName: "splitFrozen" }),
        this.pub.readContract({ address: splitter, abi: splitterAbi, functionName: "nftShareBps" }),
        this.pub.readContract({ address: splitter, abi: splitterAbi, functionName: "claimablePerToken" }),
      ]);

    let ownedTokenIds: bigint[] = [];
    let pendingHype = 0n;
    if (account && !claimsClosed) {
      ownedTokenIds = await this.getSnapshotTokenIds(account, snapshotNft, maxTokenId);
      const pending = await Promise.all(
        ownedTokenIds.map((tokenId) =>
          this.pub.readContract({ address: splitter, abi: splitterAbi, functionName: "pending", args: [tokenId] }),
        ),
      );
      pendingHype = pending.reduce((sum, amount) => sum + amount, 0n);
    }

    return {
      splitterAddress: splitter,
      snapshotNft,
      snapshotSupply: Number(snapshotSupply),
      maxTokenId,
      nftShareBps: Number(nftShareBps),
      claimablePerToken,
      sweepAvailableAt: sweepAvailableAt === 0n ? undefined : Number(sweepAvailableAt),
      claimsClosed,
      splitFrozen,
      user: account ? { ownedTokenIds, pendingHype } : undefined,
    };
  }

  private async getSnapshotTokenIds(account: Address, snapshotNft: Address, maxTokenId: bigint): Promise<bigint[]> {
    let candidates: bigint[];
    if (this.indexerUrl) {
      await this.assertIndexerHealthyForCriticalDiscovery();
      const indexed: GraphOwnedTokenRow[] = [];
      for (let skip = 0; ; skip += 1_000) {
        if (skip >= 1_000 * MAX_INDEXER_PAGES) {
          throw new ProtocolError("INDEXER_DOWN", "Snapshot NFT pagination exceeded the 25,000-row safety bound.");
        }
        const data = await this.indexerQuery<{ ownedTokens: GraphOwnedTokenRow[] }>(`{
          ownedTokens(
            first: 1000,
            skip: ${skip},
            orderBy: updatedAt,
            orderDirection: desc,
            where: { owner: ${JSON.stringify(account.toLowerCase())}, burned: false }
          ) { collection tokenId owner }
        }`);
        indexed.push(...data.ownedTokens);
        if (data.ownedTokens.length < 1_000) break;
      }
      candidates = indexed
        .filter((row) => sameAddress(row.collection as Address, snapshotNft))
        .map((row) => BigInt(row.tokenId));
    } else {
      if (maxTokenId > MAX_UNINDEXED_SNAPSHOT_SCAN) {
        throw new ProtocolError(
          "INDEXER_DOWN",
          "Snapshot-holder discovery requires the event indexer for collections above 1,000 token IDs.",
        );
      }
      candidates = Array.from({ length: Number(maxTokenId) }, (_, index) => BigInt(index + 1));
    }

    const ownership = await Promise.all(
      candidates.map(async (tokenId) => {
        try {
          const owner = await this.pub.readContract({
            address: snapshotNft,
            abi: erc721Abi,
            functionName: "ownerOf",
            args: [tokenId],
          });
          return sameAddress(owner, account) ? tokenId : null;
        } catch {
          return null;
        }
      }),
    );
    return ownership.filter((tokenId): tokenId is bigint => tokenId !== null);
  }

  async getOwnedEligibleNFTs(account: Address): Promise<OwnedNFT[]> {
    if (this.indexerUrl) {
      await this.assertIndexerHealthyForCriticalDiscovery();
      return this.getIndexedOwnedEligibleNFTs(account);
    }
    const owned: OwnedNFT[] = [];
    for (const collection of this.manifest.collections) {
      const maxTokenId = collection.maxTokenId ?? 0;
      const rows = await Promise.all(
        Array.from({ length: maxTokenId }, async (_, index) => {
          const tokenId = BigInt(index + 1);
          try {
            const owner = await this.pub.readContract({
              address: collection.address,
              abi: erc721Abi,
              functionName: "ownerOf",
              args: [tokenId],
            });
            if (!sameAddress(owner, account)) return null;
            const [approved, approvedForAll] = await Promise.all([
              this.pub.readContract({
                address: collection.address,
                abi: erc721Abi,
                functionName: "getApproved",
                args: [tokenId],
              }),
              this.pub.readContract({
                address: collection.address,
                abi: erc721Abi,
                functionName: "isApprovedForAll",
                args: [account, this.core],
              }),
            ]);
            return {
              collection: collection.address,
              tokenId,
              whitelisted: true,
              approved: sameAddress(approved, this.core) || approvedForAll,
              nft: {
                name: `${collection.symbol ?? "NFT"} #${tokenId.toString()}`,
                collectionName: collection.name,
                collectionSymbol: collection.symbol,
              },
            } satisfies OwnedNFT;
          } catch {
            return null;
          }
        }),
      );
      for (const row of rows) if (row !== null) owned.push(row as OwnedNFT);
    }
    return owned;
  }

  private async getIndexedOwnedEligibleNFTs(account: Address): Promise<OwnedNFT[]> {
    const indexed: GraphOwnedTokenRow[] = [];
    for (let skip = 0; ; skip += 1_000) {
      if (skip >= 1_000 * MAX_INDEXER_PAGES) {
        throw new ProtocolError("INDEXER_DOWN", "Wallet NFT pagination exceeded the 25,000-row safety bound.");
      }
      const data = await this.indexerQuery<{ ownedTokens: GraphOwnedTokenRow[] }>(`{
        ownedTokens(
          first: 1000,
          skip: ${skip},
          orderBy: updatedAt,
          orderDirection: desc,
          where: { owner: ${JSON.stringify(account.toLowerCase())}, burned: false }
        ) { collection tokenId owner tokenURI }
      }`);
      indexed.push(...data.ownedTokens);
      if (data.ownedTokens.length < 1_000) break;
    }
    const rows = await Promise.all(
      indexed.map(async (row): Promise<OwnedNFT | null> => {
        const collection = this.collectionInfo(row.collection as Address);
        if (!collection) return null;
        const tokenId = BigInt(row.tokenId);
        try {
          // Ownership and approvals are transaction-critical and therefore
          // revalidated against the chain even though discovery is indexed.
          const [owner, approved, approvedForAll, tokenURI] = await Promise.all([
            this.pub.readContract({ address: collection.address, abi: erc721Abi, functionName: "ownerOf", args: [tokenId] }),
            this.pub.readContract({
              address: collection.address,
              abi: erc721Abi,
              functionName: "getApproved",
              args: [tokenId],
            }),
            this.pub.readContract({
              address: collection.address,
              abi: erc721Abi,
              functionName: "isApprovedForAll",
              args: [account, this.core],
            }),
            this.pub.readContract({
              address: collection.address,
              abi: erc721Abi,
              functionName: "tokenURI",
              args: [tokenId],
            }),
          ]);
          if (!sameAddress(owner, account)) return null;
          const metadata = tokenURI ? await this.resolveNFTMetadata(tokenURI) : {};
          return {
            collection: collection.address,
            tokenId,
            whitelisted: true,
            approved: sameAddress(approved, this.core) || approvedForAll,
            nft: {
              name: metadata.name ?? `${collection.symbol ?? "NFT"} #${tokenId.toString()}`,
              imageUrl: metadata.imageUrl,
              collectionName: collection.name,
              collectionSymbol: collection.symbol,
            },
          };
        } catch {
          return null;
        }
      }),
    );
    return rows.filter((row): row is OwnedNFT => row !== null);
  }

  async getCollections(): Promise<CollectionInfo[]> {
    return this.manifest.collections.map((collection) => ({
      address: collection.address,
      name: collection.name,
      symbol: collection.symbol,
      whitelisted: true,
    }));
  }

  async getSettlementInfo(listingId: bigint): Promise<SettlementInfo | null> {
    const listing = await this.getListing(listingId);
    if (!listing || listing.status !== "allocated" || listing.allocatedAt === undefined) return null;
    let windowSec: bigint;
    let finalizeSec: bigint;
    try {
      [windowSec, finalizeSec] = await Promise.all([
        this.pub.readContract({ address: this.core, abi: fwaCoreAbi, functionName: "settlementWindowAtAllocation", args: [listingId] }),
        this.pub.readContract({ address: this.core, abi: fwaCoreAbi, functionName: "finalizeWindowAtAllocation", args: [listingId] }),
      ]);
      if (windowSec === 0n || finalizeSec === 0n) throw new Error("missing allocation window snapshot");
    } catch {
      // Compatibility with the historical 998 deployment only. The v2/mainnet core always has
      // immutable per-allocation windows.
      [windowSec, finalizeSec] = await Promise.all([
        this.pub.readContract({ address: this.core, abi: fwaCoreAbi, functionName: "settlementWindow" }),
        this.pub.readContract({ address: this.core, abi: fwaCoreAbi, functionName: "finalizeWindow" }),
      ]);
    }
    const discountBps = await this.pub.readContract({ address: this.core, abi: fwaCoreAbi, functionName: "settlementDiscountBps" });
    const payoutBps = Number(discountBps);
    return {
      listingId,
      allocatedAt: listing.allocatedAt,
      purchaserWindowEndsAt: listing.allocatedAt + Number(windowSec),
      finalizeOpensAt: listing.allocatedAt + Number(finalizeSec),
      bidPayoutBps: payoutBps,
      bidPayout: (listing.backing * BigInt(payoutBps)) / 10_000n,
      netBackingToDepositor: listing.backing - (listing.backing * 100n) / 10_000n,
    };
  }

  async getTokenMarket(account?: Address): Promise<TokenMarket> {
    const token = this.manifest.contracts.token;
    const pool = this.manifest.contracts.projectXPool;
    if (!token || !pool) return { moduleActive: false, symbol: "HWA" };
    let user: TokenMarket["user"];
    const [externalBuysEnabled, token0, token1, slot0, totalSupply, tokenName, tokenSymbol, tokenDecimals] = await Promise.all([
      this.pub.readContract({ address: token, abi: erc20Abi, functionName: "externalBuysEnabled" }),
      this.pub.readContract({ address: pool, abi: v3PoolAbi, functionName: "token0" }),
      this.pub.readContract({ address: pool, abi: v3PoolAbi, functionName: "token1" }),
      this.pub.readContract({ address: pool, abi: v3PoolAbi, functionName: "slot0" }),
      this.pub.readContract({ address: token, abi: erc20Abi, functionName: "totalSupply" }),
      this.pub.readContract({ address: token, abi: erc20Abi, functionName: "name" }),
      this.pub.readContract({ address: token, abi: erc20Abi, functionName: "symbol" }),
      this.pub.readContract({ address: token, abi: erc20Abi, functionName: "decimals" }),
    ]);
    if (tokenName !== HWA_TOKEN_NAME || tokenSymbol !== HWA_TOKEN_SYMBOL || tokenDecimals !== HWA_TOKEN_DECIMALS) {
      throw new ProtocolError("CONTRACT_MISCONFIGURED", "The configured market token is not Hyper World Assets ($HWA).");
    }
    const hwaIsToken0 = sameAddress(token0, token);
    if (!hwaIsToken0 && !sameAddress(token1, token)) {
      throw new ProtocolError("CONTRACT_MISCONFIGURED", "The configured Project X pool does not contain the HWA token.");
    }
    const price = hypePerHwaFromSqrtPrice(slot0[0], hwaIsToken0);
    if (account) {
      const [hypeBalance, tokenBalance] = await Promise.all([
        this.pub.getBalance({ address: account }),
        this.pub.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [account] }),
      ]);
      user = { hypeBalance, tokenBalance };
    }
    return {
      moduleActive: true,
      symbol: "HWA",
      tokenAddress: token,
      poolAddress: pool,
      dex: "Project X",
      feeTierBps: 100,
      price,
      marketCapHype: price === undefined ? undefined : (price * totalSupply) / 10n ** 18n,
      externalBuysEnabled,
      externalTradeUrl: this.manifest.links?.projectXTradeUrl,
      user,
    };
  }

  async getPurchaseStats(account: Address): Promise<PurchaseStats> {
    const tickets = await this.acquisitionTickets(account);
    const listings = await this.getIndexedListingsForAccount(account);
    const history = tickets.map((ticket) => {
      const listing = ticket.listingId ? listings.find((item) => item.id === ticket.listingId) : undefined;
      return {
        requestId: ticket.requestId,
        timestamp: ticket.requestedAt,
        allInPaid: ticket.feePaid + ticket.serviceFeePaid,
        listingId: ticket.listingId,
        backingReceived: listing?.backing ?? 0n,
        outcome:
          ticket.phase === "allocated"
            ? (listing?.settlement ?? "allocated")
            : ticket.phase === "expired" || ticket.phase === "refunded" || ticket.phase === "timed_out"
              ? "refunded"
              : "pending",
        nft: listing?.nft,
      } as const;
    });
    const allInSpend = history.reduce((sum, row) => sum + row.allInPaid, 0n);
    const valueReceived = history.reduce((sum, row) => sum + row.backingReceived, 0n);
    return {
      purchases: history.length,
      avgAllInPrice: history.length ? allInSpend / BigInt(history.length) : 0n,
      allInSpend,
      netListingPL: valueReceived - allInSpend,
      history,
    };
  }

  async quoteSwap(_input: { side: SwapSide; amountIn: bigint; slippageBps: number }): Promise<SwapQuote> {
    throw new ProtocolError("NOT_ELIGIBLE", "Public swaps use the reviewed Project X interface after the owner opens buys.");
  }

  async swap(_input: { quote: SwapQuote }): Promise<TrackedTransaction> {
    throw new ProtocolError("NOT_ELIGIBLE", "Public swaps use the reviewed Project X interface after the owner opens buys.");
  }

  async approveNFT(input: { collection: Address; tokenId: bigint }): Promise<TrackedTransaction> {
    const { wallet, account } = await this.connectedWallet();
    const owner = await this.pub.readContract({ address: input.collection, abi: erc721Abi, functionName: "ownerOf", args: [input.tokenId] });
    if (!sameAddress(owner, account)) throw new ProtocolError("NOT_ELIGIBLE", "The connected wallet does not own this NFT.");
    return this.executeWrite("approve_nft", `Approve NFT #${input.tokenId}`, { collection: input.collection, tokenId: input.tokenId.toString() }, () =>
      wallet.writeContract({
        account,
        address: input.collection,
        abi: erc721Abi,
        functionName: "approve",
        args: [this.core, input.tokenId],
      }),
    );
  }

  async listNFT(input: { collection: Address; tokenId: bigint; backing: bigint }): Promise<TrackedTransaction> {
    if (HWA_NFT_DEPOSITS_PAUSED) {
      throw new ProtocolError("NOT_ELIGIBLE", "NFT deposits are paused while launch parameters are reviewed.");
    }
    const minBacking = await this.pub.readContract({ address: this.core, abi: fwaCoreAbi, functionName: "minBacking" });
    if (input.backing < minBacking) {
      throw new ProtocolError("BELOW_MIN_BACKING", `Minimum backing is ${minBacking.toString()} wei.`);
    }
    const whitelisted = await this.pub.readContract({
      address: this.core,
      abi: fwaCoreAbi,
      functionName: "collectionWhitelisted",
      args: [input.collection],
    });
    if (!whitelisted) throw new ProtocolError("COLLECTION_NOT_WHITELISTED", "Collection is not allowlisted.");
    const { wallet, account } = await this.connectedWallet();
    const [owner, approved, approvedForAll] = await Promise.all([
      this.pub.readContract({ address: input.collection, abi: erc721Abi, functionName: "ownerOf", args: [input.tokenId] }),
      this.pub.readContract({ address: input.collection, abi: erc721Abi, functionName: "getApproved", args: [input.tokenId] }),
      this.pub.readContract({
        address: input.collection,
        abi: erc721Abi,
        functionName: "isApprovedForAll",
        args: [account, this.core],
      }),
    ]);
    if (!sameAddress(owner, account)) throw new ProtocolError("NOT_ELIGIBLE", "The connected wallet does not own this NFT.");
    if (!sameAddress(approved, this.core) && !approvedForAll) {
      throw new ProtocolError("NOT_ELIGIBLE", "Approve this NFT to the HWA protocol first.");
    }
    return this.executeWrite("list_nft", `List NFT #${input.tokenId}`, { collection: input.collection, tokenId: input.tokenId.toString(), backing: input.backing.toString() }, () =>
      wallet.writeContract({
        account,
        address: this.core,
        abi: fwaCoreAbi,
        functionName: "listNFT",
        args: [input.collection, input.tokenId],
        value: input.backing,
      }),
    );
  }

  async withdrawListing(input: { listingId: bigint }): Promise<TrackedTransaction> {
    const { wallet, account } = await this.connectedWallet();
    return this.executeWrite("withdraw_listing", `Withdraw listing #${input.listingId}`, { listingId: input.listingId.toString() }, () =>
      wallet.writeContract({
        account,
        address: this.core,
        abi: fwaCoreAbi,
        functionName: "withdrawListing",
        args: [input.listingId],
      }),
      true,
    );
  }

  async acquire(input: { quote: AcquisitionQuote }): Promise<TrackedTransaction> {
    if (!this.manifest.features.acquisitionsEnabled) {
      throw new ProtocolError("ACQUISITIONS_DISABLED", "The supervised drand relayer session is not open.");
    }
    const { wallet, account } = await this.connectedWallet();
    const [priced, weightedBackingTotal] = await Promise.all([
      this.readQuote(),
      this.pub.readContract({ address: this.core, abi: fwaCoreAbi, functionName: "weightedBackingTotal" }),
    ]);
    const [poolFeePerItem, serviceFeePerItem] = priced.quote;
    if (poolFeePerItem > input.quote.maxAcquisitionFeePerItem) {
      throw new ProtocolError("PRICE_DRIFTED", "The pool fee is above the signed quote guard.");
    }
    if (weightedBackingTotal < input.quote.minWeightedValue) {
      throw new ProtocolError("PRICE_DRIFTED", "Pool weighted value fell below the quoted guard.");
    }
    const value = (poolFeePerItem + serviceFeePerItem) * BigInt(input.quote.quantity);
    const submit = () =>
      input.quote.quantity === 1
        ? wallet.writeContract({
            account,
            address: this.core,
            abi: fwaCoreAbi,
            functionName: "acquire",
            args: [input.quote.maxAcquisitionFeePerItem, input.quote.minWeightedValue, BigInt(input.quote.driftToleranceBps)],
            value,
            gasPrice: priced.gasPrice,
          })
        : wallet.writeContract({
            account,
            address: this.core,
            abi: fwaCoreAbi,
            functionName: "acquireBatch",
            args: [
              BigInt(input.quote.quantity),
              input.quote.maxAcquisitionFeePerItem,
              input.quote.minWeightedValue,
              BigInt(input.quote.driftToleranceBps),
            ],
            value,
            gasPrice: priced.gasPrice,
          });
    return this.executeWrite("acquire", `Acquire ${input.quote.quantity} chance${input.quote.quantity > 1 ? "s" : ""}`, { quantity: String(input.quote.quantity) }, submit);
  }

  async settle(input: { listingId: bigint; choice: SettlementChoice }): Promise<TrackedTransaction> {
    // `acceptBidAsTokens` spends the whole settlement payout buying HWA on a public pool. A zero
    // minimum is an unbounded-slippage order a sandwich bot can drain almost entirely, so it is
    // refused as invalid input — before a wallet is even prompted — rather than signed.
    if (input.choice.kind === "acceptBidTokens" && input.choice.minTokensOut <= 0n) {
      throw new ProtocolError(
        "PRICE_DRIFTED",
        "Set a minimum HWA amount: settling with no slippage guard would accept any price.",
      );
    }
    const { wallet, account } = await this.connectedWallet();
    const meta = { listingId: input.listingId.toString(), choice: input.choice.kind };
    if (input.choice.kind === "keep") {
      return this.executeWrite("settle_keep", `Keep NFT from #${input.listingId}`, meta, () =>
        wallet.writeContract({ account, address: this.core, abi: fwaCoreAbi, functionName: "keepNFT", args: [input.listingId] }),
      true);
    }
    if (input.choice.kind === "relist") {
      const newBacking = input.choice.newBacking;
      const minBacking = await this.pub.readContract({ address: this.core, abi: fwaCoreAbi, functionName: "minBacking" });
      if (newBacking < minBacking) throw new ProtocolError("BELOW_MIN_BACKING", "Relist backing is below minimum.");
      return this.executeWrite("settle_relist", `Relist NFT from #${input.listingId}`, meta, () =>
        wallet.writeContract({ account, address: this.core, abi: fwaCoreAbi, functionName: "relistNFT", args: [input.listingId], value: newBacking }),
      );
    }
    if (input.choice.kind === "acceptBidHype") {
      return this.executeWrite("settle_accept_bid", `Accept HYPE bid on #${input.listingId}`, meta, () =>
        wallet.writeContract({ account, address: this.core, abi: fwaCoreAbi, functionName: "acceptDepositorBid", args: [input.listingId] }),
      true);
    }
    if (input.choice.kind === "acceptBidTokens") {
      const minTokensOut = input.choice.minTokensOut;
      return this.executeWrite("settle_accept_bid_tokens", `Accept HWA bid on #${input.listingId}`, meta, () =>
        wallet.writeContract({ account, address: this.core, abi: fwaCoreAbi, functionName: "acceptBidAsTokens", args: [input.listingId, minTokensOut] }),
      true);
    }
    if (input.choice.kind === "depositorReclaimNft") {
      return this.executeWrite("depositor_reclaim", `Reclaim NFT from #${input.listingId}`, meta, () =>
        wallet.writeContract({ account, address: this.core, abi: fwaCoreAbi, functionName: "depositorReclaimNFT", args: [input.listingId] }),
      true);
    }
    if (input.choice.kind === "depositorReclaimBacking") {
      return this.executeWrite("depositor_reclaim", `Reclaim backing from #${input.listingId}`, meta, () =>
        wallet.writeContract({ account, address: this.core, abi: fwaCoreAbi, functionName: "depositorReclaimBacking", args: [input.listingId] }),
      true);
    }
    return this.executeWrite("finalize", `Finalize listing #${input.listingId}`, meta, () =>
      wallet.writeContract({ account, address: this.core, abi: fwaCoreAbi, functionName: "finalizeUnsettled", args: [input.listingId] }),
    true);
  }

  async recoverStuckNFT(input: { listingId: bigint }): Promise<TrackedTransaction> {
    const { wallet, account } = await this.connectedWallet();
    return this.executeWrite("recover_stuck_nft", `Recover NFT from #${input.listingId}`, { listingId: input.listingId.toString() }, () =>
      wallet.writeContract({ account, address: this.core, abi: fwaCoreAbi, functionName: "recoverStuckNFT", args: [input.listingId] }),
    true);
  }

  async withdrawEarnings(): Promise<TrackedTransaction> {
    const { wallet, account } = await this.connectedWallet();
    return this.executeWrite("withdraw_earnings", "Withdraw HWA earnings", {}, () =>
      wallet.writeContract({ account, address: this.core, abi: fwaCoreAbi, functionName: "withdrawEarnings" }),
    true);
  }

  async withdrawAcquisitionRefund(): Promise<TrackedTransaction> {
    const { wallet, account } = await this.connectedWallet();
    return this.executeWrite("withdraw_refund", "Withdraw acquisition refund", {}, () =>
      wallet.writeContract({ account, address: this.core, abi: fwaCoreAbi, functionName: "withdrawAcquisitionRefund" }),
    true);
  }

  async claimListingFees(input: { listingIds: bigint[] }): Promise<TrackedTransaction> {
    const { wallet, account } = await this.connectedWallet();
    return this.executeWrite("claim_listing_fees", "Claim listing fees", { listingIds: input.listingIds.join(",") }, () =>
      wallet.writeContract({ account, address: this.core, abi: fwaCoreAbi, functionName: "claimListingFees", args: [input.listingIds] }),
    true);
  }

  async claimCrown(input: { listingId: bigint }): Promise<TrackedTransaction> {
    const { wallet, account } = await this.connectedWallet();
    return this.executeWrite("claim_crown", `Claim crown with #${input.listingId}`, { listingId: input.listingId.toString() }, () =>
      wallet.writeContract({ account, address: this.core, abi: fwaCoreAbi, functionName: "claimTopSpot", args: [input.listingId] }),
    );
  }

  async claimSplitterRevenue(input: { tokenIds: bigint[] }): Promise<TrackedTransaction> {
    if (input.tokenIds.length === 0) throw new ProtocolError("NOT_ELIGIBLE", "No snapshot NFT revenue is claimable.");
    const splitter = this.manifest.contracts.splitter;
    const { wallet, account } = await this.connectedWallet();
    return this.executeWrite(
      "claim_splitter",
      "Claim snapshot-holder HYPE",
      { tokenIds: input.tokenIds.join(",") },
      () => wallet.writeContract({ account, address: splitter, abi: splitterAbi, functionName: "claim", args: [input.tokenIds] }),
      true,
    );
  }

  async claimRewards(input: {
    epochs?: number[];
    listingIds?: bigint[];
    withdrawCredit?: boolean;
    claimAccruedMinOut?: bigint;
  }): Promise<TrackedTransaction> {
    if (HWA_REWARD_CLAIMS_PAUSED) {
      throw new ProtocolError(
        "NOT_ELIGIBLE",
        "HWA claims are paused until the public token launch. Accrued balances remain recorded on-chain.",
      );
    }
    const rewards = this.manifest.contracts.rewards;
    if (!rewards) throw new ProtocolError("NOT_ELIGIBLE", "Rewards module is not configured.");
    const { wallet, account } = await this.connectedWallet();
    if (input.listingIds?.length) {
      return this.executeWrite("claim_rewards", "Claim depositor HWA", { listingIds: input.listingIds.join(",") }, () =>
        wallet.writeContract({ account, address: rewards, abi: fwaRewardsAbi, functionName: "claimDepositorTokens", args: [input.listingIds!] }),
      true);
    }
    if (input.epochs?.length) {
      const epochs = input.epochs.map(BigInt);
      return this.executeWrite("claim_rewards", "Claim epoch HWA", { epochs: input.epochs.join(",") }, () =>
        wallet.writeContract({ account, address: rewards, abi: fwaRewardsAbi, functionName: "claimEpochTokens", args: [epochs] }),
      true);
    }
    if (input.withdrawCredit) {
      return this.executeWrite("claim_rewards", "Withdraw credited HWA", {}, () =>
        wallet.writeContract({ account, address: rewards, abi: fwaRewardsAbi, functionName: "withdrawTokens" }),
      true);
    }
    if (input.claimAccruedMinOut !== undefined) {
      return this.executeWrite("claim_rewards", "Buy accrued HWA", { minOut: input.claimAccruedMinOut.toString() }, () =>
        wallet.writeContract({
          account,
          address: rewards,
          abi: fwaRewardsAbi,
          functionName: "claimAccruedTokens",
          args: [input.claimAccruedMinOut!],
        }),
      true);
    }
    throw new ProtocolError("NOT_ELIGIBLE", "Choose listing rewards or closed epochs to claim.");
  }

  getTrackedTransactions(): TrackedTransaction[] {
    return [...this.txs];
  }

  resumeTracking(): void {
    for (const tx of this.txs) {
      if (tx.hash && (["submitted", "confirming"] as TxPhase[]).includes(tx.phase)) void this.followReceipt(tx);
    }
  }

  dismissTransaction(id: string): void {
    this.txs = this.txs.filter((tx) => tx.id !== id);
    this.persistTransactions();
    this.emit({ scope: "tx", txId: id });
  }

  subscribe(listener: (event: ProtocolEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
