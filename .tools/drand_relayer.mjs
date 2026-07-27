#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, copyFileSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const CHAIN_ID = 998n;
const CHAIN_HASH = "04f1e9062b8a81f848fded9c12306733282b2727ecced50032187751166ec8c3";
const GENESIS_TIME = 1_727_521_075n;
const PERIOD_SECONDS = 3n;
const REQUEST_TOPIC = "0x0552275e27b7fb6e6ef8bc9083694c823f95df330b70c4ef3a059828d715f4ba";
const REQUEST_STATE_SELECTOR = "e9a3c97d";
const root = resolve(import.meta.dirname, "..");
const statePath = resolve(root, ".drand-relayer-state.json");
const temporaryStatePath = `${statePath}.tmp`;

function loadDotEnv() {
  const path = resolve(root, ".env");
  if (!existsSync(path)) return;
  for (const rawLine of readFileSync(path, "utf8").split(/\r?\n/u)) {
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
  const raw = process.env[name]?.trim() || defaultValue;
  const value = BigInt(raw);
  if (value < 0n) throw new Error(`${name} must be non-negative`);
  return value;
}

function assertAddress(value, name) {
  if (!/^0x[0-9a-fA-F]{40}$/u.test(value) || /^0x0{40}$/iu.test(value)) {
    throw new Error(`${name} must be a non-zero EVM address`);
  }
}

loadDotEnv();

const coordinator = required("FWA_DRAND_COORDINATOR_ADDRESS");
assertAddress(coordinator, "FWA_DRAND_COORDINATOR_ADDRESS");
const deploymentBlock = positiveBigInt("FWA_DRAND_DEPLOYMENT_BLOCK", "0");
if (deploymentBlock === 0n) throw new Error("FWA_DRAND_DEPLOYMENT_BLOCK must be set to the deployment block");
const finalityBlocks = positiveBigInt("FWA_DRAND_FINALITY_BLOCKS", "2");
const pollIntervalMs = Number(positiveBigInt("FWA_DRAND_POLL_INTERVAL_MS", "3000"));
if (!Number.isSafeInteger(pollIntervalMs) || pollIntervalMs < 500) {
  throw new Error("FWA_DRAND_POLL_INTERVAL_MS must be a safe integer of at least 500");
}
const rpcUrl = process.env.HYPEREVM_TESTNET_RPC_URL?.trim() || "https://rpc.hyperliquid-testnet.xyz/evm";
const expectedRelayer = required("FWA_DRAND_RELAYER");
assertAddress(expectedRelayer, "FWA_DRAND_RELAYER");
const castExecutable = resolve(root, ".tools", "foundry", "cast.exe");
const candidateKeys = [
  process.env.FWA_DRAND_RELAYER_PRIVATE_KEY?.trim(),
  process.env.FWA_TEST_PURCHASER_PRIVATE_KEY?.trim(),
  process.env.PRIVATE_KEY?.trim(),
].filter(Boolean);
let relayerKey;
for (const candidate of candidateKeys) {
  const derived = spawnSync(castExecutable, ["wallet", "address", "--private-key", candidate], {
    cwd: root,
    encoding: "utf8",
  });
  if (derived.status === 0 && derived.stdout.trim().toLowerCase() === expectedRelayer.toLowerCase()) {
    relayerKey = candidate;
    break;
  }
}
if (!relayerKey) throw new Error("No configured private key matches FWA_DRAND_RELAYER");
// FulfillDrandRelay reads one canonical variable. The key is kept only in this process environment.
process.env.FWA_DRAND_RELAYER_PRIVATE_KEY = relayerKey;

const once = process.argv.includes("--once");
let stopping = false;
let rpcId = 0;

function initialState() {
  return {
    version: 1,
    chainId: CHAIN_ID.toString(),
    coordinator: coordinator.toLowerCase(),
    nextBlock: deploymentBlock.toString(),
    pending: {},
  };
}

function readState() {
  if (!existsSync(statePath)) return initialState();
  const state = JSON.parse(readFileSync(statePath, "utf8"));
  if (state.version !== 1 || state.chainId !== CHAIN_ID.toString()
    || state.coordinator !== coordinator.toLowerCase()) {
    throw new Error("Relayer state belongs to a different chain or coordinator; archive it before restarting");
  }
  return state;
}

function persistState(state) {
  writeFileSync(temporaryStatePath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  copyFileSync(temporaryStatePath, statePath);
  unlinkSync(temporaryStatePath);
}

async function rpc(method, params) {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
  });
  if (!response.ok) throw new Error(`RPC HTTP ${response.status}`);
  const payload = await response.json();
  if (payload.error) throw new Error(`RPC ${method}: ${payload.error.message}`);
  return payload.result;
}

function quantity(value) {
  return `0x${value.toString(16)}`;
}

async function scanRequests(state) {
  const latest = BigInt(await rpc("eth_blockNumber", []));
  if (latest < finalityBlocks) return;
  const safeHead = latest - finalityBlocks;
  let cursor = BigInt(state.nextBlock);
  while (cursor <= safeHead) {
    const end = cursor + 999n < safeHead ? cursor + 999n : safeHead;
    const logs = await rpc("eth_getLogs", [{
      address: coordinator,
      fromBlock: quantity(cursor),
      toBlock: quantity(end),
      topics: [REQUEST_TOPIC],
    }]);
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
  const hex = result.slice(2).padStart(128, "0");
  return {
    targetRound: BigInt(`0x${hex.slice(0, 64)}`),
    status: Number(BigInt(`0x${hex.slice(64, 128)}`)),
  };
}

function roundTimestamp(round) {
  if (round < 1n) throw new Error("Invalid drand round");
  return GENESIS_TIME + (round - 1n) * PERIOD_SECONDS;
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.json();
}

async function verifiedBeacon(round) {
  const path = `${CHAIN_HASH}/public/${round}`;
  const [primary, independent] = await Promise.all([
    fetchJson(`https://api.drand.sh/${path}`),
    fetchJson(`https://drand.cloudflare.com/${path}`),
  ]);
  const expectedRound = Number(round);
  if (primary.round !== expectedRound || independent.round !== expectedRound) {
    throw new Error(`Beacon round mismatch for ${round}`);
  }
  const signature = String(primary.signature).toLowerCase();
  const secondSignature = String(independent.signature).toLowerCase();
  if (!/^[0-9a-f]{128}$/u.test(signature) || signature !== secondSignature) {
    throw new Error(`Independent drand signatures disagree for round ${round}`);
  }
  const randomness = createHash("sha256").update(Buffer.from(signature, "hex")).digest("hex");
  if (randomness !== String(primary.randomness).toLowerCase()
    || randomness !== String(independent.randomness).toLowerCase()) {
    throw new Error(`SHA-256 randomness mismatch for round ${round}`);
  }
  return { signature: `0x${signature}`, randomness };
}

function broadcastFulfillment(requestId, targetRound, signature) {
  const forge = resolve(root, ".tools", "foundry", "forge.exe");
  const environment = {
    ...process.env,
    FWA_DRAND_COORDINATOR_ADDRESS: coordinator,
    FWA_DRAND_REQUEST_ID: requestId,
    FWA_DRAND_ROUND: targetRound,
    FWA_DRAND_SIGNATURE: signature,
  };
  const result = spawnSync(forge, [
    "script",
    "script/FulfillDrandRelay.s.sol:FulfillDrandRelay",
    "--rpc-url",
    rpcUrl,
    "--broadcast",
    "--slow",
    "--non-interactive",
  ], { cwd: root, env: environment, encoding: "utf8", maxBuffer: 10 * 1024 * 1024 });
  if (result.status !== 0) {
    const details = `${result.stdout || ""}\n${result.stderr || ""}`.trim();
    throw new Error(`Fulfillment broadcast failed for request ${requestId}: ${details}`);
  }
}

async function fulfillReady(state) {
  const now = BigInt(Math.floor(Date.now() / 1000));
  for (const [requestId, pending] of Object.entries(state.pending)) {
    const onchain = await requestStatus(requestId);
    if (onchain.status === 2 || onchain.status === 0) {
      delete state.pending[requestId];
      persistState(state);
      continue;
    }
    const targetRound = BigInt(pending.targetRound);
    if (onchain.status !== 1 || onchain.targetRound !== targetRound) {
      throw new Error(`Onchain request ${requestId} does not match persisted target round`);
    }
    if (now < roundTimestamp(targetRound)) continue;

    const beacon = await verifiedBeacon(targetRound);
    broadcastFulfillment(requestId, targetRound.toString(), beacon.signature);
    const completed = await requestStatus(requestId);
    if (completed.status !== 2) throw new Error(`Request ${requestId} did not reach Fulfilled status`);
    delete state.pending[requestId];
    persistState(state);
    console.log(`fulfilled request=${requestId} round=${targetRound} randomness=0x${beacon.randomness}`);
  }
}

const state = readState();
process.on("SIGINT", () => { stopping = true; });
process.on("SIGTERM", () => { stopping = true; });

console.log(`drand relayer chain=${CHAIN_ID} coordinator=${coordinator} nextBlock=${state.nextBlock}`);
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
