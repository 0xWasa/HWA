#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(SCRIPT_DIR, "..");
const SUPPLY = 333;
const RENDERER_VERSION = "HWA-GEN-2.0.0";
const DEFAULT_OUTPUT = "frontend/public/genesis/v2";
const DEFAULT_IMAGE_BASE_URI = "ipfs://__HWA_GENESIS_IMAGES_CID__/";

const CLASS_CONFIG = Object.freeze({
  SCALP: { count: 200, scale: 0.56, sizeRange: [0.05, 1.5], rings: [2, 4] },
  SIZE: { count: 80, scale: 0.66, sizeRange: [1.5, 8], rings: [3, 5] },
  WHALE: { count: 35, scale: 0.77, sizeRange: [8, 40], rings: [4, 6] },
  COLOSSAL: { count: 15, scale: 0.88, sizeRange: [40, 150], rings: [5, 7] },
  CROWN: { count: 3, scale: 1, sizeRange: [150, 333], rings: [6, 8] },
});

const CLASS_ASSIGNMENT_ORDER = ["CROWN", "COLOSSAL", "WHALE", "SIZE", "SCALP"];
const CORES = ["ORBIT", "PULSE", "GRID", "VECTOR", "VOID"];
const SIGNALS = ["BREAKOUT", "MEAN REVERT", "PRICE DISCOVERY", "ACCUMULATION", "HIGH CONVICTION"];
const TIMEFRAMES = ["1M", "5M", "15M", "1H", "4H", "1D"];
const PALETTES = [
  { name: "ACID", primary: "#C8FF3D", secondary: "#7657FF" },
  { name: "AQUA", primary: "#50E3C2", secondary: "#4CA8FF" },
  { name: "VIOLET", primary: "#9A7BFF", secondary: "#58E6C1" },
  { name: "EMBER", primary: "#FFB45C", secondary: "#C8FF3D" },
  { name: "ICE", primary: "#8DCEFF", secondary: "#B89CFF" },
];

function parseArgs(argv) {
  const args = {
    output: DEFAULT_OUTPUT,
    imageBaseUri: DEFAULT_IMAGE_BASE_URI,
    verifyOnly: false,
    force: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--output") args.output = argv[++index];
    else if (arg === "--image-base-uri") args.imageBaseUri = argv[++index];
    else if (arg === "--verify-only") args.verifyOnly = true;
    else if (arg === "--force") args.force = true;
    else if (arg === "--help") {
      process.stdout.write(
        [
          "Usage: node scripts/generate-hwa-genesis.mjs [options]",
          "",
          `  --output <path>          Output directory (default: ${DEFAULT_OUTPUT})`,
          "  --image-base-uri <uri>  URI prefix written into metadata",
          "  --verify-only           Verify an existing output without writing",
          "  --force                 Replace the selected generated output directory",
          "  --help                  Show this help",
          "",
        ].join("\n"),
      );
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!args.output || !args.imageBaseUri) throw new Error("Output and image base URI cannot be empty");
  if (args.verifyOnly && args.force) throw new Error("--verify-only and --force cannot be combined");
  if (!args.imageBaseUri.endsWith("/")) args.imageBaseUri += "/";
  return args;
}

function resolveSafeOutput(output) {
  const resolved = isAbsolute(output) ? resolve(output) : resolve(PROJECT_ROOT, output);
  const rel = relative(PROJECT_ROOT, resolved);
  if (!rel || rel.startsWith(`..${sep}`) || rel === ".." || isAbsolute(rel)) {
    throw new Error(`Output must be a child of the project root: ${resolved}`);
  }
  return resolved;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function sha256File(path) {
  return sha256(readFileSync(path));
}

function seedWords(label) {
  const bytes = createHash("sha256").update(label).digest();
  return [bytes.readUInt32LE(0), bytes.readUInt32LE(4), bytes.readUInt32LE(8), bytes.readUInt32LE(12)];
}

function rngFor(label) {
  let [a, b, c, d] = seedWords(label);
  return () => {
    a >>>= 0;
    b >>>= 0;
    c >>>= 0;
    d >>>= 0;
    const t = (a + b + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = ((c << 21) | (c >>> 11)) + t;
    return (t >>> 0) / 4294967296;
  };
}

function between(rng, min, max) {
  return min + (max - min) * rng();
}

function integer(rng, min, max) {
  return Math.floor(between(rng, min, max + 1));
}

function pick(rng, values) {
  return values[Math.floor(rng() * values.length)];
}

function round(value, digits) {
  const power = 10 ** digits;
  return Math.round(value * power) / power;
}

function padId(tokenId) {
  return String(tokenId).padStart(3, "0");
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function formatPrice(value) {
  if (value >= 100) return value.toFixed(2);
  if (value >= 1) return value.toFixed(3);
  if (value >= 0.1) return value.toFixed(4);
  return value.toFixed(6);
}

function formatSize(value) {
  if (value >= 100) return value.toFixed(1);
  if (value >= 10) return value.toFixed(2);
  return value.toFixed(3);
}

function classAssignments() {
  const ids = Array.from({ length: SUPPLY }, (_, index) => index + 1);
  ids.sort((left, right) =>
    sha256(`HWA_GENESIS_CLASS_V1:${left}`).localeCompare(sha256(`HWA_GENESIS_CLASS_V1:${right}`)),
  );

  const assigned = new Map();
  let cursor = 0;
  for (const name of CLASS_ASSIGNMENT_ORDER) {
    const count = CLASS_CONFIG[name].count;
    for (let index = 0; index < count; index += 1) assigned.set(ids[cursor++], name);
  }
  if (cursor !== SUPPLY || assigned.size !== SUPPLY) throw new Error("Class assignment did not cover the supply");
  return assigned;
}

function pnlFor(rng) {
  const outcome = rng();
  if (outcome < 0.42) return round(-between(rng, 4, 94), 1);
  if (outcome < 0.48) return round(between(rng, -2.5, 2.5), 1);
  if (outcome < 0.86) return round(between(rng, 4, 110), 1);
  if (outcome < 0.98) return round(between(rng, 110, 280), 1);
  return round(between(rng, 280, 480), 1);
}

function pnlBand(pnl) {
  if (pnl < -3) return "DRAWDOWN";
  if (pnl <= 3) return "FLAT";
  if (pnl < 110) return "GREEN";
  if (pnl < 280) return "RUNNER";
  return "OUTLIER";
}

function buildTraits(tokenId, sizeClass) {
  const rng = rngFor(`HWA_GENESIS_TRAITS_V1:${tokenId}`);
  const config = CLASS_CONFIG[sizeClass];
  const side = rng() < 0.58 ? "LONG" : "SHORT";
  const pnl = pnlFor(rng);
  const leverage = integer(rng, 10, 50);
  const entry = 10 ** between(rng, -3.2, -0.15);
  const direction = side === "LONG" ? 1 : -1;
  const mark = entry * (1 + direction * pnl / (100 * leverage));
  if (!(mark > 0)) throw new Error(`Generated a non-positive mark for token ${tokenId}`);

  const sizeHype = round(between(rng, config.sizeRange[0], config.sizeRange[1]), 3);
  const palette = pick(rng, PALETTES);
  const ringCount = integer(rng, config.rings[0], config.rings[1]);
  const markerCount = integer(rng, 2, Math.min(8, ringCount + 2));
  const core = pick(rng, CORES);
  const signal = pick(rng, SIGNALS);
  const timeframe = pick(rng, TIMEFRAMES);
  const visualSeed = sha256(`HWA_GENESIS_VISUAL_V1:${tokenId}`);

  return {
    tokenId,
    displayId: padId(tokenId),
    sizeClass,
    classSupply: config.count,
    displayScale: config.scale,
    side,
    pnl,
    pnlBand: pnlBand(pnl),
    leverage,
    market: "HWA/HYPE",
    entry: round(entry, 8),
    mark: round(mark, 8),
    sizeHype,
    palette: palette.name,
    primary: palette.primary,
    secondary: palette.secondary,
    core,
    signal,
    timeframe,
    ringCount,
    markerCount,
    visualSeed: `0x${visualSeed}`,
  };
}

function renderCore(traits, cx, cy, rng) {
  const primary = traits.primary;
  const secondary = traits.secondary;
  if (traits.core === "PULSE") {
    return `
      <rect x="${cx - 66}" y="${cy - 66}" width="132" height="132" rx="34" fill="none" stroke="${primary}" stroke-width="3"/>
      <rect x="${cx - 36}" y="${cy - 36}" width="72" height="72" rx="20" fill="${primary}" fill-opacity="0.12" stroke="${secondary}" stroke-width="2"/>
      <circle cx="${cx}" cy="${cy}" r="10" fill="${primary}"/>`;
  }
  if (traits.core === "GRID") {
    return [-1, 1]
      .flatMap((dx) => [-1, 1].map((dy) => `<rect x="${cx + dx * 30 - 13}" y="${cy + dy * 30 - 13}" width="26" height="26" rx="6" fill="${dx === dy ? primary : secondary}"/>`))
      .join("\n");
  }
  if (traits.core === "VECTOR") {
    return `
      <path d="M ${cx - 68} ${cy + 38} L ${cx} ${cy - 48} L ${cx + 68} ${cy + 38}" fill="none" stroke="${primary}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M ${cx - 34} ${cy + 38} L ${cx} ${cy - 4} L ${cx + 34} ${cy + 38}" fill="none" stroke="${secondary}" stroke-width="3" stroke-linecap="round"/>`;
  }
  if (traits.core === "VOID") {
    return `
      <circle cx="${cx}" cy="${cy}" r="61" fill="#070A0D" stroke="${secondary}" stroke-width="3"/>
      <circle cx="${cx}" cy="${cy}" r="39" fill="#030506" stroke="${primary}" stroke-width="2" stroke-dasharray="4 9"/>
      <circle cx="${cx + between(rng, -12, 12).toFixed(1)}" cy="${cy + between(rng, -12, 12).toFixed(1)}" r="8" fill="${primary}"/>`;
  }
  return `
    <ellipse cx="${cx}" cy="${cy}" rx="72" ry="36" fill="none" stroke="${primary}" stroke-width="3" transform="rotate(-18 ${cx} ${cy})"/>
    <ellipse cx="${cx}" cy="${cy}" rx="72" ry="36" fill="none" stroke="${secondary}" stroke-width="2" transform="rotate(42 ${cx} ${cy})"/>
    <circle cx="${cx}" cy="${cy}" r="14" fill="${primary}"/>`;
}

function renderSvg(traits) {
  const rng = rngFor(`HWA_GENESIS_SVG_V2:${traits.tokenId}`);
  const uid = `hwa-${traits.displayId}`;
  const bid = "#50E3C2";
  const ask = "#FF6685";
  const accent = traits.pnl < -3 ? ask : traits.pnl <= 3 ? "#8DCEFF" : traits.primary;
  const pnlText = `${traits.pnl > 0 ? "+" : ""}${traits.pnl.toFixed(1)}%`;
  const fieldWidth = Math.round(520 + traits.displayScale * 510);
  const fieldHeight = Math.round(300 + traits.displayScale * 310);
  const fieldX = (1200 - fieldWidth) / 2;
  const fieldY = 338 + (610 - fieldHeight) / 2;
  const centerX = 600;
  const centerY = fieldY + fieldHeight / 2;
  const halfGap = 23;
  const barCount = 13;
  const step = fieldHeight / (barCount + 1);

  const depthBars = Array.from({ length: barCount }, (_, index) => {
    const y = fieldY + step * (index + 1);
    const centerDistance = Math.abs(index - (barCount - 1) / 2) / ((barCount - 1) / 2);
    const envelope = 0.38 + 0.62 * (1 - centerDistance ** 1.7);
    const bidLength = fieldWidth * envelope * between(rng, 0.17, 0.43);
    const askLength = fieldWidth * envelope * between(rng, 0.17, 0.43);
    const barHeight = index === 6 ? 7 : 3;
    const opacity = index === 6 ? 0.86 : 0.16 + envelope * 0.25;
    return `<rect x="${(centerX - halfGap - bidLength).toFixed(1)}" y="${(y - barHeight / 2).toFixed(1)}" width="${bidLength.toFixed(1)}" height="${barHeight}" rx="${barHeight / 2}" fill="${bid}" fill-opacity="${opacity.toFixed(2)}"/>
      <rect x="${centerX + halfGap}" y="${(y - barHeight / 2).toFixed(1)}" width="${askLength.toFixed(1)}" height="${barHeight}" rx="${barHeight / 2}" fill="${ask}" fill-opacity="${opacity.toFixed(2)}"/>`;
  }).join("\n");

  const contourCount = Math.max(2, traits.ringCount - 1);
  const liquidityContours = Array.from({ length: contourCount }, (_, index) => {
    const inset = 16 + index * 25;
    const opacity = 0.2 - index * 0.022;
    return `<rect x="${(fieldX + inset).toFixed(1)}" y="${(fieldY + inset * 0.65).toFixed(1)}" width="${(fieldWidth - inset * 2).toFixed(1)}" height="${(fieldHeight - inset * 1.3).toFixed(1)}" rx="${Math.max(18, 64 - index * 7)}" fill="none" stroke="${index % 2 === 0 ? traits.primary : traits.secondary}" stroke-opacity="${Math.max(0.05, opacity).toFixed(2)}" stroke-width="1.5"/>`;
  }).join("\n");

  const marketMove = (traits.side === "LONG" ? 1 : -1) * traits.pnl;
  const entryY = centerY + between(rng, -fieldHeight * 0.1, fieldHeight * 0.1);
  const trendPixels = Math.max(-fieldHeight * 0.34, Math.min(fieldHeight * 0.34, marketMove * 0.42));
  const markY = entryY - trendPixels;
  let walk = entryY;
  const pricePoints = Array.from({ length: 15 }, (_, index) => {
    const progress = index / 14;
    const target = entryY + (markY - entryY) * progress;
    walk = target + between(rng, -fieldHeight * 0.075, fieldHeight * 0.075) * Math.sin(progress * Math.PI);
    return [fieldX + 32 + progress * (fieldWidth - 64), walk];
  });
  pricePoints[0][1] = entryY;
  pricePoints[pricePoints.length - 1][1] = markY;
  const pricePath = pricePoints.map(([x, y], index) => `${index === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");

  const tapeTicks = Array.from({ length: 18 }, (_, index) => {
    const x = fieldX + (index / 17) * fieldWidth;
    const height = between(rng, 12, 74) * (0.65 + traits.displayScale * 0.35);
    const y = centerY + (index % 2 === 0 ? 1 : -1) * (fieldHeight * 0.33);
    const color = index % 3 === 0 ? traits.secondary : traits.primary;
    return `<line x1="${x.toFixed(1)}" y1="${(y - height / 2).toFixed(1)}" x2="${x.toFixed(1)}" y2="${(y + height / 2).toFixed(1)}" stroke="${color}" stroke-opacity="${between(rng, 0.12, 0.34).toFixed(2)}" stroke-width="2"/>`;
  }).join("\n");

  const backgroundFlows = Array.from({ length: 5 }, (_, index) => {
    const points = Array.from({ length: 9 }, (_, point) => {
      const x = -80 + point * 170;
      const base = 280 + index * 145;
      const y = base + Math.sin(point * 0.8 + index + between(rng, -0.25, 0.25)) * (32 + index * 8);
      return `${point === 0 ? "M" : "L"} ${x} ${y.toFixed(1)}`;
    }).join(" ");
    return `<path d="${points}" fill="none" stroke="${index % 2 === 0 ? traits.primary : traits.secondary}" stroke-opacity="${(0.05 + index * 0.012).toFixed(3)}" stroke-width="1.5"/>`;
  }).join("\n");

  const positionVectorX = traits.side === "LONG" ? fieldX + fieldWidth * 0.72 : fieldX + fieldWidth * 0.28;
  const positionVectorY = centerY;
  const positionRadius = 15 + traits.displayScale * 25;
  const positionMarker = traits.core === "GRID"
    ? `<rect x="${(positionVectorX - positionRadius).toFixed(1)}" y="${(positionVectorY - positionRadius).toFixed(1)}" width="${(positionRadius * 2).toFixed(1)}" height="${(positionRadius * 2).toFixed(1)}" rx="7" fill="#07100F" stroke="${traits.primary}" stroke-width="2"/><rect x="${(positionVectorX - 5).toFixed(1)}" y="${(positionVectorY - 5).toFixed(1)}" width="10" height="10" rx="2" fill="${traits.primary}"/>`
    : traits.core === "VECTOR"
      ? `<path d="M ${positionVectorX.toFixed(1)} ${(positionVectorY - positionRadius).toFixed(1)} L ${(positionVectorX + positionRadius).toFixed(1)} ${(positionVectorY + positionRadius).toFixed(1)} L ${(positionVectorX - positionRadius).toFixed(1)} ${(positionVectorY + positionRadius).toFixed(1)} Z" fill="#07100F" stroke="${traits.primary}" stroke-width="2"/><circle cx="${positionVectorX.toFixed(1)}" cy="${(positionVectorY + 4).toFixed(1)}" r="4" fill="${traits.primary}"/>`
      : traits.core === "PULSE"
        ? `<circle cx="${positionVectorX.toFixed(1)}" cy="${positionVectorY.toFixed(1)}" r="${positionRadius.toFixed(1)}" fill="#07100F" stroke="${traits.primary}" stroke-width="2"/><circle cx="${positionVectorX.toFixed(1)}" cy="${positionVectorY.toFixed(1)}" r="${(positionRadius * 0.58).toFixed(1)}" fill="none" stroke="${traits.secondary}" stroke-width="2"/><circle cx="${positionVectorX.toFixed(1)}" cy="${positionVectorY.toFixed(1)}" r="4" fill="${traits.primary}"/>`
        : traits.core === "VOID"
          ? `<circle cx="${positionVectorX.toFixed(1)}" cy="${positionVectorY.toFixed(1)}" r="${positionRadius.toFixed(1)}" fill="#030807" stroke="${traits.secondary}" stroke-width="2"/><circle cx="${positionVectorX.toFixed(1)}" cy="${positionVectorY.toFixed(1)}" r="${(positionRadius * 0.64).toFixed(1)}" fill="none" stroke="${traits.primary}" stroke-width="1.5" stroke-dasharray="3 7"/>`
          : `<circle cx="${positionVectorX.toFixed(1)}" cy="${positionVectorY.toFixed(1)}" r="${positionRadius.toFixed(1)}" fill="#07100F" stroke="${traits.primary}" stroke-width="2"/><circle cx="${positionVectorX.toFixed(1)}" cy="${positionVectorY.toFixed(1)}" r="5" fill="${traits.primary}"/>`;
  const classMarks = traits.sizeClass === "CROWN"
    ? `<g fill="${traits.primary}"><circle cx="568" cy="78" r="4"/><circle cx="600" cy="78" r="4"/><circle cx="632" cy="78" r="4"/></g>`
    : "";

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 1200" role="img" aria-labelledby="${uid}-title ${uid}-desc">
  <title id="${uid}-title">HWA Genesis Position #${traits.displayId}</title>
  <desc id="${uid}-desc">An abstract deterministic liquidity footprint for a simulated ${traits.side.toLowerCase()} HWA position in the ${traits.sizeClass.toLowerCase()} visual class.</desc>
  <defs>
    <linearGradient id="${uid}-wash" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${traits.primary}" stop-opacity="0.13"/>
      <stop offset="0.55" stop-color="#07100F" stop-opacity="0"/>
      <stop offset="1" stop-color="${traits.secondary}" stop-opacity="0.12"/>
    </linearGradient>
    <radialGradient id="${uid}-pulse" cx="50%" cy="50%" r="50%">
      <stop offset="0" stop-color="${accent}" stop-opacity="0.22"/>
      <stop offset="1" stop-color="${accent}" stop-opacity="0"/>
    </radialGradient>
    <filter id="${uid}-glow" x="-100%" y="-100%" width="300%" height="300%">
      <feGaussianBlur stdDeviation="12" result="blur"/>
      <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>

  <rect width="1200" height="1200" fill="#07100F"/>
  <rect width="1200" height="1200" fill="url(#${uid}-wash)"/>
  <g>${backgroundFlows}</g>
  <g stroke="#A9C0BA" stroke-opacity="0.055" stroke-width="1">
    <path d="M 80 0 V 1200 M 280 0 V 1200 M 480 0 V 1200 M 680 0 V 1200 M 880 0 V 1200 M 1080 0 V 1200"/>
    <path d="M 0 250 H 1200 M 0 450 H 1200 M 0 650 H 1200 M 0 850 H 1200 M 0 1050 H 1200"/>
  </g>
  <rect x="42" y="42" width="1116" height="1116" rx="26" fill="none" stroke="#9EB3AE" stroke-opacity="0.16"/>
  ${classMarks}

  <text x="82" y="105" fill="#F1F7F5" font-family="Arial, sans-serif" font-size="24" font-weight="700" letter-spacing="2">HWA</text>
  <text x="153" y="105" fill="#718580" font-family="monospace" font-size="15" letter-spacing="2.4">GENESIS / SIM</text>
  <text x="1118" y="105" text-anchor="end" fill="#718580" font-family="monospace" font-size="16">#${traits.displayId}</text>

  <text x="82" y="178" fill="#718580" font-family="monospace" font-size="16" letter-spacing="2">${traits.market} · ${traits.timeframe} · ${traits.leverage}X</text>
  <text x="82" y="276" fill="${accent}" font-family="Arial, sans-serif" font-size="94" font-weight="300" letter-spacing="-5">${escapeXml(pnlText)}</text>
  <text x="1118" y="250" text-anchor="end" fill="${accent}" font-family="monospace" font-size="20" font-weight="700" letter-spacing="2">${traits.side}</text>
  <text x="1118" y="280" text-anchor="end" fill="#718580" font-family="monospace" font-size="14">${traits.signal}</text>

  <g>${liquidityContours}${tapeTicks}${depthBars}</g>
  <line x1="${fieldX.toFixed(1)}" y1="${entryY.toFixed(1)}" x2="${(fieldX + fieldWidth).toFixed(1)}" y2="${entryY.toFixed(1)}" stroke="#B4C7C2" stroke-opacity="0.18" stroke-dasharray="5 12"/>
  <path d="${pricePath}" fill="none" stroke="${accent}" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="${fieldX.toFixed(1)}" cy="${entryY.toFixed(1)}" r="6" fill="#07100F" stroke="#B4C7C2" stroke-width="2"/>
  <circle cx="${(fieldX + fieldWidth).toFixed(1)}" cy="${markY.toFixed(1)}" r="8" fill="${accent}" filter="url(#${uid}-glow)"/>
  <circle cx="${positionVectorX.toFixed(1)}" cy="${positionVectorY.toFixed(1)}" r="${(positionRadius * 2.7).toFixed(1)}" fill="url(#${uid}-pulse)"/>
  ${positionMarker}
  <text x="${(fieldX + 8).toFixed(1)}" y="${(entryY - 13).toFixed(1)}" fill="#718580" font-family="monospace" font-size="12">ENTRY</text>
  <text x="${(fieldX + fieldWidth - 8).toFixed(1)}" y="${(markY - 14).toFixed(1)}" text-anchor="end" fill="${accent}" font-family="monospace" font-size="12">MARK</text>

  <path d="M 82 976 H 1118" stroke="#9EB3AE" stroke-opacity="0.15"/>
  <g font-family="monospace">
    <text x="82" y="1020" fill="#647873" font-size="14" letter-spacing="2">SIZE</text>
    <text x="82" y="1053" fill="#E3ECE9" font-size="21">${formatSize(traits.sizeHype)} HYPE</text>
    <text x="355" y="1020" fill="#647873" font-size="14" letter-spacing="2">ENTRY</text>
    <text x="355" y="1053" fill="#E3ECE9" font-size="21">${formatPrice(traits.entry)}</text>
    <text x="600" y="1020" fill="#647873" font-size="14" letter-spacing="2">MARK</text>
    <text x="600" y="1053" fill="#E3ECE9" font-size="21">${formatPrice(traits.mark)}</text>
    <text x="1118" y="1020" text-anchor="end" fill="${traits.primary}" font-size="16" font-weight="700" letter-spacing="2">${traits.sizeClass}</text>
    <text x="1118" y="1053" text-anchor="end" fill="#647873" font-size="13">1 / 333 EQUAL UNIT</text>
    <text x="82" y="1114" fill="#536660" font-size="12" letter-spacing="1.5">ABSTRACT LIQUIDITY FOOTPRINT · ${RENDERER_VERSION}</text>
  </g>
</svg>
`;
}

function metadataFor(traits, imageUri, imageHash) {
  return {
    name: `HWA Genesis Position #${traits.displayId}`,
    description:
      "An abstract deterministic HWA liquidity footprint. All trading statistics are simulated, all visual traits are cosmetic, and every token represents one equal unit of the 333-token Genesis snapshot.",
    image: imageUri,
    background_color: "070A0D",
    attributes: [
      { trait_type: "Edition", value: "HWA Genesis" },
      { trait_type: "Size Class", value: traits.sizeClass },
      { trait_type: "Class Supply", display_type: "number", value: traits.classSupply },
      { trait_type: "Side", value: traits.side },
      { trait_type: "Market", value: traits.market },
      { trait_type: "PNL Band", value: traits.pnlBand },
      { trait_type: "Simulated PNL", display_type: "number", value: traits.pnl },
      { trait_type: "Position Size HYPE", display_type: "number", value: traits.sizeHype },
      { trait_type: "Leverage", display_type: "number", value: traits.leverage },
      { trait_type: "Footprint", value: traits.core },
      { trait_type: "Signal", value: traits.signal },
      { trait_type: "Timeframe", value: traits.timeframe },
      { trait_type: "Palette", value: traits.palette },
      { trait_type: "Renderer", value: RENDERER_VERSION },
      { trait_type: "Snapshot Unit", value: "1 / 333" },
      { trait_type: "Simulated", value: "Yes" },
    ],
    properties: {
      token_id: traits.tokenId,
      renderer: RENDERER_VERSION,
      simulated: true,
      equal_snapshot_unit: "1/333",
      visual_seed: traits.visualSeed,
      image_sha256: imageHash,
    },
  };
}

function renderGallery(traits) {
  const cards = traits
    .map(
      (item) => `
        <article class="position" data-class="${item.sizeClass}">
          <img src="./images/${item.displayId}.svg" alt="HWA Genesis Position #${item.displayId}" loading="lazy">
          <div><strong>#${item.displayId}</strong><span>${item.sizeClass}</span></div>
        </article>`,
    )
    .join("");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>HWA Genesis — 333 positions</title>
  <style>
    :root{color-scheme:dark;background:#070a0d;color:#f1f7f5;font-family:Arial,sans-serif}
    *{box-sizing:border-box}body{margin:0;background:#070a0d}
    header{position:sticky;top:0;z-index:3;padding:20px clamp(18px,4vw,60px);display:flex;gap:24px;align-items:center;justify-content:space-between;background:rgba(7,10,13,.9);backdrop-filter:blur(16px);border-bottom:1px solid #1b292e}
    h1{font-size:clamp(20px,3vw,34px);margin:0;letter-spacing:-.03em}p{margin:5px 0 0;color:#819590;font:12px monospace;letter-spacing:.08em}
    nav{display:flex;gap:7px;flex-wrap:wrap;justify-content:flex-end}button{border:1px solid #28373c;background:#0c1317;color:#9eb0ac;border-radius:999px;padding:8px 12px;font:11px monospace;cursor:pointer}button:hover,button.active{color:#070a0d;background:#c8ff3d;border-color:#c8ff3d}
    main{padding:28px clamp(14px,3vw,46px) 70px;display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:18px}
    .position{margin:0;transition:transform .22s ease,opacity .22s ease}.position:hover{transform:translateY(-5px)}.position[hidden]{display:none}
    img{display:block;width:100%;aspect-ratio:1;border-radius:16px;background:#0b1115}
    .position div{display:flex;justify-content:space-between;padding:9px 3px;color:#748783;font:11px monospace}.position strong{color:#dce8e5}
    @media(max-width:640px){header{align-items:flex-start;flex-direction:column}nav{justify-content:flex-start}main{grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;padding-inline:10px}}
  </style>
</head>
<body>
  <header><div><h1>333 Genesis Positions</h1><p>DETERMINISTIC · UNIQUE · SIMULATED</p></div><nav><button class="active" data-filter="ALL">ALL</button>${Object.keys(CLASS_CONFIG).map((name) => `<button data-filter="${name}">${name}</button>`).join("")}</nav></header>
  <main>${cards}</main>
  <script>
    const buttons=[...document.querySelectorAll('button')];const cards=[...document.querySelectorAll('.position')];
    for(const button of buttons)button.addEventListener('click',()=>{for(const item of buttons)item.classList.toggle('active',item===button);for(const card of cards)card.hidden=button.dataset.filter!=='ALL'&&card.dataset.class!==button.dataset.filter;});
  </script>
</body>
</html>`;
}

function renderContactSheet(traits, imagesById) {
  const classMasters = CLASS_ASSIGNMENT_ORDER.slice().reverse().map((sizeClass) =>
    traits.find((item) => item.sizeClass === sizeClass),
  );
  const cardWidth = 400;
  const gap = 24;
  const margin = 34;
  const width = margin * 2 + classMasters.length * cardWidth + (classMasters.length - 1) * gap;
  const cards = classMasters.map((item, index) => {
    const svg = imagesById.get(item.tokenId);
    const encoded = Buffer.from(svg).toString("base64");
    const x = margin + index * (cardWidth + gap);
    return `<g transform="translate(${x} 58)"><image width="${cardWidth}" height="${cardWidth}" href="data:image/svg+xml;base64,${encoded}"/><text x="200" y="440" text-anchor="middle" fill="#F1F7F5" font-family="monospace" font-size="20">${item.sizeClass} · #${item.displayId}</text><text x="200" y="469" text-anchor="middle" fill="#728681" font-family="monospace" font-size="14">${item.classSupply} / 333</text></g>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} 580"><rect width="100%" height="100%" fill="#070A0D"/><text x="34" y="35" fill="#C8FF3D" font-family="monospace" font-size="17" letter-spacing="3">HWA GENESIS · SIZE SYSTEM</text>${cards}</svg>`;
}

function assertEmptyOrMissing(outputPath) {
  if (!existsSync(outputPath)) return;
  if (!statSync(outputPath).isDirectory()) throw new Error(`Output exists and is not a directory: ${outputPath}`);
  if (readdirSync(outputPath).length !== 0) {
    throw new Error(`Refusing to overwrite non-empty output: ${outputPath}`);
  }
}

function verifyOutput(outputPath) {
  const manifestPath = join(outputPath, "manifest.json");
  const traitsPath = join(outputPath, "traits.json");
  if (!existsSync(manifestPath) || !existsSync(traitsPath)) throw new Error("Missing manifest.json or traits.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const traits = JSON.parse(readFileSync(traitsPath, "utf8"));
  if (manifest.supply !== SUPPLY || traits.length !== SUPPLY) throw new Error("Supply mismatch");

  const imageFiles = readdirSync(join(outputPath, "images")).filter((name) => name.endsWith(".svg")).sort();
  const metadataFiles = readdirSync(join(outputPath, "metadata")).filter((name) => name.endsWith(".json")).sort();
  if (imageFiles.length !== SUPPLY || metadataFiles.length !== SUPPLY) throw new Error("Asset file count mismatch");

  const imageHashes = new Set();
  const visualSeeds = new Set();
  const ids = new Set();
  const counts = Object.fromEntries(Object.keys(CLASS_CONFIG).map((name) => [name, 0]));
  for (const item of traits) {
    if (ids.has(item.tokenId)) throw new Error(`Duplicate token ID ${item.tokenId}`);
    ids.add(item.tokenId);
    counts[item.sizeClass] += 1;
    if (visualSeeds.has(item.visualSeed)) throw new Error(`Duplicate visual seed ${item.visualSeed}`);
    visualSeeds.add(item.visualSeed);

    const fileName = `${padId(item.tokenId)}.svg`;
    const imagePath = join(outputPath, "images", fileName);
    const metadataPath = join(outputPath, "metadata", `${padId(item.tokenId)}.json`);
    const svg = readFileSync(imagePath, "utf8");
    if (/Hyperliquid|TokenWorks|referral/i.test(svg)) throw new Error(`Forbidden copied-brand term in ${fileName}`);
    const imageHash = sha256(svg);
    if (imageHashes.has(imageHash)) throw new Error(`Duplicate rendered SVG hash at ${fileName}`);
    imageHashes.add(imageHash);

    const metadata = JSON.parse(readFileSync(metadataPath, "utf8"));
    if (metadata.properties.token_id !== item.tokenId || metadata.properties.image_sha256 !== imageHash) {
      throw new Error(`Metadata/image mismatch for token ${item.tokenId}`);
    }
    const expected = manifest.files.find((entry) => entry.tokenId === item.tokenId);
    if (!expected || expected.imageSha256 !== imageHash || expected.metadataSha256 !== sha256File(metadataPath)) {
      throw new Error(`Manifest hash mismatch for token ${item.tokenId}`);
    }
  }
  for (const [name, config] of Object.entries(CLASS_CONFIG)) {
    if (counts[name] !== config.count) throw new Error(`${name} count mismatch: ${counts[name]} != ${config.count}`);
  }
  if (imageHashes.size !== SUPPLY || visualSeeds.size !== SUPPLY || ids.size !== SUPPLY) {
    throw new Error("Uniqueness invariant failed");
  }

  const aggregate = sha256(
    manifest.files.map((entry) => `${entry.tokenId}:${entry.imageSha256}:${entry.metadataSha256}`).join("\n"),
  );
  if (aggregate !== manifest.aggregateSha256) throw new Error("Aggregate manifest hash mismatch");
  return { counts, imageCount: imageHashes.size, metadataCount: metadataFiles.length, aggregate };
}

function generate(outputPath, imageBaseUri, force) {
  if (force && existsSync(outputPath)) rmSync(outputPath, { recursive: true, force: true });
  assertEmptyOrMissing(outputPath);
  const imagesPath = join(outputPath, "images");
  const metadataPath = join(outputPath, "metadata");
  mkdirSync(imagesPath, { recursive: true });
  mkdirSync(metadataPath, { recursive: true });

  const assigned = classAssignments();
  const traits = Array.from({ length: SUPPLY }, (_, index) => buildTraits(index + 1, assigned.get(index + 1)));
  const imagesById = new Map();
  const fileEntries = [];

  for (const item of traits) {
    const svg = renderSvg(item);
    const imageName = `${item.displayId}.svg`;
    const imagePath = join(imagesPath, imageName);
    writeFileSync(imagePath, svg, "utf8");
    imagesById.set(item.tokenId, svg);
    const imageHash = sha256(svg);
    const metadata = metadataFor(item, `${imageBaseUri}${imageName}`, imageHash);
    const metadataJson = `${JSON.stringify(metadata, null, 2)}\n`;
    const metadataFile = join(metadataPath, `${item.displayId}.json`);
    writeFileSync(metadataFile, metadataJson, "utf8");
    fileEntries.push({
      tokenId: item.tokenId,
      image: `images/${imageName}`,
      imageSha256: imageHash,
      metadata: `metadata/${item.displayId}.json`,
      metadataSha256: sha256(metadataJson),
    });
  }

  writeFileSync(join(outputPath, "traits.json"), `${JSON.stringify(traits, null, 2)}\n`, "utf8");
  writeFileSync(join(outputPath, "gallery.html"), renderGallery(traits), "utf8");
  writeFileSync(join(outputPath, "contact-sheet.svg"), renderContactSheet(traits, imagesById), "utf8");

  const classMasterIds = Object.fromEntries(
    Object.keys(CLASS_CONFIG).map((name) => [name, traits.find((item) => item.sizeClass === name).tokenId]),
  );
  const manifest = {
    schemaVersion: 1,
    collection: "Hyper World Assets Genesis",
    symbol: "HWAG",
    rendererVersion: RENDERER_VERSION,
    supply: SUPPLY,
    deterministicScheme: "SHA-256 scoped seeds derived from token ID; no runtime randomness",
    simulatedTradingData: true,
    equalEconomicUnits: true,
    imageBaseUri,
    exactClassCounts: Object.fromEntries(Object.entries(CLASS_CONFIG).map(([name, config]) => [name, config.count])),
    classMasterIds,
    traitsSha256: sha256File(join(outputPath, "traits.json")),
    gallerySha256: sha256File(join(outputPath, "gallery.html")),
    contactSheetSha256: sha256File(join(outputPath, "contact-sheet.svg")),
    files: fileEntries,
    aggregateSha256: sha256(
      fileEntries.map((entry) => `${entry.tokenId}:${entry.imageSha256}:${entry.metadataSha256}`).join("\n"),
    ),
  };
  writeFileSync(join(outputPath, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return verifyOutput(outputPath);
}

const args = parseArgs(process.argv.slice(2));
const outputPath = resolveSafeOutput(args.output);
const result = args.verifyOnly ? verifyOutput(outputPath) : generate(outputPath, args.imageBaseUri, args.force);
process.stdout.write(
  `${args.verifyOnly ? "Verified" : "Generated and verified"} ${result.imageCount} unique HWA Genesis SVGs and ${result.metadataCount} metadata files.\n` +
    `Classes: ${Object.entries(result.counts).map(([name, count]) => `${name}=${count}`).join(", ")}\n` +
    `Aggregate SHA-256: ${result.aggregate}\n` +
    `Output: ${outputPath}\n`,
);
