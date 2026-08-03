import { mkdir, writeFile } from "node:fs/promises";
import { decodeFunctionResult, encodeFunctionData } from "viem";
import { fwaCoreAbi } from "../src/protocol/viem/abi.ts";

const core = "0x13aB222c1079084064F75713e72defCE20751f4A";
const rpc = process.env.HWA_READ_RPC_URL ?? "https://rpc.hyperliquid.xyz/evm";

async function batch(items) {
  const response = await fetch(rpc, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(items),
  });
  if (!response.ok) throw new Error(`RPC HTTP ${response.status}: ${await response.text()}`);
  const payload = await response.json();
  if (!Array.isArray(payload)) throw new Error(`RPC error: ${JSON.stringify(payload)}`);
  return payload;
}

async function main() {
  const names = [
    "activeListingCount",
    "nextListingId",
    "stagedCount",
    "pendingAcquisitionCount",
    "activeBackingTotal",
    "withdrawOnly",
    "acquisitionsEnabled",
  ];
  const head = await batch(names.map((functionName, index) => ({
    jsonrpc: "2.0",
    id: index + 1,
    method: "eth_call",
    params: [{ to: core, data: encodeFunctionData({ abi: fwaCoreAbi, functionName }) }, "latest"],
  })));
  const state = {};
  for (let index = 0; index < names.length; index += 1) {
    const functionName = names[index];
    const item = head.find((candidate) => candidate.id === index + 1);
    if (!item?.result) throw new Error(`${functionName}: ${JSON.stringify(item?.error)}`);
    state[functionName] = decodeFunctionResult({ abi: fwaCoreAbi, functionName, data: item.result }).toString();
  }

  const positions = [];
  const nextListingId = Number(state.nextListingId);
  for (let start = 1; start < nextListingId; start += 10) {
    const ids = Array.from({ length: Math.min(10, nextListingId - start) }, (_, offset) => start + offset);
    const response = await batch(ids.map((listingId) => ({
      jsonrpc: "2.0",
      id: listingId,
      method: "eth_call",
      params: [{
        to: core,
        data: encodeFunctionData({ abi: fwaCoreAbi, functionName: "listings", args: [BigInt(listingId)] }),
      }, "latest"],
    })));
    for (const listingId of ids) {
      const item = response.find((candidate) => candidate.id === listingId);
      if (!item?.result) throw new Error(`listing ${listingId}: ${JSON.stringify(item?.error)}`);
      const [collection, depositor, purchaser, tokenId, , value, , , , , status] = decodeFunctionResult({
        abi: fwaCoreAbi,
        functionName: "listings",
        data: item.result,
      });
      if (![1, 2, 5].includes(Number(status))) continue;
      positions.push({
        listingId,
        collection,
        depositor,
        purchaser,
        tokenId: tokenId.toString(),
        backingWei: value.toString(),
        status: Number(status),
      });
    }
  }

  const output = new URL("../public/legacy/hwa-v1-positions.json", import.meta.url);
  await mkdir(new URL("../public/legacy/", import.meta.url), { recursive: true });
  const artifact = { schemaVersion: 1, generatedAt: new Date().toISOString(), core, state, positions };
  await writeFile(output, `${JSON.stringify(artifact, null, 2)}\n`);
  console.log(`Wrote ${positions.length} recoverable positions to ${output.pathname}`);
}

await main();
