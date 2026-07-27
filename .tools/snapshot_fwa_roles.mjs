import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const ROOT = resolve("FWA_ETHEREUM_REFERENCE");
const ETH_RPC = "https://ethereum-rpc.publicnode.com";
const LOG_RPC = "https://eth.drpc.org";

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
const decodeAddressWord = (word) => `0x${word.slice(-40)}`;
const decodeAddressTopic = (topic) => `0x${topic.slice(-40)}`;
const decodeBoolWord = (word) => BigInt(`0x${word}`) !== 0n;

async function selector(signature) {
  const hash = await rpc("web3_sha3", [`0x${Buffer.from(signature).toString("hex")}`]);
  return hash.slice(0, 10);
}

async function getLogs(address, signature, fromBlock, toBlock) {
  const topic0 = await rpc("web3_sha3", [`0x${Buffer.from(signature).toString("hex")}`]);
  const logs = [];
  for (let from = BigInt(fromBlock); from <= BigInt(toBlock); from += 10_000n) {
    const to = from + 9_999n > BigInt(toBlock) ? BigInt(toBlock) : from + 9_999n;
    const page = await rpc("eth_getLogs", [{ address, fromBlock: hexBlock(from), toBlock: hexBlock(to), topics: [topic0] }], LOG_RPC);
    logs.push(...page);
  }
  return logs;
}

async function creationBlock(contract) {
  const receipt = await rpc("eth_getTransactionReceipt", [contract.creationTransaction]);
  return BigInt(receipt.blockNumber);
}

async function boolMapping(address, signature, account, block) {
  const arg = account.toLowerCase().replace(/^0x/, "").padStart(64, "0");
  const data = `${await selector(signature)}${arg}`;
  const raw = await rpc("eth_call", [{ to: address, data }, block]);
  return decodeBoolWord(wordAt(raw, 0));
}

function baseEvent(log) {
  return {
    blockNumber: BigInt(log.blockNumber).toString(),
    transactionHash: log.transactionHash,
    logIndex: BigInt(log.logIndex).toString(),
  };
}

async function main() {
  const index = JSON.parse(await readFile(resolve(ROOT, "reference-index.json"), "utf8"));
  const snapshotBlock = await rpc("eth_blockNumber");
  const result = { generatedAt: new Date().toISOString(), snapshotBlock, modules: {} };

  {
    const contract = index.contracts.FWAVRFService;
    const from = await creationBlock(contract);
    const logs = await getLogs(contract.address, "OperatorSet(address,bool)", from, BigInt(snapshotBlock));
    const current = {};
    const history = logs.map((log) => {
      const account = decodeAddressTopic(log.topics[1]);
      const allowed = decodeBoolWord(wordAt(log.data, 0));
      const event = { ...baseEvent(log), account, allowed };
      current[account.toLowerCase()] = event;
      return event;
    });
    for (const [account, state] of Object.entries(current)) state.confirmedOnchain = await boolMapping(contract.address, "operators(address)", account, snapshotBlock);
    result.modules.FWAVRFService = { mapping: "operators", history, current };
  }

  {
    const contract = index.contracts.FWAToken;
    const from = await creationBlock(contract);
    const logs = await getLogs(contract.address, "DistributorSet(address,bool)", from, BigInt(snapshotBlock));
    const current = {};
    const history = logs.map((log) => {
      const account = decodeAddressTopic(log.topics[1]);
      const allowed = decodeBoolWord(wordAt(log.data, 0));
      const event = { ...baseEvent(log), account, allowed };
      current[account.toLowerCase()] = event;
      return event;
    });
    for (const [account, state] of Object.entries(current)) state.confirmedOnchain = await boolMapping(contract.address, "isDistributor(address)", account, snapshotBlock);
    result.modules.FWAToken = { mapping: "isDistributor", history, current };
  }

  {
    const contract = index.contracts.FWATokenHook;
    const from = await creationBlock(contract);
    const logs = await getLogs(contract.address, "PoolSet(address,bool)", from, BigInt(snapshotBlock));
    const current = {};
    const history = logs.map((log) => {
      const account = decodeAddressWord(wordAt(log.data, 0));
      const allowed = decodeBoolWord(wordAt(log.data, 1));
      const event = { ...baseEvent(log), account, allowed };
      current[account.toLowerCase()] = event;
      return event;
    });
    for (const [account, state] of Object.entries(current)) state.confirmedOnchain = await boolMapping(contract.address, "isPool(address)", account, snapshotBlock);
    result.modules.FWATokenHook = { mapping: "isPool", history, current };
  }

  const fwaEvents = JSON.parse(await readFile(resolve(ROOT, "FWA", "state-events.json"), "utf8"));
  for (const key of ["PAYOUT_ADDRESS", "WHITELIST_MANAGER", "VRF_COORDINATOR", "VRF_SERVICE"]) {
    const entry = fwaEvents.config[key];
    if (entry) entry.address = `0x${BigInt(entry.value).toString(16).padStart(40, "0")}`;
  }
  result.modules.FWA = {
    owner: JSON.parse(await readFile(resolve(ROOT, "FWA", "state-snapshot.json"), "utf8")).views.owner,
    payoutAddress: fwaEvents.config.PAYOUT_ADDRESS,
    whitelistManager: fwaEvents.config.WHITELIST_MANAGER,
  };

  await writeFile(resolve(ROOT, "roles-state.json"), `${JSON.stringify(result, null, 2)}\n`);
  process.stdout.write(`Role snapshot complete at ${snapshotBlock}.\n`);
}

await main();
