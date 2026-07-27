import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const artifactPath = resolve(root, "out/FWA.sol/FWA.json");
const outputPath = resolve(root, "indexer/abis/FWA.json");
const artifact = JSON.parse(await readFile(artifactPath, "utf8"));

if (!Array.isArray(artifact.abi)) throw new Error(`Missing ABI in ${artifactPath}`);
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(artifact.abi, null, 2)}\n`, "utf8");
console.log(`Wrote ${artifact.abi.length} ABI entries to ${outputPath}`);
