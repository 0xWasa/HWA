import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  concatHex,
  createPublicClient,
  encodeAbiParameters,
  getAddress,
  http,
  keccak256,
  parseAbi,
  toHex,
} from "viem";

const TRANSFER_TOPIC = keccak256(toHex("Transfer(address,address,uint256)"));
const ACQUISITION_TOPIC = keccak256(
  toHex("AcquisitionRewardRegistered(uint256,address,uint64,uint256,uint256)"),
);
const LISTING_ACTIVATED_TOPIC = keccak256(
  toHex("ListingRewardActivated(uint256,address,uint256,uint256)"),
);
const ZERO = "0x0000000000000000000000000000000000000000";
const MAX_DEFAULT = 100_000_000n * 10n ** 18n;

const tokenAbi = parseAbi([
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
]);
const coreAbi = parseAbi(["function nextListingId() view returns (uint256)"]);
const rewardsAbi = parseAbi([
  "function claimsEnabled() view returns (bool)",
  "function currentEpoch() view returns (uint64)",
  "function listingRewards(uint256) view returns (address depositor, bool active, uint256 sqrtBacking, uint256 tokenDebt)",
  "function pendingDepositorTokens(uint256) view returns (uint256)",
  "function tokenCredit(address) view returns (uint256)",
  "function pendingAcquisitionsInEpoch(uint256) view returns (uint256)",
  "function epochFinalized(uint256) view returns (bool)",
  "function purchaserEpochSwept(uint256) view returns (bool)",
  "function purchaserClaimed(uint256,address) view returns (bool)",
  "function userSettledHypeInEpoch(uint256,address) view returns (uint256)",
  "function settledHypeInEpoch(uint256) view returns (uint256)",
  "function purchaserEpochAmount(uint256) view returns (uint256)",
  "function tokenLiability() view returns (uint256)",
  "function seasonalReserveRemaining() view returns (uint256)",
  "function seasonalEmitted() view returns (uint256)",
  "function seasonalBurned() view returns (uint256)",
]);

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function boolEnv(name) {
  return process.env[name]?.trim().toLowerCase() === "true";
}

function topicAddress(topic) {
  return getAddress(`0x${topic.slice(-40)}`);
}

function addAmount(map, account, amount) {
  if (amount === 0n) return;
  const key = getAddress(account);
  map.set(key, (map.get(key) ?? 0n) + amount);
}

async function rpcLogs(client, address, topic0, fromBlock, toBlock, step) {
  const logs = [];
  for (let cursor = fromBlock; cursor <= toBlock; cursor += step) {
    const end = cursor + step - 1n > toBlock ? toBlock : cursor + step - 1n;
    const page = await client.request({
      method: "eth_getLogs",
      params: [{
        address,
        fromBlock: toHex(cursor),
        toBlock: toHex(end),
        topics: [topic0],
      }],
    });
    logs.push(...page);
  }
  return logs;
}

export function migrationLeaf(account, amount) {
  const inner = keccak256(
    encodeAbiParameters(
      [{ type: "address" }, { type: "uint256" }],
      [getAddress(account), amount],
    ),
  );
  return keccak256(inner);
}

function hashPair(a, b) {
  return keccak256(a.toLowerCase() < b.toLowerCase() ? concatHex([a, b]) : concatHex([b, a]));
}

export function buildTree(rows) {
  if (rows.length === 0) throw new Error("migration tree cannot be empty");
  const proofs = rows.map(() => []);
  let level = rows.map((row, index) => ({
    hash: migrationLeaf(row.account, row.amount),
    indexes: [index],
  }));
  while (level.length > 1) {
    const next = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i];
      const right = level[i + 1];
      if (!right) {
        next.push(left);
        continue;
      }
      for (const index of left.indexes) proofs[index].push(right.hash);
      for (const index of right.indexes) proofs[index].push(left.hash);
      next.push({ hash: hashPair(left.hash, right.hash), indexes: [...left.indexes, ...right.indexes] });
    }
    level = next;
  }
  const root = level[0].hash;
  rows.forEach((row, index) => {
    let computed = migrationLeaf(row.account, row.amount);
    for (const sibling of proofs[index]) computed = hashPair(computed, sibling);
    if (computed !== root) throw new Error(`proof self-check failed for ${row.account}`);
  });
  return { root, proofs };
}

async function loadConfig(path) {
  const parsed = JSON.parse(await readFile(path, "utf8"));
  const excluded = new Map();
  for (const item of parsed.excluded ?? []) {
    const address = getAddress(item.address);
    if (excluded.has(address)) throw new Error(`duplicate excluded address ${address}`);
    excluded.set(address, String(item.reason ?? "unspecified"));
  }
  excluded.set(getAddress(ZERO), "zero address");
  return { ...parsed, excluded };
}

async function reconstructLiquidBalances(client, token, fromBlock, snapshotBlock, step) {
  const balances = new Map();
  const logs = await rpcLogs(client, token, TRANSFER_TOPIC, fromBlock, snapshotBlock, step);
  for (const log of logs) {
    const from = topicAddress(log.topics[1]);
    const to = topicAddress(log.topics[2]);
    const amount = BigInt(log.data);
    if (from.toLowerCase() !== ZERO) addAmount(balances, from, -amount);
    if (to.toLowerCase() !== ZERO) addAmount(balances, to, amount);
  }
  for (const [account, amount] of balances) {
    if (amount < 0n) throw new Error(`negative reconstructed balance for ${account}`);
    if (amount === 0n) balances.delete(account);
  }
  return balances;
}

async function rewardEntitlements(client, logClient, core, rewards, fromBlock, snapshotBlock, step) {
  const claimsEnabled = await client.readContract({ address: rewards, abi: rewardsAbi, functionName: "claimsEnabled", blockNumber: snapshotBlock });
  if (claimsEnabled) throw new Error("legacy reward claims must be paused at the snapshot block");

  const entitlements = new Map();
  const depositors = new Set();
  const nextListingId = await client.readContract({ address: core, abi: coreAbi, functionName: "nextListingId", blockNumber: snapshotBlock });
  for (let listingId = 1n; listingId < nextListingId; listingId += 1n) {
    const [depositor, active] = await client.readContract({
      address: rewards,
      abi: rewardsAbi,
      functionName: "listingRewards",
      args: [listingId],
      blockNumber: snapshotBlock,
    });
    if (depositor !== ZERO) depositors.add(getAddress(depositor));
    if (active) {
      const pending = await client.readContract({
        address: rewards,
        abi: rewardsAbi,
        functionName: "pendingDepositorTokens",
        args: [listingId],
        blockNumber: snapshotBlock,
      });
      addAmount(entitlements, depositor, pending);
    }
  }
  const listingLogs = await rpcLogs(logClient, rewards, LISTING_ACTIVATED_TOPIC, fromBlock, snapshotBlock, step);
  for (const log of listingLogs) depositors.add(topicAddress(log.topics[2]));
  for (const depositor of depositors) {
    const credit = await client.readContract({ address: rewards, abi: rewardsAbi, functionName: "tokenCredit", args: [depositor], blockNumber: snapshotBlock });
    addAmount(entitlements, depositor, credit);
  }

  const buyers = new Set();
  const logs = await rpcLogs(logClient, rewards, ACQUISITION_TOPIC, fromBlock, snapshotBlock, step);
  for (const log of logs) buyers.add(topicAddress(log.topics[2]));

  const currentEpoch = BigInt(await client.readContract({ address: rewards, abi: rewardsAbi, functionName: "currentEpoch", blockNumber: snapshotBlock }));
  for (let epoch = 0n; epoch <= currentEpoch; epoch += 1n) {
    const pending = await client.readContract({ address: rewards, abi: rewardsAbi, functionName: "pendingAcquisitionsInEpoch", args: [epoch], blockNumber: snapshotBlock });
    if (pending !== 0n) throw new Error(`epoch ${epoch} still has ${pending} pending acquisitions`);
    const finalized = await client.readContract({ address: rewards, abi: rewardsAbi, functionName: "epochFinalized", args: [epoch], blockNumber: snapshotBlock });
    if (epoch < currentEpoch && !finalized) throw new Error(`closed epoch ${epoch} is not finalized`);
    if (epoch === currentEpoch && !finalized && !boolEnv("HWA_V2_ALLOW_OPEN_REWARD_EPOCH")) {
      throw new Error("current reward epoch is open; finalize it or explicitly set HWA_V2_ALLOW_OPEN_REWARD_EPOCH=true after protocol freeze");
    }
    const swept = await client.readContract({ address: rewards, abi: rewardsAbi, functionName: "purchaserEpochSwept", args: [epoch], blockNumber: snapshotBlock });
    if (swept) continue;
    const totalWeight = await client.readContract({ address: rewards, abi: rewardsAbi, functionName: "settledHypeInEpoch", args: [epoch], blockNumber: snapshotBlock });
    const pot = await client.readContract({ address: rewards, abi: rewardsAbi, functionName: "purchaserEpochAmount", args: [epoch], blockNumber: snapshotBlock });
    if (totalWeight === 0n || pot === 0n) continue;
    for (const buyer of buyers) {
      const alreadyClaimed = await client.readContract({ address: rewards, abi: rewardsAbi, functionName: "purchaserClaimed", args: [epoch, buyer], blockNumber: snapshotBlock });
      if (alreadyClaimed) continue;
      const mine = await client.readContract({ address: rewards, abi: rewardsAbi, functionName: "userSettledHypeInEpoch", args: [epoch, buyer], blockNumber: snapshotBlock });
      if (mine !== 0n) addAmount(entitlements, buyer, (pot * mine) / totalWeight);
    }
  }

  const state = {};
  for (const name of ["tokenLiability", "seasonalReserveRemaining", "seasonalEmitted", "seasonalBurned"]) {
    state[name] = await client.readContract({ address: rewards, abi: rewardsAbi, functionName: name, blockNumber: snapshotBlock });
  }
  return { entitlements, state, currentEpoch, nextListingId };
}

async function main() {
  const rpcUrl = required("HYPEREVM_RPC_URL");
  const configPath = resolve(process.argv[2] ?? "release/hwa-v2-migration-exclusions.json");
  const outputPath = resolve(process.argv[3] ?? "release/hwa-v2-migration-snapshot.json");
  const config = await loadConfig(configPath);
  const token = getAddress(config.token);
  const core = getAddress(config.core);
  const rewards = getAddress(config.rewards);
  const fromBlock = BigInt(config.deploymentBlock);
  const snapshotBlock = BigInt(required("HWA_V2_SNAPSHOT_BLOCK"));
  const step = BigInt(process.env.HWA_V2_LOG_BLOCK_STEP ?? "1000");
  if (!boolEnv("HWA_V2_SNAPSHOT_CONFIRM_EXCLUSIONS")) throw new Error("HWA_V2_SNAPSHOT_CONFIRM_EXCLUSIONS=true is required");
  if (snapshotBlock < fromBlock || step <= 0n) throw new Error("invalid snapshot block configuration");

  const client = createPublicClient({ transport: http(rpcUrl, { retryCount: 4 }) });
  const configuredLogRpcUrl = process.env.HYPEREVM_LOG_RPC_URL?.trim()
    || process.env.HYPEREVM_LOG_RPC_UPSTREAM_URL?.trim()
    || process.env.NEXT_PUBLIC_HYPEREVM_LOG_RPC_URL?.trim()
    || rpcUrl;
  const logRpcUrl = configuredLogRpcUrl.startsWith("/")
    ? new URL(configuredLogRpcUrl, process.env.HWA_V2_LOG_RPC_ORIGIN?.trim() || "https://hwa.fun").toString()
    : configuredLogRpcUrl;
  const logApiKey = process.env.HYPEREVM_LOG_RPC_API_KEY?.trim();
  const logApiKeyHeader = (process.env.HYPEREVM_LOG_RPC_API_KEY_HEADER?.trim() || "x-api-key").toLowerCase();
  if (!/^[a-z0-9-]{1,64}$/.test(logApiKeyHeader)) throw new Error("invalid log RPC API key header");
  const logHeaders = logApiKey ? { [logApiKeyHeader]: logApiKey } : undefined;
  const logClient = createPublicClient({
    transport: http(logRpcUrl, { retryCount: 4, fetchOptions: { headers: logHeaders } }),
  });
  const chainId = await client.getChainId();
  if (chainId !== Number(config.chainId)) throw new Error(`wrong chain ${chainId}`);
  const block = await client.getBlock({ blockNumber: snapshotBlock });
  const totalSupply = await client.readContract({ address: token, abi: tokenAbi, functionName: "totalSupply", blockNumber: snapshotBlock });
  const liquid = await reconstructLiquidBalances(logClient, token, fromBlock, snapshotBlock, step);
  const rewardsSnapshot = await rewardEntitlements(client, logClient, core, rewards, fromBlock, snapshotBlock, step);

  let reconstructedSupply = 0n;
  for (const amount of liquid.values()) reconstructedSupply += amount;
  if (reconstructedSupply !== totalSupply) throw new Error(`transfer reconstruction ${reconstructedSupply} != totalSupply ${totalSupply}`);

  const allocations = new Map();
  const excludedBalances = [];
  for (const [account, amount] of liquid) {
    const reason = config.excluded.get(account);
    if (reason) excludedBalances.push({ account, amount, reason });
    else addAmount(allocations, account, amount);
  }
  for (const [account, amount] of rewardsSnapshot.entitlements) {
    if (config.excluded.has(account)) throw new Error(`reward entitlement belongs to excluded address ${account}`);
    addAmount(allocations, account, amount);
  }

  const rows = [...allocations]
    .filter(([, amount]) => amount > 0n)
    .map(([account, amount]) => ({
      account,
      amount,
      liquidAmount: liquid.get(account) ?? 0n,
      legacyRewardAmount: rewardsSnapshot.entitlements.get(account) ?? 0n,
    }))
    .sort((a, b) => a.account.toLowerCase().localeCompare(b.account.toLowerCase()));
  const migrationAllocation = rows.reduce((sum, row) => sum + row.amount, 0n);
  const maxAllocation = BigInt(process.env.HWA_V2_MAX_MIGRATION_ALLOCATION_WEI ?? MAX_DEFAULT);
  if (migrationAllocation > maxAllocation) throw new Error(`migration allocation ${migrationAllocation} exceeds ${maxAllocation}`);
  const { root, proofs } = buildTree(rows);

  const artifact = {
    schemaVersion: 1,
    chainId,
    token,
    core,
    rewards,
    deploymentBlock: fromBlock.toString(),
    snapshotBlock: snapshotBlock.toString(),
    snapshotBlockHash: block.hash,
    totalSupplyWei: totalSupply.toString(),
    reconstructedSupplyWei: reconstructedSupply.toString(),
    merkleRoot: root,
    migrationAllocationWei: migrationAllocation.toString(),
    liquidAllocationWei: rows.reduce((sum, row) => sum + row.liquidAmount, 0n).toString(),
    legacyRewardCompensationWei: rows.reduce((sum, row) => sum + row.legacyRewardAmount, 0n).toString(),
    legacyRewardsState: Object.fromEntries(Object.entries(rewardsSnapshot.state).map(([key, value]) => [key, value.toString()])),
    currentRewardEpoch: rewardsSnapshot.currentEpoch.toString(),
    nextListingId: rewardsSnapshot.nextListingId.toString(),
    excluded: [...config.excluded].map(([account, reason]) => ({ account, reason })),
    excludedBalances: excludedBalances.map((row) => ({ ...row, amountWei: row.amount.toString(), amount: undefined })),
    claims: rows.map((row, index) => ({
      account: row.account,
      amountWei: row.amount.toString(),
      liquidAmountWei: row.liquidAmount.toString(),
      legacyRewardAmountWei: row.legacyRewardAmount.toString(),
      proof: proofs[index],
    })),
  };

  await mkdir(dirname(outputPath), { recursive: true });
  const temporary = `${outputPath}.tmp`;
  await writeFile(temporary, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  await rename(temporary, outputPath);
  process.stdout.write(`${JSON.stringify({ outputPath, snapshotBlock: artifact.snapshotBlock, merkleRoot: root, migrationAllocationWei: artifact.migrationAllocationWei, claims: rows.length }, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write(`${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  });
}