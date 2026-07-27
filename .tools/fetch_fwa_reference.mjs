import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, relative, dirname } from "node:path";
import vm from "node:vm";

const ROOT = resolve("FWA_ETHEREUM_REFERENCE");
const ETH_RPC = "https://ethereum-rpc.publicnode.com";

const CONTRACTS = {
  FWA: "0xB276F62DB0ce8CA2Ca5bc522695bE604521eAc1c",
  FWARewards: "0x6a1a1C0CfB3D3C538e13D36d608a5bcaa992fc78",
  FWAVRFService: "0xa084c33Fb7a467307452898b8D58165ebd2E5D9f",
  FWAToken: "0xa0Df17B5aC76ABaBA36E1450E2cbCd18A620C845",
  FWATokenHook: "0x2C67ebA8A50AF0dB5Fba55F725247a75CbDA6444",
  FWAClaim: "0xd4085d38855F17EdF0B1CCBFad7B3846fb305655",
  FWAWhitelist: "0x854352b275cF6A0DfFCf2983C986FBe9345e17c3",
  Splitter: "0x1C175b9F0e8C73eD3e677e1cBb1B5A2DD4373Bfe",
};

const EIP1967_SLOTS = {
  implementation: "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc",
  admin: "0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103",
  beacon: "0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50",
};

function decodeHtml(text) {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&#([0-9]+);/g, (_, n) => String.fromCodePoint(parseInt(n, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "");
}

function assertInsideRoot(path) {
  const rel = relative(ROOT, path);
  if (rel.startsWith("..") || rel.includes(":") || rel === "") {
    throw new Error(`Unsafe output path: ${path}`);
  }
}

async function put(path, content) {
  assertInsideRoot(path);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}

async function rpc(method, params = []) {
  const response = await fetch(ETH_RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!response.ok) throw new Error(`RPC ${method}: HTTP ${response.status}`);
  const body = await response.json();
  if (body.error) throw new Error(`RPC ${method}: ${JSON.stringify(body.error)}`);
  return body.result;
}

function extractSourceBundle(html) {
  const startMarker = "var editor_contractJsonData = ";
  const endMarker = "var editor_activeFile";
  const start = html.indexOf(startMarker);
  const end = html.indexOf(endMarker, start);
  if (start < 0 || end < 0) throw new Error("Etherscan source bundle not found");
  const literal = html.slice(start + startMarker.length, end).trim();
  const jsonText = vm.runInNewContext(literal, Object.create(null), { timeout: 1000 });
  return JSON.parse(jsonText);
}

function extractAbi(html) {
  const match = html.match(/<pre id=['"]js-copytextarea2['"][^>]*>([\s\S]*?)<\/pre>/i);
  if (!match) throw new Error("ABI not found");
  return JSON.parse(decodeHtml(match[1]).trim());
}

function extractConstructorArgs(html) {
  const marker = html.indexOf("Constructor Arguments");
  if (marker < 0) return null;
  const tail = html.slice(marker);
  const match = tail.match(/<pre[^>]*>([\s\S]*?)<\/pre>/i);
  if (!match) return null;
  const text = decodeHtml(match[1]).trim();
  const encoded = text.split(/\r?\n/)[0].trim();
  return {
    encoded: /^[0-9a-f]+$/i.test(encoded) ? `0x${encoded}` : null,
    etherscanDecodedText: text,
  };
}

function extractPageMetadata(html) {
  const creatorArea = html.slice(html.indexOf("Contract Creator"), html.indexOf("End Contract Creator"));
  return {
    contractName: html.match(/Contract Name[\s\S]*?<h4[^>]*>\s*([^<]+)\s*<\/h4>/i)?.[1]?.trim() ?? null,
    compilerVersion: html.match(/Compiler Version[\s\S]*?<span[^>]*>\s*([^<]+)\s*<\/span>/i)?.[1]?.trim() ?? null,
    creator: creatorArea.match(/title=['"]Creator Address \((0x[0-9a-f]{40})\)/i)?.[1] ?? null,
    creationTransaction: creatorArea.match(/href=['"]\/tx\/(0x[0-9a-f]{64})/i)?.[1] ?? null,
    exactMatchVerified: /Source Code Verified[\s\S]{0,500}Exact Match/i.test(html),
  };
}

async function main() {
  await mkdir(ROOT, { recursive: true });
  const snapshotBlock = await rpc("eth_blockNumber");
  const chainId = await rpc("eth_chainId");
  const generatedAt = new Date().toISOString();
  const index = {
    generatedAt,
    chainId,
    snapshotBlock,
    rpc: ETH_RPC,
    contracts: {},
  };

  for (const [label, address] of Object.entries(CONTRACTS)) {
    process.stdout.write(`Fetching ${label} ${address}... `);
    const sourceUrl = `https://etherscan.io/address/${address}#code`;
    const response = await fetch(sourceUrl, { headers: { "user-agent": "FWA-HyperEVM-forensic/1.0" } });
    if (!response.ok) throw new Error(`${label}: Etherscan HTTP ${response.status}`);
    const html = await response.text();
    const bundle = extractSourceBundle(html);
    const abi = extractAbi(html);
    const constructorArguments = extractConstructorArgs(html);
    const page = extractPageMetadata(html);
    const bytecode = await rpc("eth_getCode", [address, snapshotBlock]);
    const bytecodeKeccak256 = await rpc("web3_sha3", [bytecode]);
    const bytecodeSha256 = `0x${createHash("sha256").update(Buffer.from(bytecode.slice(2), "hex")).digest("hex")}`;
    const slots = {};
    for (const [slotName, slot] of Object.entries(EIP1967_SLOTS)) {
      slots[slotName] = await rpc("eth_getStorageAt", [address, slot, snapshotBlock]);
    }

    const contractRoot = resolve(ROOT, label);
    await put(resolve(contractRoot, "etherscan-standard-input.json"), `${JSON.stringify(bundle, null, 2)}\n`);
    await put(resolve(contractRoot, "abi.json"), `${JSON.stringify(abi, null, 2)}\n`);
    await put(resolve(contractRoot, "deployed-bytecode.hex"), `${bytecode}\n`);
    await put(resolve(contractRoot, "constructor-arguments.json"), `${JSON.stringify(constructorArguments, null, 2)}\n`);

    const sourceHashes = {};
    for (const [sourcePath, source] of Object.entries(bundle.sources ?? {})) {
      const normalized = sourcePath.replaceAll("\\", "/").replace(/^\/+/, "");
      if (normalized.split("/").includes("..")) throw new Error(`Unsafe Etherscan source path: ${sourcePath}`);
      const output = resolve(contractRoot, "sources", normalized);
      assertInsideRoot(output);
      await put(output, source.content);
      sourceHashes[sourcePath] = `0x${createHash("sha256").update(source.content).digest("hex")}`;
    }

    const record = {
      label,
      address,
      sourceUrl,
      exactMatchVerified: page.exactMatchVerified,
      contractName: page.contractName,
      compilerVersion: page.compilerVersion,
      language: bundle.language,
      sourceCount: Object.keys(bundle.sources ?? {}).length,
      sourceSha256: sourceHashes,
      constructorArguments,
      creator: page.creator,
      creationTransaction: page.creationTransaction,
      deployedBytecodeBytes: (bytecode.length - 2) / 2,
      deployedBytecodeKeccak256: bytecodeKeccak256,
      deployedBytecodeSha256: bytecodeSha256,
      eip1967Slots: slots,
      snapshotBlock,
    };
    await put(resolve(contractRoot, "metadata.json"), `${JSON.stringify(record, null, 2)}\n`);
    index.contracts[label] = record;
    process.stdout.write(`${record.sourceCount} sources, ${record.deployedBytecodeBytes} bytecode bytes\n`);
  }

  await put(resolve(ROOT, "reference-index.json"), `${JSON.stringify(index, null, 2)}\n`);
  process.stdout.write(`Wrote ${Object.keys(index.contracts).length} references at block ${snapshotBlock}.\n`);
}

await main();
