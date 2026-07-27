import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const indexerDir = resolve(here, "..");
const [manifestArg, network] = process.argv.slice(2);
if (!manifestArg || !network) {
  throw new Error("Usage: node scripts/render-manifest.mjs <deployment-manifest.json> <graph-network>");
}

const manifestPath = resolve(indexerDir, manifestArg);
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
if (![998, 999].includes(manifest?.chainId)) throw new Error("Manifest chainId must be 998 or 999");
const expectedNetwork = manifest.chainId === 999 ? "hyperevm" : "hyperevm-testnet";
if (network !== expectedNetwork) {
  throw new Error(`Graph network ${network} does not match manifest chainId ${manifest.chainId} (${expectedNetwork})`);
}
if (!/^0x[0-9a-fA-F]{40}$/.test(manifest?.contracts?.fwa ?? "")) throw new Error("Manifest FWA address is invalid");
if (!Number.isSafeInteger(manifest?.deployedAtBlock) || manifest.deployedAtBlock < 0) {
  throw new Error("Manifest deployedAtBlock is required for deterministic indexing");
}
if (manifest.chainId === 999) {
  const snapshot = manifest?.contracts?.snapshotNft;
  if (!/^0x[0-9a-fA-F]{40}$/.test(snapshot ?? "")) throw new Error("Mainnet snapshotNft is required");
  const indexed = (manifest.collections ?? []).some(
    (collection) => collection.address?.toLowerCase() === snapshot.toLowerCase() && collection.snapshotCollection === true,
  );
  if (!indexed) throw new Error("Mainnet snapshot NFT must be present in collections with snapshotCollection=true");
}

const template = await readFile(resolve(indexerDir, "subgraph.template.yaml"), "utf8");
let rendered = template
  .replaceAll("__NETWORK__", network)
  .replaceAll("__FWA_ADDRESS__", manifest.contracts.fwa)
  .replaceAll("__START_BLOCK__", String(manifest.deployedAtBlock));

const generatedMappings = resolve(indexerDir, "src/generated-collections");
await rm(generatedMappings, { recursive: true, force: true });
await mkdir(generatedMappings, { recursive: true });

for (const [index, collection] of (manifest.collections ?? []).entries()) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(collection.address ?? "")) throw new Error(`Collection ${index} address is invalid`);
  const startBlock = collection.deploymentBlock ?? manifest.deployedAtBlock;
  if (manifest.chainId === 999 && !Number.isSafeInteger(collection.deploymentBlock)) {
    throw new Error(`Collection ${collection.address} needs deploymentBlock for complete mainnet ownership indexing`);
  }
  const dataSourceName = `ERC721_${index}`;
  rendered += `
  - kind: ethereum
    name: ${dataSourceName}
    network: ${network}
    source:
      address: "${collection.address}"
      abi: ERC721
      startBlock: ${startBlock}
    mapping:
      kind: ethereum/events
      apiVersion: 0.0.9
      language: wasm/assemblyscript
      entities:
        - OwnedToken
      abis:
        - name: ERC721
          file: ./abis/ERC721.json
      eventHandlers:
        - event: Transfer(indexed address,indexed address,indexed uint256)
          handler: handleTransfer
      file: ./src/generated-collections/${dataSourceName}.ts
`;
  const mapping = `import { Address, dataSource } from "@graphprotocol/graph-ts";
import { ERC721, Transfer } from "../../generated/${dataSourceName}/ERC721";
import { OwnedToken } from "../../generated/schema";

export function handleTransfer(event: Transfer): void {
  const collection = dataSource.address();
  const id = collection.toHexString() + "-" + event.params.tokenId.toString();
  let token = OwnedToken.load(id);
  if (token == null) {
    token = new OwnedToken(id);
    token.collection = collection;
    token.tokenId = event.params.tokenId;
  }
  token.owner = event.params.to;
  token.burned = event.params.to.equals(Address.zero());
  token.updatedAt = event.block.timestamp;
  token.updatedBlock = event.block.number;
  token.updatedTx = event.transaction.hash;
  const uri = ERC721.bind(collection).try_tokenURI(event.params.tokenId);
  if (!uri.reverted) token.tokenURI = uri.value;
  token.save();
}
`;
  await writeFile(resolve(generatedMappings, `${dataSourceName}.ts`), mapping, "utf8");
}
await writeFile(resolve(indexerDir, "subgraph.yaml"), rendered, "utf8");
console.log(`Rendered ${network} subgraph from block ${manifest.deployedAtBlock} with ${(manifest.collections ?? []).length} collections`);
