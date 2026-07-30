#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(SCRIPT_DIR, "..");
const FRONTEND_ROOT = join(PROJECT_ROOT, "frontend");
const WORDMARK_PATH = join(FRONTEND_ROOT, "public", "brand", "hwa-wordmark.png");
const DEFAULT_OUT = "frontend/public/brand/hwa-banner.png";
const DEFAULT_SEED = "333";
const DEFAULT_WIDTH = 1500;
const DEFAULT_HEIGHT = 500;

const require = createRequire(import.meta.url);
const sharp = require(join(FRONTEND_ROOT, "node_modules", "sharp"));

const COLORS = Object.freeze({
  bg: "#080a12",
  surface: "#0e1220",
  surface2: "#151a2c",
  line: "#2a3148",
  strong: "#3b4563",
  bone: "#e9f5ff",
  muted: "#8f96b2",
  faint: "#7c85a2",
  volt: "#d8ff52",
  voltEdge: "#8fae22",
  ultraviolet: "#7354f5",
  ultravioletReadable: "#a995ff",
  teal: "#50d2c1",
});

const TAU = Math.PI * 2;
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const between = (rng, low, high) => low + (high - low) * rng();
const f = (value) => (Math.round(value * 10) / 10).toString();

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

function softplus(value) {
  if (value > 30) return value;
  if (value < -30) return 0;
  return Math.log1p(Math.exp(value));
}

function smoothClosedPath(points) {
  const count = points.length;
  const at = (index) => points[((index % count) + count) % count];
  let d = `M ${f(points[0][0])} ${f(points[0][1])}`;
  for (let index = 0; index < count; index += 1) {
    const p0 = at(index - 1);
    const p1 = at(index);
    const p2 = at(index + 1);
    const p3 = at(index + 2);
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C ${f(c1[0])} ${f(c1[1])} ${f(c2[0])} ${f(c2[1])} ${f(p2[0])} ${f(p2[1])}`;
  }
  return `${d} Z`;
}

function escapeXml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function parsePositiveInteger(value, flag) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${flag} must be a positive integer`);
  return parsed;
}

function parseArgs(argv) {
  const args = {
    out: DEFAULT_OUT,
    seed: DEFAULT_SEED,
    width: DEFAULT_WIDTH,
    height: DEFAULT_HEIGHT,
    compare: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--out") args.out = argv[++index];
    else if (arg === "--seed") args.seed = argv[++index];
    else if (arg === "--width") args.width = parsePositiveInteger(argv[++index], "--width");
    else if (arg === "--height") args.height = parsePositiveInteger(argv[++index], "--height");
    else if (arg === "--compare") args.compare = argv[++index]?.split(",").map((seed) => seed.trim()).filter(Boolean);
    else if (arg === "--help") {
      process.stdout.write([
        "Usage: node scripts/generate-hwa-banner.mjs [options]",
        "",
        `  --out <path>       PNG output (default: ${DEFAULT_OUT})`,
        `  --seed <value>     Deterministic seed (default: ${DEFAULT_SEED})`,
        `  --width <pixels>   Output width (default: ${DEFAULT_WIDTH})`,
        `  --height <pixels>  Output height (default: ${DEFAULT_HEIGHT})`,
        "  --compare <a,b,c> Render 2-3 seeds side by side into --out",
        "",
      ].join("\n"));
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!args.out) throw new Error("--out cannot be empty");
  if (!args.seed) throw new Error("--seed cannot be empty");
  if (args.compare && (args.compare.length < 2 || args.compare.length > 3)) {
    throw new Error("--compare expects two or three comma-separated seeds");
  }
  return args;
}

function resolveOut(out) {
  return isAbsolute(out) ? resolve(out) : resolve(PROJECT_ROOT, out);
}

function gridPaper(width, height, unit) {
  const step = 52 * unit;
  const lines = [];
  for (let x = step; x < width; x += step) {
    lines.push(`<line x1="${f(x)}" y1="0" x2="${f(x)}" y2="${height}"/>`);
  }
  for (let y = step; y < height; y += step) {
    lines.push(`<line x1="0" y1="${f(y)}" x2="${width}" y2="${f(y)}"/>`);
  }
  return `<g stroke="${COLORS.bone}" stroke-opacity="0.025" stroke-width="${f(0.65 * unit)}">${lines.join("")}</g>`;
}

function pressureGeometry({ rng, cx, cy, maxR, xScale, wallY, ringCount, samples = 180 }) {
  const wallDist = wallY - cy;
  const k = maxR * 0.05;
  const amplitude = between(rng, 0.034, 0.058);
  const f1 = 2 + Math.floor(rng() * 2);
  const f2 = 5 + Math.floor(rng() * 2);
  const f3 = 8 + Math.floor(rng() * 3);
  const phase1 = rng() * TAU;
  const phase2 = rng() * TAU;
  const phase3 = rng() * TAU;
  const drift = between(rng, -0.12, 0.12);
  const rings = [];
  let contactMin = Number.POSITIVE_INFINITY;
  let contactMax = Number.NEGATIVE_INFINITY;

  for (let ringIndex = 0; ringIndex < ringCount; ringIndex += 1) {
    const t = (ringIndex + 1) / ringCount;
    const baseR = maxR * Math.pow(t, 0.92);
    const gap = maxR * (0.035 + (ringCount - 1 - ringIndex) * 0.019);
    const limit = wallDist - gap;
    const points = [];

    for (let sample = 0; sample < samples; sample += 1) {
      const angle = (sample / samples) * TAU;
      const rawY = baseR * Math.sin(angle);
      const nearWall = clamp((rawY - (limit - maxR * 0.24)) / (maxR * 0.24), 0, 1);
      const wobbleDamping = 1 - 0.88 * nearWall;
      const wobble = 1 + amplitude * (0.35 + 0.65 * t) * wobbleDamping * (
        Math.sin(f1 * angle + phase1 + drift * ringIndex) +
        0.52 * Math.sin(f2 * angle + phase2 - drift * ringIndex) +
        0.26 * Math.sin(f3 * angle + phase3)
      );
      const radius = baseR * wobble;
      const rawX = radius * Math.cos(angle) * xScale;
      const beforePressureY = radius * Math.sin(angle);
      const pressedY = beforePressureY - k * softplus((beforePressureY - limit) / k);
      points.push([cx + rawX, cy + pressedY]);

      if (ringIndex === ringCount - 1 && beforePressureY > limit + maxR * 0.01) {
        contactMin = Math.min(contactMin, rawX);
        contactMax = Math.max(contactMax, rawX);
      }
    }

    rings.push({ d: smoothClosedPath(points), t, ringIndex });
  }

  return { rings, contactMin, contactMax, wallDist };
}

function renderCardBack({ id, x, y, width, height, angle, rng, unit }) {
  const cx = width / 2;
  const cy = height * 0.46;
  const wallY = height * 0.74;
  const geometry = pressureGeometry({
    rng,
    cx,
    cy,
    maxR: height * 0.27,
    xScale: 0.88,
    wallY,
    ringCount: 6,
    samples: 96,
  });
  const rings = geometry.rings.map(({ d, t }) => (
    `<path d="${d}" fill="none" stroke="${COLORS.ultravioletReadable}" stroke-opacity="${(0.12 + (1 - t) * 0.18).toFixed(3)}" stroke-width="${f(unit)}"/>`
  )).join("");

  return `<g transform="translate(${f(x)} ${f(y)}) rotate(${f(angle)} ${f(width / 2)} ${f(height / 2)})" opacity="0.62">
    <rect width="${f(width)}" height="${f(height)}" rx="${f(12 * unit)}" fill="${COLORS.surface}" stroke="${COLORS.ultraviolet}" stroke-opacity="0.46" stroke-width="${f(1.2 * unit)}"/>
    <rect x="${f(10 * unit)}" y="${f(10 * unit)}" width="${f(width - 20 * unit)}" height="${f(height - 20 * unit)}" rx="${f(7 * unit)}" fill="none" stroke="${COLORS.strong}" stroke-opacity="0.55" stroke-width="${f(0.8 * unit)}"/>
    <g clip-path="url(#${id})">${rings}</g>
    <line x1="${f(18 * unit)}" y1="${f(wallY)}" x2="${f(width - 18 * unit)}" y2="${f(wallY)}" stroke="${COLORS.ultravioletReadable}" stroke-opacity="0.32" stroke-width="${f(unit)}"/>
    <text x="${f(width / 2)}" y="${f(height * 0.56)}" text-anchor="middle" fill="${COLORS.bone}" fill-opacity="0.52" font-family="'Cascadia Mono', Consolas, monospace" font-size="${f(34 * unit)}" font-weight="600">?</text>
    <text x="${f(17 * unit)}" y="${f(height - 18 * unit)}" fill="${COLORS.ultravioletReadable}" fill-opacity="0.55" font-family="'Cascadia Mono', Consolas, monospace" font-size="${f(7.5 * unit)}" font-weight="600" letter-spacing="${f(1.5 * unit)}">HWA / SEALED</text>
  </g>`;
}

function renderPressureField({ rng, width, height, wide, unit }) {
  const cx = width * (wide ? between(rng, 0.695, 0.72) : between(rng, 0.67, 0.7));
  const cy = height * (wide ? between(rng, 0.41, 0.44) : between(rng, 0.52, 0.55));
  const wallY = height * (wide ? 0.755 : 0.82);
  const maxR = height * (wide ? between(rng, 0.455, 0.475) : between(rng, 0.365, 0.385));
  const xScale = wide ? between(rng, 1.26, 1.34) : between(rng, 1.08, 1.15);
  const ringCount = 16;
  const geometry = pressureGeometry({ rng, cx, cy, maxR, xScale, wallY, ringCount });

  const rings = geometry.rings.map(({ d, t, ringIndex }) => {
    const depthRing = ringIndex >= ringCount - 4;
    const stroke = depthRing ? COLORS.ultravioletReadable : COLORS.volt;
    const opacity = depthRing ? 0.34 + (ringCount - 1 - ringIndex) * 0.045 : 0.78 - t * 0.31;
    const strokeWidth = (1.9 - t * 0.65) * unit;
    return `<path d="${d}" fill="none" stroke="${stroke}" stroke-opacity="${opacity.toFixed(3)}" stroke-width="${f(strokeWidth)}"/>`;
  }).join("");

  const wallStart = width * (wide ? 0.46 : 0.32);
  const wallEnd = width * 0.955;
  const tickCount = wide ? 11 : 9;
  const liveTickIndex = tickCount - 2;
  const ticks = Array.from({ length: tickCount }, (_, index) => {
    const x = wallStart + ((wallEnd - wallStart) * index) / (tickCount - 1);
    const live = index === liveTickIndex;
    return `<line x1="${f(x)}" y1="${f(wallY)}" x2="${f(x)}" y2="${f(wallY + (live ? 11 : 7) * unit)}" stroke="${live ? COLORS.teal : COLORS.bone}" stroke-opacity="${live ? "0.95" : "0.28"}" stroke-width="${f((live ? 2 : 1) * unit)}"/>`;
  }).join("");

  const contactPadding = maxR * 0.08;
  const contactStart = clamp(cx + geometry.contactMin - contactPadding, wallStart, wallEnd);
  const contactEnd = clamp(cx + geometry.contactMax + contactPadding, wallStart, wallEnd);
  const strata = [0.04, 0.095, 0.17].map((offset, index) => {
    const y = wallY + height * offset;
    const reach = maxR * xScale * (1.02 - index * 0.16);
    return `<line x1="${f(cx - reach)}" y1="${f(y)}" x2="${f(cx + reach)}" y2="${f(y)}" stroke="${index === 2 ? COLORS.ultraviolet : COLORS.volt}" stroke-opacity="${(0.13 - index * 0.035).toFixed(3)}" stroke-width="${f(1.05 * unit)}"/>`;
  }).join("");

  const markX = cx + maxR * between(rng, -0.06, 0.12);
  const markY = cy - maxR * between(rng, 0.24, 0.34);

  return `<g>
    ${rings}
    ${strata}
    <line x1="${f(wallStart)}" y1="${f(wallY)}" x2="${f(wallEnd)}" y2="${f(wallY)}" stroke="${COLORS.bone}" stroke-opacity="0.48" stroke-width="${f(1.25 * unit)}"/>
    ${ticks}
    <line x1="${f(contactStart)}" y1="${f(wallY)}" x2="${f(contactEnd)}" y2="${f(wallY)}" stroke="${COLORS.volt}" stroke-opacity="0.92" stroke-width="${f(3 * unit)}"/>
    <circle cx="${f(cx)}" cy="${f(cy)}" r="${f(3.6 * unit)}" fill="${COLORS.volt}"/>
    <circle cx="${f(cx)}" cy="${f(cy)}" r="${f(10 * unit)}" fill="none" stroke="${COLORS.ultravioletReadable}" stroke-opacity="0.7" stroke-width="${f(1.2 * unit)}"/>
    <circle cx="${f(markX)}" cy="${f(markY)}" r="${f(4.6 * unit)}" fill="${COLORS.bone}"/>
    <circle cx="${f(markX)}" cy="${f(markY)}" r="${f(10.5 * unit)}" fill="none" stroke="${COLORS.bone}" stroke-opacity="0.42" stroke-width="${f(unit)}"/>
  </g>`;
}

function renderSvg({ seed, width, height, wordmarkData }) {
  const rng = rngFor(`HWA_BANNER_V1:${seed}`);
  const aspect = width / height;
  const wide = aspect >= 2.4;
  const unit = height / 500;

  const wordmarkX = width * (wide ? 0.112 : 0.075);
  const wordmarkY = height * (wide ? 0.305 : 0.12);
  const wordmarkWidth = width * (wide ? 0.27 : 0.34);
  const wordmarkHeight = wordmarkWidth * (489 / 1098);
  const microY = wordmarkY + wordmarkHeight + 28 * unit;
  const stampY = microY + 30 * unit;

  const cardWidth = height * (wide ? 0.285 : 0.25);
  const cardHeight = cardWidth * 1.42;
  const cardX = width * (wide ? 0.78 : 0.76);
  const cardY = height * (wide ? 0.09 : 0.16);
  const cardAngle = between(rng, 4.2, 7.4);
  const cardId = `hwa-card-${createHash("sha256").update(seed).digest("hex").slice(0, 8)}`;
  const cardRng = rngFor(`HWA_BANNER_CARD:${seed}`);

  const title = `HWA banner — Pressure Field seed ${seed}`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(title)}">
  <defs>
    <clipPath id="${cardId}">
      <rect x="${f(10 * unit)}" y="${f(10 * unit)}" width="${f(cardWidth - 20 * unit)}" height="${f(cardHeight - 20 * unit)}" rx="${f(7 * unit)}"/>
    </clipPath>
  </defs>
  <rect width="${width}" height="${height}" fill="${COLORS.bg}"/>
  ${gridPaper(width, height, unit)}
  ${renderCardBack({ id: cardId, x: cardX, y: cardY, width: cardWidth, height: cardHeight, angle: cardAngle, rng: cardRng, unit })}
  ${renderPressureField({ rng, width, height, wide, unit })}
  <g>
    <image href="data:image/png;base64,${wordmarkData}" x="${f(wordmarkX)}" y="${f(wordmarkY)}" width="${f(wordmarkWidth)}" height="${f(wordmarkHeight)}" preserveAspectRatio="xMinYMid meet"/>
    <text x="${f(wordmarkX + 3 * unit)}" y="${f(microY)}" fill="${COLORS.muted}" font-family="'Cascadia Mono', Consolas, monospace" font-size="${f(12 * unit)}" font-weight="600" letter-spacing="${f(2.2 * unit)}">HWA · HYPEREVM · 333 GENESIS</text>
    <g transform="translate(${f(wordmarkX + 2 * unit)} ${f(stampY)}) rotate(-1.5)">
      <rect x="0" y="${f(-17 * unit)}" width="${f(152 * unit)}" height="${f(27 * unit)}" rx="${f(3 * unit)}" fill="${COLORS.volt}" fill-opacity="0.035" stroke="${COLORS.volt}" stroke-opacity="0.68" stroke-width="${f(1.2 * unit)}"/>
      <text x="${f(10 * unit)}" y="0" fill="${COLORS.volt}" fill-opacity="0.86" font-family="'Cascadia Mono', Consolas, monospace" font-size="${f(10 * unit)}" font-weight="700" letter-spacing="${f(1.6 * unit)}">PRESSURE FIELD</text>
    </g>
  </g>
</svg>`;
}

async function renderPng({ seed, width, height, wordmarkData }) {
  const svg = renderSvg({ seed, width, height, wordmarkData });
  return sharp(Buffer.from(svg))
    .png({ compressionLevel: 9, adaptiveFiltering: false, palette: false })
    .removeAlpha()
    .toBuffer();
}

async function renderComparison({ seeds, outPath, wordmarkData }) {
  const previewWidth = 900;
  const previewHeight = 300;
  const gap = 18;
  const padding = 28;
  const labelHeight = 44;
  const width = padding * 2 + previewWidth * seeds.length + gap * (seeds.length - 1);
  const height = padding * 2 + labelHeight + previewHeight;
  const composites = [];

  for (let index = 0; index < seeds.length; index += 1) {
    const seed = seeds[index];
    const png = await renderPng({ seed, width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT, wordmarkData });
    const preview = await sharp(png).resize(previewWidth, previewHeight, { kernel: sharp.kernel.lanczos3 }).toBuffer();
    const left = padding + index * (previewWidth + gap);
    const labelSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${previewWidth}" height="${labelHeight}">
      <text x="0" y="27" fill="${COLORS.bone}" font-family="'Cascadia Mono', Consolas, monospace" font-size="18" font-weight="600" letter-spacing="2">SEED ${escapeXml(seed)}</text>
    </svg>`;
    composites.push({ input: Buffer.from(labelSvg), left, top: padding });
    composites.push({ input: preview, left, top: padding + labelHeight });
  }

  await sharp({ create: { width, height, channels: 3, background: COLORS.bg } })
    .composite(composites)
    .png({ compressionLevel: 9, adaptiveFiltering: false, palette: false })
    .toFile(outPath);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!existsSync(WORDMARK_PATH)) throw new Error(`Missing wordmark: ${WORDMARK_PATH}`);
  const outPath = resolveOut(args.out);
  mkdirSync(dirname(outPath), { recursive: true });
  const wordmarkData = readFileSync(WORDMARK_PATH).toString("base64");

  if (args.compare) {
    await renderComparison({ seeds: args.compare, outPath, wordmarkData });
    process.stdout.write(`Rendered ${args.compare.length} deterministic banner seeds to ${outPath}\n`);
    return;
  }

  const png = await renderPng({ seed: args.seed, width: args.width, height: args.height, wordmarkData });
  await sharp(png).toFile(outPath);
  const metadata = await sharp(outPath).metadata();
  process.stdout.write(`Rendered seed ${args.seed} at ${metadata.width}x${metadata.height} to ${outPath}\n`);
}

await main();
