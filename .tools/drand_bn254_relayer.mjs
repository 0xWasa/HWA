#!/usr/bin/env node

import { createHash } from "node:crypto";
import { copyFileSync, existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const CHAIN_HASH = "04f1e9062b8a81f848fded9c12306733282b2727ecced50032187751166ec8c3";
const GENESIS_TIME = 1_727_521_075n;
const PERIOD_SECONDS = 3n;
const REQUEST_TOPIC = "0xcfb07f565f3053ec143b78e29bea8c1283aad4c48e2ad8ed65af0e179419d405";
const REQUEST_STATE_SELECTOR = "e9a3c97d";
const root = resolve(import.meta.dirname, "..");

function loadExplicitEnv() {
  const argument = process.argv.find((item) => item.startsWith("--env-file="));
  if (!argument) return;
  const envPath = resolve(process.cwd(), argument.slice("--env-file=".length));
  if (!existsSync(envPath)) throw new Error(`Env file does not exist: ${envPath}`);
  for (const rawLine of readFileSync(envPath, "utf8").split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function positiveBigInt(name, defaultValue) {
  const value = BigInt(process.env[name]?.trim() || defaultValue);
  if (value < 0n) throw new Error(`${name} must be non-negative`);
  return value;
}

function assertAddress(value, name) {
  if (!/^0x[0-9a-fA-F]{40}$/u.test(value) || /^0x0{40}$/iu.test(value)) {
    throw new Error(`${name} must be a non-zero EVM address`);
  }
}

loadExplicitEnv();
const CHAIN_ID = positiveBigInt("HYPEREVM_CHAIN_ID", "999");
if (CHAIN_ID !== 998n && CHAIN_ID !== 999n) throw new Error("HYPEREVM_CHAIN_ID must be 998 or 999");
const statePath = resolve(root, `.drand-bn254-relayer-state-${CHAIN_ID}.json`);
const temporaryStatePath = `${statePath}.tmp`;
const coordinator = required("FWA_DRAND_BN254_COORDINATOR_ADDRESS");
const registry = required("FWA_DRAND_REGISTRY_ADDRESS");
assertAddress(coordinator, "FWA_DRAND_BN254_COORDINATOR_ADDRESS");
assertAddress(registry, "FWA_DRAND_REGISTRY_ADDRESS");
const deploymentBlock = positiveBigInt("FWA_DRAND_DEPLOYMENT_BLOCK", "0");
if (deploymentBlock === 0n) throw new Error("FWA_DRAND_DEPLOYMENT_BLOCK must be set");
const finalityBlocks = positiveBigInt("FWA_DRAND_FINALITY_BLOCKS", "3");
const pollIntervalMs = Number(positiveBigInt("FWA_DRAND_POLL_INTERVAL_MS", "3000"));
if (!Number.isSafeInteger(pollIntervalMs) || pollIntervalMs < 500) throw new Error("Invalid poll interval");
const rpcUrl = process.env.HYPEREVM_RPC_URL?.trim()
  || process.env.HYPEREVM_MAINNET_RPC_URL?.trim()
  || (CHAIN_ID === 998n ? "https://rpcs.chain.link/hyperevm/testnet" : "https://rpc.hyperliquid.xyz/evm");
const logRpcUrl = process.env.HYPEREVM_LOG_RPC_URL?.trim() || rpcUrl;
const logRpcMaxBlockRange = positiveBigInt("HYPEREVM_LOG_RPC_MAX_BLOCK_RANGE", logRpcUrl === rpcUrl ? "50" : "2500");
if (logRpcMaxBlockRange === 0n) throw new Error("HYPEREVM_LOG_RPC_MAX_BLOCK_RANGE must be positive");
const logRpcApiKey = process.env.HYPEREVM_LOG_RPC_API_KEY?.trim() || "";
const logRpcApiKeyHeader = process.env.HYPEREVM_LOG_RPC_API_KEY_HEADER?.trim().toLowerCase() || "x-api-key";
if (!/^[a-z0-9-]{1,64}$/u.test(logRpcApiKeyHeader)) throw new Error("Invalid HYPEREVM_LOG_RPC_API_KEY_HEADER");
const fairnessAlertBlocks = positiveBigInt("FWA_DRAND_FAIRNESS_ALERT_BLOCKS", "120");
const submitterKey = required("FWA_DRAND_SUBMITTER_PRIVATE_KEY");
const forge = resolve(root, ".tools", "foundry", "forge.exe");
const cast = resolve(root, ".tools", "foundry", "cast.exe");
const derived = spawnSync(cast, ["wallet", "address", "--private-key", submitterKey], { cwd: root, encoding: "utf8" });
if (derived.status !== 0) throw new Error("Invalid FWA_DRAND_SUBMITTER_PRIVATE_KEY");

const once = process.argv.includes("--once");
const proveLatest = process.argv.includes("--prove-latest");
let stopping = false;
let rpcId = 0;

function initialState() {
  return { version: 1, chainId: CHAIN_ID.toString(), coordinator: coordinator.toLowerCase(), nextBlock: deploymentBlock.toString(), pending: {} };
}

function readState() {
  if (!existsSync(statePath)) return initialState();
  const state = JSON.parse(readFileSync(statePath, "utf8"));
  if (state.version !== 1 || state.chainId !== CHAIN_ID.toString() || state.coordinator !== coordinator.toLowerCase()) {
    throw new Error("Relayer state belongs to a different chain or coordinator");
  }
  return state;
}

function persistState(state) {
  writeFileSync(temporaryStatePath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  copyFileSync(temporaryStatePath, statePath);
  unlinkSync(temporaryStatePath);
}

async function rpc(method, params, endpoint = rpcUrl) {
  const headers = { "content-type": "application/json" };
  if (endpoint === logRpcUrl && logRpcApiKey) headers[logRpcApiKeyHeader] = logRpcApiKey;
  const response = await fetch(endpoint, { method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }) });
  if (!response.ok) throw new Error(`RPC HTTP ${response.status}`);
  const payload = await response.json();
  if (payload.error) throw new Error(`RPC ${method}: ${payload.error.message}`);
  return payload.result;
}

function quantity(value) { return `0x${value.toString(16)}`; }

async function assertChain() {
  const chainId = BigInt(await rpc("eth_chainId", []));
  if (chainId !== CHAIN_ID) throw new Error(`Expected chain ${CHAIN_ID}, got ${chainId}`);
}

async function scanRequests(state) {
  const latest = BigInt(await rpc("eth_blockNumber", []));
  if (latest < finalityBlocks) return;
  const safeHead = latest - finalityBlocks;
  let cursor = BigInt(state.nextBlock);
  while (cursor <= safeHead) {
    const end = cursor + logRpcMaxBlockRange - 1n < safeHead ? cursor + logRpcMaxBlockRange - 1n : safeHead;
    const logs = await rpc("eth_getLogs", [{ address: coordinator, fromBlock: quantity(cursor), toBlock: quantity(end), topics: [REQUEST_TOPIC] }], logRpcUrl);
    for (const log of logs) {
      if (!Array.isArray(log.topics) || log.topics.length < 3) continue;
      const requestId = BigInt(log.topics[1]).toString();
      const targetRound = BigInt(log.topics[2]).toString();
      state.pending[requestId] ??= { targetRound, discoveredBlock: BigInt(log.blockNumber).toString() };
    }
    cursor = end + 1n;
    state.nextBlock = cursor.toString();
    persistState(state);
  }
}

async function requestStatus(requestId) {
  const argument = BigInt(requestId).toString(16).padStart(64, "0");
  const result = await rpc("eth_call", [{ to: coordinator, data: `0x${REQUEST_STATE_SELECTOR}${argument}` }, "latest"]);
  const hex = result.slice(2).padStart(192, "0");
  return {
    targetRound: BigInt(`0x${hex.slice(0, 64)}`),
    expiresAtBlock: BigInt(`0x${hex.slice(64, 128)}`),
    status: Number(BigInt(`0x${hex.slice(128, 192)}`)),
  };
}

function roundTimestamp(round) {
  if (round < 1n) throw new Error("Invalid drand round");
  return GENESIS_TIME + (round - 1n) * PERIOD_SECONDS;
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.json();
}

async function verifiedBeacon(round) {
  const suffix = round === "latest" ? "latest" : round.toString();
  const path = `${CHAIN_HASH}/public/${suffix}`;
  const [primary, independent] = await Promise.all([
    fetchJson(`https://api.drand.sh/${path}`),
    fetchJson(`https://drand.cloudflare.com/${path}`),
  ]);
  if (primary.round !== independent.round || (round !== "latest" && BigInt(primary.round) !== round)) throw new Error("Beacon round mismatch");
  const signature = String(primary.signature).toLowerCase();
  if (!/^[0-9a-f]{128}$/u.test(signature) || signature !== String(independent.signature).toLowerCase()) throw new Error("Independent drand signatures disagree");
  const randomness = createHash("sha256").update(Buffer.from(signature, "hex")).digest("hex");
  if (randomness !== String(primary.randomness).toLowerCase() || randomness !== String(independent.randomness).toLowerCase()) throw new Error("SHA-256 randomness mismatch");
  return { round: BigInt(primary.round), signature: `0x${signature}`, randomness: `0x${randomness}` };
}

function broadcast(scriptTarget, environment) {
  const result = spawnSync(forge, ["script", scriptTarget, "--rpc-url", rpcUrl, "--broadcast", "--slow", "--non-interactive"], {
    cwd: root,
    env: { ...process.env, ...environment, DRAND_PROOF_SUBMISSION_CONFIRMED: "true" },
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.status !== 0) throw new Error(`${scriptTarget} failed: ${`${result.stdout || ""}\n${result.stderr || ""}`.trim()}`);
}

function prove(beacon) {
  broadcast("script/ProveDrandEvmnetRound.s.sol:ProveDrandEvmnetRound", {
    FWA_DRAND_REGISTRY_ADDRESS: registry,
    FWA_DRAND_ROUND: beacon.round.toString(),
    FWA_DRAND_SIGNATURE: beacon.signature,
  });
}

function fulfill(requestId, beacon) {
  broadcast("script/FulfillDrandBN254.s.sol:FulfillDrandBN254", {
    FWA_DRAND_BN254_COORDINATOR_ADDRESS: coordinator,
    FWA_DRAND_REQUEST_ID: requestId,
    FWA_DRAND_ROUND: beacon.round.toString(),
    FWA_DRAND_SIGNATURE: beacon.signature,
  });
}

async function fulfillReady(state) {
  const now = BigInt(Math.floor(Date.now() / 1000));
  const head = BigInt(await rpc("eth_blockNumber", []));
  for (const [requestId, persisted] of Object.entries(state.pending)) {
    const current = await requestStatus(requestId);
    if (current.status === 0 || current.status === 2 || current.status === 3) {
      delete state.pending[requestId];
      persistState(state);
      continue;
    }
    const targetRound = BigInt(persisted.targetRound);
    if (current.status !== 1 || current.targetRound !== targetRound) throw new Error(`Request ${requestId} state mismatch`);
    if (current.expiresAtBlock <= head + fairnessAlertBlocks) {
      console.error(`FAIRNESS_ALERT request=${requestId} expiresAt=${current.expiresAtBlock} head=${head}`);
    }
    if (now < roundTimestamp(targetRound)) continue;
    const beacon = await verifiedBeacon(targetRound);
    fulfill(requestId, beacon);
    const completed = await requestStatus(requestId);
    if (completed.status !== 2) throw new Error(`Request ${requestId} did not reach Fulfilled`);
    delete state.pending[requestId];
    persistState(state);
    console.log(`fulfilled request=${requestId} round=${targetRound} randomness=${beacon.randomness}`);
  }
}

await assertChain();
if (proveLatest) {
  const beacon = await verifiedBeacon("latest");
  prove(beacon);
  console.log(`proven heartbeat round=${beacon.round} randomness=${beacon.randomness}`);
  process.exit(0);
}

const state = readState();
process.on("SIGINT", () => { stopping = true; });
process.on("SIGTERM", () => { stopping = true; });
console.log(`permissionless drand BN254 relayer chain=${CHAIN_ID} submitter=${derived.stdout.trim()} nextBlock=${state.nextBlock} logRange=${logRpcMaxBlockRange}`);
do {
  try {
    await scanRequests(state);
    await fulfillReady(state);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    if (once) process.exitCode = 1;
  }
  if (once || stopping) break;
  await new Promise((resolveDelay) => setTimeout(resolveDelay, pollIntervalMs));
} while (!stopping);
persistState(state);
