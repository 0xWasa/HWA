#!/usr/bin/env node
// Derivative export: rasterize the canonical v3 contact-sheet.svg to PNG.
// Uses the frontend's sharp install (libvips). The PNG is a review/social
// artifact only — the canonical assets remain the deterministic SVGs.
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(PROJECT_ROOT, "frontend", "package.json"));
const sharp = require("sharp");

const dir = resolve(PROJECT_ROOT, process.argv[2] ?? "frontend/public/genesis/v3");
const svg = readFileSync(join(dir, "contact-sheet.svg"));
const out = join(dir, "contact-sheet.png");
await sharp(svg, { density: 96 }).resize(2400, null).png().toFile(out);
process.stdout.write(`Rendered ${out}\n`);
