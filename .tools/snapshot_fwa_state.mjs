import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const ROOT = resolve("FWA_ETHEREUM_REFERENCE");
const ETH_RPC = "https://ethereum-rpc.publicnode.com";
const LOG_RPC = "https://eth.drpc.org";
const FWA = "0xB276F62DB0ce8CA2Ca5bc522695bE604521eAc1c";
const WHITELIST = "0x854352b275cF6A0DfFCf2983C986FBe9345e17c3";

const INITIAL_COLLECTIONS = {
  TenThousandTokens: "0x26D7Ad0E930b54b84C00DAad077Ee31Ba9e2Fb2E",
  CryptoPunks721: "0x000000000000003607fce1aC9e043a86675C5C2F",
  MiladyMaker: "0x5Af0D9827E0c53E4799BB226655A1de152A425a5",
  BAYC: "0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D",
  Azuki: "0xED5AF388653567Af2F388E6224dC7C4b3241C544",
  Doodles: "0x8a90CAb2b38dba80c64b7734e58Ee1dB38B8992e",
  CrypToadz: "0x1CB1A5e65610AEFF2551A50f76a87a7d3fB649C6",
  PudgyPenguins: "0xBd3531dA5CF5857e7CfAA92426877b022e612cf8",
  Meebits: "0x7Bd29408f11D2bFC23c34f18275bBf23bB716Bc7",
  Checks: "0x036721e5A769Cc48B3189EFbb9ccE4471E8A48B1",
  MaxPainAndFrens: "0xd1169e5349d1cB9941F3DCbA135C8A4b9eACFDDE",
  XCORE: "0xC04E0000726ED7c5b9f0045Bc0c4806321BC6C65",
  CryptoDickbutts: "0x42069ABFE407C60cf4ae4112bEDEaD391dBa1cdB",
  VeeFriends: "0xa3AEe8BcE55BEeA1951EF834b99f3Ac60d1ABeeB",
  Mfers: "0x79FCDEF22feeD20eDDacbB2587640e45491b757f",
  DeadFellaz: "0x2acAb3DEa77832C09420663b0E1cB386031bA17B",
};

const CONFIG_KEYS = {
  1: "CALLBACK_GAS_LIMIT",
  2: "VRF_SUB_ID",
  7: "REQUEST_CONFIRMATIONS",
  10: "MAX_ACTIVATIONS_PER_ACQUISITION",
  11: "SELECTION_TIMEOUT_BLOCKS",
  12: "MAX_ACQUISITIONS_PER_TX",
  13: "SURCHARGE_BPS",
  14: "SELECTION_SLIPPAGE_BPS",
  15: "TOP_LISTING_SHARE_BPS",
  16: "TOP_THRESHOLD_BPS",
  17: "SETTLEMENT_DISCOUNT_BPS",
  18: "OWNER_ACQUISITION_FEE_BPS",
  19: "OWNER_SETTLEMENT_FEE_BPS",
  20: "SETTLEMENT_WINDOW",
  21: "FINALIZE_WINDOW",
  22: "MIN_BACKING",
  23: "PROTOCOL_FEE_TO_TOKEN_BPS",
  24: "VRF_KEY_HASH",
  25: "MAX_STAGED_LISTINGS",
  40: "RETAINED_TO_PROTOCOL",
  41: "ACQUISITIONS_ENABLED",
  42: "WITHDRAW_ONLY",
  43: "WHITELIST_ENABLED",
  44: "ACCEPT_BID_AS_TOKENS_ENABLED",
  60: "VRF_COORDINATOR",
  61: "PAYOUT_ADDRESS",
  62: "WHITELIST_MANAGER",
  63: "VRF_SERVICE",
};

async function rpc(method, params = [], endpoint = ETH_RPC) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!response.ok) throw new Error(`${endpoint} ${method}: HTTP ${response.status}`);
  const body = await response.json();
  if (body.error) throw new Error(`${endpoint} ${method}: ${JSON.stringify(body.error)}`);
  return body.result;
}

const hexBlock = (n) => `0x${BigInt(n).toString(16)}`;
const wordAt = (hex, index) => hex.slice(2 + index * 64, 2 + (index + 1) * 64).padEnd(64, "0");

function isDynamic(param) {
  if (param.type === "string" || param.type === "bytes" || param.type.endsWith("[]")) return true;
  if (param.type.startsWith("tuple")) return (param.components ?? []).some(isDynamic);
  return false;
}

function staticWords(param) {
  if (param.type.startsWith("tuple")) return (param.components ?? []).reduce((n, c) => n + staticWords(c), 0);
  if (/\[[0-9]+\]$/.test(param.type)) {
    const count = Number(param.type.match(/\[([0-9]+)\]$/)[1]);
    return count;
  }
  return 1;
}

function decodeInteger(type, word) {
  const signed = type.startsWith("int");
  const bits = Number(type.match(/[0-9]+/)?.[0] ?? 256);
  let value = BigInt(`0x${word}`);
  if (signed && value >= (1n << BigInt(bits - 1))) value -= 1n << BigInt(bits);
  return value.toString();
}

function decodeStatic(param, data, wordIndex) {
  if (param.type.startsWith("tuple")) {
    const value = {};
    let cursor = wordIndex;
    for (let i = 0; i < (param.components ?? []).length; i++) {
      const component = param.components[i];
      value[component.name || String(i)] = decodeStatic(component, data, cursor);
      cursor += staticWords(component);
    }
    return value;
  }
  const word = wordAt(data, wordIndex);
  if (param.type === "address") return `0x${word.slice(24)}`;
  if (param.type === "bool") return BigInt(`0x${word}`) !== 0n;
  if (/^u?int/.test(param.type)) return decodeInteger(param.type, word);
  if (/^bytes[0-9]+$/.test(param.type)) return `0x${word.slice(0, Number(param.type.slice(5)) * 2)}`;
  return `0x${word}`;
}

function decodeDynamic(param, data, byteOffset) {
  const wordIndex = Number(byteOffset / 32n);
  if (param.type === "string" || param.type === "bytes") {
    const length = Number(BigInt(`0x${wordAt(data, wordIndex)}`));
    const start = 2 + (wordIndex + 1) * 64;
    const raw = data.slice(start, start + length * 2);
    return param.type === "string" ? Buffer.from(raw, "hex").toString("utf8") : `0x${raw}`;
  }
  throw new Error(`Unsupported dynamic ABI output: ${param.type}`);
}

function decodeOutputs(outputs, data) {
  const values = {};
  let head = 0;
  for (let i = 0; i < outputs.length; i++) {
    const output = outputs[i];
    let value;
    if (isDynamic(output)) value = decodeDynamic(output, data, BigInt(`0x${wordAt(data, head)}`));
    else value = decodeStatic(output, data, head);
    values[output.name || String(i)] = value;
    head += isDynamic(output) ? 1 : staticWords(output);
  }
  return values;
}

async function selector(signature) {
  const hash = await rpc("web3_sha3", [`0x${Buffer.from(signature).toString("hex")}`]);
  return hash.slice(0, 10);
}

async function call(address, abiItem, block, encodedArgs = "") {
  const signature = `${abiItem.name}(${(abiItem.inputs ?? []).map((i) => i.type).join(",")})`;
  const data = `${await selector(signature)}${encodedArgs}`;
  const result = await rpc("eth_call", [{ to: address, data }, block]);
  return decodeOutputs(abiItem.outputs ?? [], result);
}

async function getLogs(address, signature, fromBlock, toBlock) {
  const topic0 = await rpc("web3_sha3", [`0x${Buffer.from(signature).toString("hex")}`]);
  const logs = [];
  const chunk = 9_999n;
  for (let from = BigInt(fromBlock); from <= BigInt(toBlock); from += chunk + 1n) {
    const to = from + chunk > BigInt(toBlock) ? BigInt(toBlock) : from + chunk;
    let attempt = 0;
    while (true) {
      try {
        const page = await rpc("eth_getLogs", [{ address, fromBlock: hexBlock(from), toBlock: hexBlock(to), topics: [topic0] }], LOG_RPC);
        logs.push(...page);
        break;
      } catch (error) {
        attempt++;
        if (attempt >= 4) throw error;
        await new Promise((done) => setTimeout(done, attempt * 500));
      }
    }
  }
  return logs;
}

function decodeAddressTopic(topic) {
  return `0x${topic.slice(-40)}`;
}

async function snapshotViews(index, snapshotBlock) {
  for (const contract of Object.values(index.contracts)) {
    const abi = JSON.parse(await readFile(resolve(ROOT, contract.label, "abi.json"), "utf8"));
    const viewItems = abi.filter((item) => item.type === "function" && item.inputs?.length === 0 && ["view", "pure"].includes(item.stateMutability));
    const values = {};
    for (const item of viewItems) {
      process.stdout.write(`  ${contract.label}.${item.name}\n`);
      try {
        values[item.name] = await call(contract.address, item, snapshotBlock);
      } catch (error) {
        values[item.name] = { error: String(error.message ?? error) };
      }
    }
    const balance = await rpc("eth_getBalance", [contract.address, snapshotBlock]);
    const out = { snapshotBlock, balanceWei: BigInt(balance).toString(), views: values };
    await writeFile(resolve(ROOT, contract.label, "state-snapshot.json"), `${JSON.stringify(out, null, 2)}\n`);
  }
}

async function snapshotFwaEvents(index, snapshotBlock) {
  const creationTx = index.contracts.FWA.creationTransaction;
  const receipt = await rpc("eth_getTransactionReceipt", [creationTx]);
  const from = BigInt(receipt.blockNumber);
  const to = BigInt(snapshotBlock);
  process.stdout.write(`Scanning ConfigSet from ${from} to ${to}\n`);
  const configLogs = await getLogs(FWA, "ConfigSet(uint256,uint256)", from, to);
  const config = {};
  const configHistory = configLogs.map((log) => {
    const key = BigInt(log.topics[1]).toString();
    const value = BigInt(`0x${wordAt(log.data, 0)}`).toString();
    const entry = { blockNumber: BigInt(log.blockNumber).toString(), transactionHash: log.transactionHash, logIndex: BigInt(log.logIndex).toString(), key, name: CONFIG_KEYS[key] ?? `UNKNOWN_${key}`, value };
    config[entry.name] = entry;
    return entry;
  });

  process.stdout.write(`Scanning CollectionWhitelistSet from ${from} to ${to}\n`);
  const collectionLogs = await getLogs(FWA, "CollectionWhitelistSet(address,bool)", from, to);
  const collections = {};
  const collectionHistory = collectionLogs.map((log) => {
    const collection = decodeAddressTopic(log.topics[1]);
    const allowed = BigInt(`0x${wordAt(log.data, 0)}`) !== 0n;
    const entry = { blockNumber: BigInt(log.blockNumber).toString(), transactionHash: log.transactionHash, logIndex: BigInt(log.logIndex).toString(), collection, allowed };
    collections[collection.toLowerCase()] = entry;
    return entry;
  });

  const fwaAbi = JSON.parse(await readFile(resolve(ROOT, "FWA", "abi.json"), "utf8"));
  const whitelistAbi = JSON.parse(await readFile(resolve(ROOT, "FWAWhitelist", "abi.json"), "utf8"));
  const collectionView = fwaAbi.find((item) => item.type === "function" && item.name === "collectionWhitelisted");
  const blockedView = whitelistAbi.find((item) => item.type === "function" && item.name === "blocked");
  const candidates = new Map(Object.entries(INITIAL_COLLECTIONS).map(([name, address]) => [address.toLowerCase(), { name, address }]));
  for (const address of Object.keys(collections)) if (!candidates.has(address)) candidates.set(address, { name: null, address });
  const collectionState = [];
  for (const candidate of candidates.values()) {
    const arg = candidate.address.toLowerCase().replace(/^0x/, "").padStart(64, "0");
    const allowed = await call(FWA, collectionView, snapshotBlock, arg);
    const blocked = await call(WHITELIST, blockedView, snapshotBlock, arg);
    collectionState.push({ ...candidate, allowed: allowed["0"], blocked: blocked["0"] });
  }

  const output = { snapshotBlock, creationBlock: from.toString(), config, configHistory, collections, collectionHistory, collectionState };
  await writeFile(resolve(ROOT, "FWA", "state-events.json"), `${JSON.stringify(output, null, 2)}\n`);
}

async function main() {
  const indexPath = resolve(ROOT, "reference-index.json");
  const index = JSON.parse(await readFile(indexPath, "utf8"));
  const snapshotBlock = await rpc("eth_blockNumber");
  index.stateSnapshot = { generatedAt: new Date().toISOString(), block: snapshotBlock, rpc: ETH_RPC, logRpc: LOG_RPC };
  await snapshotViews(index, snapshotBlock);
  await snapshotFwaEvents(index, snapshotBlock);
  await writeFile(indexPath, `${JSON.stringify(index, null, 2)}\n`);
  process.stdout.write(`State snapshot complete at ${snapshotBlock}.\n`);
}

await main();
