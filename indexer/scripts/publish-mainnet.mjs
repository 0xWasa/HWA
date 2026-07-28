import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const indexerDir = resolve(import.meta.dirname, "..");
const manifestPath = resolve(indexerDir, "../frontend/public/deployments/hyperevm-mainnet-999.json");
const addressPattern = /^0x[0-9a-fA-F]{40}$/u;

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

if (process.env.GOLDSKY_MAINNET_PUBLISH_CONFIRMED !== "true") {
  throw new Error("Set GOLDSKY_MAINNET_PUBLISH_CONFIRMED=true only after reviewing the final receipt-bound manifest");
}
if (!existsSync(manifestPath)) throw new Error(`Mainnet deployment manifest does not exist: ${manifestPath}`);

const apiKey = required("GOLDSKY_API_KEY");
const version = required("GOLDSKY_SUBGRAPH_VERSION");
if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u.test(version)) throw new Error("Invalid GOLDSKY_SUBGRAPH_VERSION");

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
if (manifest.chainId !== 999) throw new Error("Goldsky mainnet publication requires chainId 999");
if (!addressPattern.test(manifest?.contracts?.fwa ?? "")) throw new Error("Final mainnet FWA address is missing");
if (!addressPattern.test(manifest?.contracts?.snapshotNft ?? "")) throw new Error("Final mainnet Genesis NFT address is missing");
if (!Number.isSafeInteger(manifest.deployedAtBlock) || manifest.deployedAtBlock <= 0) {
  throw new Error("Final mainnet deployment block is missing");
}
for (const collection of manifest.collections ?? []) {
  if (!addressPattern.test(collection.address ?? "") || !Number.isSafeInteger(collection.deploymentBlock) || collection.deploymentBlock < 0) {
    throw new Error("Every mainnet collection needs a valid address and deploymentBlock");
  }
}

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const check = spawnSync(npm, ["run", "check:mainnet"], { cwd: indexerDir, stdio: "inherit" });
if (check.status !== 0) throw new Error("Mainnet indexer build failed; Goldsky publication aborted");

const goldsky = resolve(indexerDir, "node_modules", ".bin", process.platform === "win32" ? "goldsky.cmd" : "goldsky");
const deployment = spawnSync(goldsky, [
  "subgraph",
  "deploy",
  `hwa-hyperevm/${version}`,
  "--path",
  indexerDir,
  "--token",
  apiKey,
  "--tag",
  "mainnet",
], { cwd: indexerDir, stdio: "inherit" });
if (deployment.status !== 0) throw new Error("Goldsky publication failed");
