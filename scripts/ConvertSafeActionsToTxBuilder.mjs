#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createRequire } from "node:module";

const requireFromFrontend = createRequire(
  new URL("../frontend/package.json", import.meta.url),
);
const { keccak256, toHex } = requireFromFrontend("viem");

function usage() {
  console.error(
    "Usage: node scripts/ConvertSafeActionsToTxBuilder.mjs <actions.json> <output.json> [batch name]",
  );
  process.exit(2);
}

function serializeJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => serializeJson(item)).join(",")}]`;
  }

  if (value !== null && typeof value === "object") {
    const keys = Object.keys(value).sort();
    let serialized = `{${JSON.stringify(keys)}`;
    for (const key of keys) {
      serialized += `${serializeJson(value[key])},`;
    }
    return `${serialized}}`;
  }

  return JSON.stringify(value);
}

function checksum(batch) {
  const { checksum: _ignored, ...metaWithoutChecksum } = batch.meta;
  const canonical = serializeJson({
    ...batch,
    meta: { ...metaWithoutChecksum, name: null },
  });
  return keccak256(toHex(canonical));
}

const [, , sourceArg, outputArg, nameArg] = process.argv;
if (!sourceArg || !outputArg) usage();

const sourcePath = resolve(sourceArg);
const outputPath = resolve(outputArg);
const source = JSON.parse(await readFile(sourcePath, "utf8"));

if (source.broadcast !== false || source.executable !== true) {
  throw new Error("Safe actions artifact must be executable and non-broadcasting");
}
if (!Number.isSafeInteger(Number(source.chainId)) || Number(source.chainId) <= 0) {
  throw new Error("Invalid chainId in Safe actions artifact");
}
if (!/^0x[0-9a-fA-F]{40}$/.test(source.safe ?? "")) {
  throw new Error("Invalid Safe address in Safe actions artifact");
}
if (!Array.isArray(source.actions) || source.actions.length === 0) {
  throw new Error("Safe actions artifact contains no actions");
}

const actions = [...source.actions].sort((a, b) => Number(a.order) - Number(b.order));
for (let index = 0; index < actions.length; index += 1) {
  const action = actions[index];
  if (Number(action.order) !== index + 1) {
    throw new Error(`Safe actions must be contiguous and ordered; invalid order at index ${index}`);
  }
  if (Number(action.operation ?? 0) !== 0) {
    throw new Error(`Unsupported Safe operation for action ${action.order}`);
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(action.to ?? "")) {
    throw new Error(`Invalid target for action ${action.order}`);
  }
  if (!/^0x(?:[0-9a-fA-F]{2})*$/.test(action.data ?? "")) {
    throw new Error(`Invalid calldata for action ${action.order}`);
  }
  if (typeof action.value !== "string" || !/^\d+$/.test(action.value)) {
    throw new Error(`Invalid value for action ${action.order}`);
  }
}

const batch = {
  version: "1.0",
  chainId: String(source.chainId),
  createdAt: Date.now(),
  meta: {
    name: nameArg || "HWA Genesis custody and freeze",
    description:
      "Mint HWA Genesis #1-333 to the 2-of-3 Safe, then permanently freeze supply and metadata.",
    txBuilderVersion: "2.0.1",
    createdFromSafeAddress: source.safe,
    createdFromOwnerAddress: "",
  },
  transactions: actions.map((action) => ({
    to: action.to,
    value: action.value,
    data: action.data,
  })),
};

batch.meta.checksum = checksum(batch);
await writeFile(outputPath, `${JSON.stringify(batch, null, 2)}\n`, "utf8");

console.log(
  JSON.stringify(
    {
      source: sourcePath,
      output: outputPath,
      chainId: batch.chainId,
      safe: batch.meta.createdFromSafeAddress,
      transactions: batch.transactions.length,
      checksum: batch.meta.checksum,
    },
    null,
    2,
  ),
);
