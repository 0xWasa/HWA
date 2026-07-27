#!/usr/bin/env node
// HWA Genesis v3 — production renderer. Direction A "PRESSURE FIELD".
//
// Each token is a pressure field: organic contour rings (the position) crushed
// against an absolute straight line — the liquidation wall. Leverage sets how
// close the wall cuts, side sets whether it waits below (LONG) or above (SHORT),
// volatility storms the contours, PNL lights or hollows the core. Trading data
// is a secondary signature; the art carries the token.
//
// Deterministic: SHA-256 scoped seeds from token IDs, no runtime randomness,
// no external assets, no remote fonts. Preserves v1/v2 untouched.
//
// Usage:
//   node scripts/generate-hwa-genesis-v3.mjs                  generate + verify (default output)
//   node scripts/generate-hwa-genesis-v3.mjs --verify-only    verify an existing output
//   node scripts/generate-hwa-genesis-v3.mjs --force          replace the output directory

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(SCRIPT_DIR, "..");
const SUPPLY = 333;
const RENDERER_VERSION = "HWA-GEN-3.0.0";
const DIRECTION = "PRESSURE FIELD";
const DEFAULT_OUTPUT = "frontend/public/genesis/v3";
const DEFAULT_IMAGE_BASE_URI = "ipfs://__HWA_GENESIS_V3_IMAGES_CID__/";
const CANVAS = 1200;
const GEOM_OPEN = "<!--GEOM-->";
const GEOM_CLOSE = "<!--/GEOM-->";

// ---------------------------------------------------------------------------
// Exact categorical distributions (all sum to 333, all independent of PNL)
// ---------------------------------------------------------------------------

const CLASSES = {
  SCALP:    { count: 200, footprint: 0.52, rings: 5,  sizeRange: [0.05, 1.5] },
  SIZE:     { count: 80,  footprint: 0.62, rings: 7,  sizeRange: [1.5, 8] },
  WHALE:    { count: 35,  footprint: 0.72, rings: 9,  sizeRange: [8, 40] },
  COLOSSAL: { count: 15,  footprint: 0.83, rings: 11, sizeRange: [40, 150] },
  CROWN:    { count: 3,   footprint: 0.95, rings: 14, sizeRange: [150, 333] },
};

const SIDES = { LONG: { count: 193 }, SHORT: { count: 140 } };

const FORMATIONS = {
  FIELD: { count: 231 }, // standard single pressure field
  VENT:  { count: 68 },  // one angular sector bleeds pressure (dashed sector)
  VISE:  { count: 34 },  // squeezed between two walls
};

const LEVERAGE_BANDS = {
  FAR:      { count: 55,  values: [2, 3, 4] },
  NEAR:     { count: 118, values: [5, 8, 10, 12] },
  PRESS:    { count: 98,  values: [15, 20, 25] },
  SQUEEZE:  { count: 47,  values: [30, 35, 40, 45] },
  TERMINAL: { count: 15,  values: [50] },
};

const SIDE_INK = {
  LONG: {
    base: "#6FEFC6", bright: "#D9FFF1", dim: "#2E6B58",
  },
  SHORT: {
    base: "#FF7E9B", bright: "#FFD9E2", dim: "#753247",
  },
};

const BONE = "#E9F5EF";
const MIST = "#7E9A8F";
const BG = "030C09";

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

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
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    const t = (a + b + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = ((c << 21) | (c >>> 11)) + t;
    return (t >>> 0) / 4294967296;
  };
}

const between = (rng, lo, hi) => lo + (hi - lo) * rng();
const pick = (rng, values) => values[Math.floor(rng() * values.length)];
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const round = (x, digits) => Math.round(x * 10 ** digits) / 10 ** digits;
const f = (x) => (Math.round(x * 10) / 10).toString();
const pad3 = (n) => String(n).padStart(3, "0");
const TAU = Math.PI * 2;

function softplus(x) {
  if (x > 30) return x;
  if (x < -30) return 0;
  return Math.log1p(Math.exp(x));
}

function smoothClosedPath(pts) {
  const n = pts.length;
  let d = `M ${f(pts[0][0])} ${f(pts[0][1])}`;
  for (let i = 0; i < n; i += 1) {
    const p0 = pts[(i - 1 + n) % n];
    const p1 = pts[i];
    const p2 = pts[(i + 1) % n];
    const p3 = pts[(i + 2) % n];
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C ${f(c1[0])} ${f(c1[1])} ${f(c2[0])} ${f(c2[1])} ${f(p2[0])} ${f(p2[1])}`;
  }
  return `${d} Z`;
}

function smoothOpenPath(pts) {
  const n = pts.length;
  if (n < 2) return "";
  let d = `M ${f(pts[0][0])} ${f(pts[0][1])}`;
  for (let i = 0; i < n - 1; i += 1) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(n - 1, i + 2)];
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C ${f(c1[0])} ${f(c1[1])} ${f(c2[0])} ${f(c2[1])} ${f(p2[0])} ${f(p2[1])}`;
  }
  return d;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = { output: DEFAULT_OUTPUT, imageBaseUri: DEFAULT_IMAGE_BASE_URI, verifyOnly: false, force: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--output") args.output = argv[++index];
    else if (arg === "--image-base-uri") args.imageBaseUri = argv[++index];
    else if (arg === "--verify-only") args.verifyOnly = true;
    else if (arg === "--force") args.force = true;
    else if (arg === "--help") {
      process.stdout.write(
        [
          "Usage: node scripts/generate-hwa-genesis-v3.mjs [options]",
          "",
          `  --output <path>          Output directory (default: ${DEFAULT_OUTPUT})`,
          "  --image-base-uri <uri>  URI prefix written into metadata",
          "  --verify-only           Verify an existing output without writing",
          "  --force                 Replace the selected generated output directory",
          "",
        ].join("\n"),
      );
      process.exit(0);
    } else throw new Error(`Unknown argument: ${arg}`);
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

// ---------------------------------------------------------------------------
// Deterministic exact assignments
// ---------------------------------------------------------------------------

function assignExact(scope, buckets) {
  const ids = Array.from({ length: SUPPLY }, (_, i) => i + 1);
  ids.sort((a, b) => sha256(`${scope}:${a}`).localeCompare(sha256(`${scope}:${b}`)));
  const assigned = new Map();
  let cursor = 0;
  for (const [name, cfg] of Object.entries(buckets)) {
    for (let i = 0; i < cfg.count; i += 1) assigned.set(ids[cursor++], name);
  }
  if (cursor !== SUPPLY) throw new Error(`${scope}: bucket counts do not sum to ${SUPPLY}`);
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

function surfaceTier(vol) {
  if (vol < 0.35) return "GLASS";
  if (vol < 0.6) return "RIPPLE";
  if (vol < 0.82) return "SWELL";
  return "STORM";
}

function buildTraits(tokenId, sizeClass, side, formation, levBand) {
  const rng = rngFor(`HWA_GENESIS_V3_TRAITS:${tokenId}`);
  const cls = CLASSES[sizeClass];
  const leverage = pick(rng, LEVERAGE_BANDS[levBand].values);
  const pnl = pnlFor(rng);
  const vol = round(between(rng, 0.12, 1), 3);
  const entry = 10 ** between(rng, -3.2, -0.15);
  const direction = side === "LONG" ? 1 : -1;
  const mark = entry * (1 + (direction * pnl) / (100 * leverage));
  if (!(mark > 0)) throw new Error(`Non-positive mark for token ${tokenId}`);
  const sizeHype = round(between(rng, cls.sizeRange[0], cls.sizeRange[1]), 3);

  return {
    tokenId,
    displayId: pad3(tokenId),
    sizeClass,
    classSupply: cls.count,
    side,
    formation,
    leverageBand: levBand,
    leverage,
    pnl,
    pnlBand: pnlBand(pnl),
    volatility: vol,
    surface: surfaceTier(vol),
    entry: round(entry, 8),
    mark: round(mark, 8),
    sizeHype,
    visualSeed: `0x${sha256(`HWA_GENESIS_V3_VISUAL:${tokenId}`)}`,
  };
}

// ---------------------------------------------------------------------------
// Renderer — PRESSURE FIELD
// ---------------------------------------------------------------------------

function renderArt(t) {
  const rng = rngFor(`HWA_GENESIS_V3_ART:${t.tokenId}`);
  const ink = SIDE_INK[t.side];
  const cls = CLASSES[t.sizeClass];
  const levNorm = clamp(t.leverage / 50, 0, 1);
  const win = t.pnl > 3;
  const flat = t.pnl >= -3 && t.pnl <= 3;
  const sideKey = t.side === "LONG" ? "L" : "S";

  const maxR = cls.footprint * 520;
  const tilt = between(rng, -0.10, 0.10);
  const nSign = t.side === "LONG" ? 1 : -1;
  const n = [Math.sin(tilt) * nSign, Math.cos(tilt) * nSign];
  const tangent = [Math.cos(tilt), -Math.sin(tilt)];
  const wallDist = maxR * (1.02 - 0.68 * levNorm);

  const shift = (maxR - wallDist) * 0.5;
  const cx = 600 + n[0] * shift + between(rng, -22, 22);
  const cy = 600 + n[1] * shift;

  // VISE: a second, fainter wall on the opposite side squeezes the field.
  const vise = t.formation === "VISE";
  const wallDist2 = vise ? wallDist * between(rng, 1.15, 1.45) : Infinity;

  // VENT: one angular sector bleeds pressure (rings turn dashed and thin).
  // The sector always opens away from the wall, so it never collides with the
  // flattened contact zone (which would render as stacked shelf artifacts).
  const vent = t.formation === "VENT";
  const ventWidth = between(rng, 0.8, 1.35);
  const wallAngle = Math.atan2(n[1], n[0]);
  const ventCenter = wallAngle + Math.PI + between(rng, -1.5, 1.5);
  const ventStart = (((ventCenter - ventWidth / 2) % TAU) + TAU) % TAU;

  const amp = 0.035 + 0.085 * t.volatility;
  const f1 = 2 + Math.floor(rng() * 2);
  const f2 = 4 + Math.floor(rng() * 2);
  const f3 = 6 + Math.floor(rng() * 4);
  const ph1 = rng() * TAU;
  const ph2 = rng() * TAU;
  const ph3 = rng() * TAU;
  const drift = (rng() < 0.5 ? -1 : 1) * t.volatility * 0.2;

  const nRings = cls.rings;
  const N = 144;
  const k = maxR * 0.055;
  const nBright = win ? 1 + (t.pnl >= 110 ? 1 : 0) + (t.pnl >= 280 ? 1 : 0) : 0;

  const rings = [];
  let contactMin = Infinity;
  let contactMax = -Infinity;

  for (let ri = 0; ri < nRings; ri += 1) {
    const tt01 = (ri + 1) / nRings;
    const baseR = maxR * Math.pow(tt01, 0.92);
    const gap = 14 + (nRings - 1 - ri) * 9;
    const limit = wallDist - gap;
    const limit2 = wallDist2 - gap;
    const inVent = [];
    const pts = [];
    for (let i = 0; i < N; i += 1) {
      const th = (i / N) * TAU;
      const ux = Math.cos(th);
      const uy = Math.sin(th);
      // Pressure calms turbulence near the wall: damp the wobble so peaks never
      // get sheared into isolated shelves far from the actual contact zone.
      const d0raw = baseR * (ux * n[0] + uy * n[1]);
      let near = clamp((d0raw - (limit - 70)) / 70, 0, 1);
      if (vise) near = Math.max(near, clamp((-d0raw - (limit2 - 70)) / 70, 0, 1));
      const wobDamp = 1 - 0.85 * near;
      const wob = 1 + amp * (0.35 + 0.65 * tt01) * wobDamp *
        (Math.sin(f1 * th + ph1 + drift * ri) + 0.55 * Math.sin(f2 * th + ph2 - drift * ri) + 0.30 * Math.sin(f3 * th + ph3));
      const r = baseR * wob;
      let p = [r * ux, r * uy];
      let d0 = p[0] * n[0] + p[1] * n[1];
      let dNew = d0 - k * softplus((d0 - limit) / k);
      p = [p[0] + n[0] * (dNew - d0), p[1] + n[1] * (dNew - d0)];
      if (vise) {
        const d1 = -(p[0] * n[0] + p[1] * n[1]);
        const dNew1 = d1 - k * softplus((d1 - limit2) / k);
        p = [p[0] - n[0] * (dNew1 - d1), p[1] - n[1] * (dNew1 - d1)];
      }
      if (ri === nRings - 1 && d0 > limit + 2) {
        const proj = p[0] * tangent[0] + p[1] * tangent[1];
        if (proj < contactMin) contactMin = proj;
        if (proj > contactMax) contactMax = proj;
      }
      let dv = th - ventStart;
      dv = ((dv % TAU) + TAU) % TAU;
      inVent.push(vent && ri >= 2 && dv < ventWidth);
      pts.push([cx + p[0], cy + p[1]]);
    }

    const tt = 1 - tt01;
    const width = 1.8 + tt * 1.6;
    const baseOpacity = 0.42 + tt * 0.5;
    const opacity = win ? baseOpacity : baseOpacity * 0.85;
    const dashedDecay = !win && !flat && ri >= nRings - 2;
    const stroke = ri < nBright ? ink.bright : ink.base;

    if (!inVent.some(Boolean)) {
      const dashed = dashedDecay ? ` stroke-dasharray="6 10"` : "";
      rings.push(`<path d="${smoothClosedPath(pts)}" fill="none" stroke="${stroke}" stroke-opacity="${opacity.toFixed(2)}" stroke-width="${width.toFixed(2)}"${dashed}/>`);
    } else {
      // Split the loop into contiguous runs per flag; merge the wrap-around run
      // so each run renders as ONE open path (a concatenated jump would fold
      // back on itself and leave barb artifacts at the sector boundary).
      const runs = [];
      let runStart = 0;
      for (let i2 = 1; i2 <= N; i2 += 1) {
        if (i2 === N || inVent[i2] !== inVent[runStart]) {
          runs.push({ vent: inVent[runStart], from: runStart, to: i2 - 1, wrapFrom: -1 });
          runStart = i2;
        }
      }
      if (runs.length > 1 && runs[0].vent === runs[runs.length - 1].vent) {
        const tail = runs.pop();
        runs[0].wrapFrom = tail.from;
      }
      const dashed = dashedDecay ? ` stroke-dasharray="6 10"` : "";
      for (const run of runs) {
        const ptsRun = [];
        if (run.wrapFrom >= 0) for (let i2 = run.wrapFrom; i2 < N; i2 += 1) ptsRun.push(pts[i2]);
        for (let i2 = run.from; i2 <= run.to; i2 += 1) ptsRun.push(pts[i2]);
        if (ptsRun.length < 2) continue;
        if (run.vent) {
          rings.push(`<path d="${smoothOpenPath(ptsRun)}" fill="none" stroke="${stroke}" stroke-opacity="${(opacity * 0.62).toFixed(2)}" stroke-width="${(width * 0.8).toFixed(2)}" stroke-dasharray="2 7" stroke-linecap="round"/>`);
        } else {
          rings.push(`<path d="${smoothOpenPath(ptsRun)}" fill="none" stroke="${stroke}" stroke-opacity="${opacity.toFixed(2)}" stroke-width="${width.toFixed(2)}"${dashed} stroke-linecap="round"/>`);
        }
      }
    }
  }

  // Primary liquidation wall.
  const wp = [cx + n[0] * wallDist, cy + n[1] * wallDist];
  const wallA = [wp[0] - tangent[0] * 900, wp[1] - tangent[1] * 900];
  const wallB = [wp[0] + tangent[0] * 900, wp[1] + tangent[1] * 900];
  const ticks = Array.from({ length: 15 }, (_, i) => {
    const s = -700 + (i / 14) * 1400;
    const bx = wp[0] + tangent[0] * s;
    const by = wp[1] + tangent[1] * s;
    return `<line x1="${f(bx)}" y1="${f(by)}" x2="${f(bx + n[0] * 9)}" y2="${f(by + n[1] * 9)}" stroke="${BONE}" stroke-opacity="0.22" stroke-width="1.4"/>`;
  }).join("\n    ");

  let contact = "";
  if (contactMax > contactMin) {
    const pad = 26;
    const a = [wp[0] + tangent[0] * (contactMin - pad), wp[1] + tangent[1] * (contactMin - pad)];
    const b = [wp[0] + tangent[0] * (contactMax + pad), wp[1] + tangent[1] * (contactMax + pad)];
    contact = `<line x1="${f(a[0])}" y1="${f(a[1])}" x2="${f(b[0])}" y2="${f(b[1])}" stroke="${ink.bright}" stroke-opacity="0.55" stroke-width="2.6"/>`;
  }

  // Secondary wall for VISE.
  let wall2 = "";
  if (vise) {
    const wp2 = [cx - n[0] * wallDist2, cy - n[1] * wallDist2];
    wall2 = `<line x1="${f(wp2[0] - tangent[0] * 900)}" y1="${f(wp2[1] - tangent[1] * 900)}" x2="${f(wp2[0] + tangent[0] * 900)}" y2="${f(wp2[1] + tangent[1] * 900)}" stroke="${BONE}" stroke-opacity="0.25" stroke-width="1.7"/>`;
  }

  // Echo strata beyond the wall: the liquidated shadow, scaled to the field.
  const strataOffsets = cls.footprint > 0.5 ? [30, 62, 98] : [26, 54];
  const strata = strataOffsets.map((d, i) => {
    const p = [wp[0] + n[0] * d, wp[1] + n[1] * d];
    const reach = 240 + cls.footprint * 520 - i * 110;
    return `<line x1="${f(p[0] - tangent[0] * reach)}" y1="${f(p[1] - tangent[1] * reach)}" x2="${f(p[0] + tangent[0] * reach)}" y2="${f(p[1] + tangent[1] * reach)}" stroke="${ink.base}" stroke-opacity="${(0.09 - i * 0.027).toFixed(3)}" stroke-width="1.3"/>`;
  }).join("\n    ");

  // Mark: winners drift away from the wall, losers hang near it.
  const pnlMag = Math.abs(t.pnl);
  const markDist = win || flat
    ? -maxR * (0.16 + 0.34 * clamp(t.pnl / 300, 0, 1))
    : (wallDist - 26) * (0.35 + 0.6 * clamp(pnlMag / 100, 0, 1));
  const mp = [cx + n[0] * markDist, cy + n[1] * markDist];
  const mark = `
    <circle cx="${f(mp[0])}" cy="${f(mp[1])}" r="6" fill="${BONE}"/>
    <circle cx="${f(mp[0])}" cy="${f(mp[1])}" r="12" fill="none" stroke="${BONE}" stroke-opacity="0.4" stroke-width="1.3"/>`;

  const core = win
    ? `<circle cx="${f(cx)}" cy="${f(cy)}" r="10" fill="${ink.bright}"/>
       <circle cx="${f(cx)}" cy="${f(cy)}" r="19" fill="none" stroke="${ink.base}" stroke-opacity="0.55" stroke-width="1.6"/>`
    : flat
      ? `<circle cx="${f(cx)}" cy="${f(cy)}" r="4.5" fill="${BONE}"/>
       <circle cx="${f(cx)}" cy="${f(cy)}" r="12" fill="none" stroke="${ink.base}" stroke-opacity="0.7" stroke-width="1.8"/>`
      : `<circle cx="${f(cx)}" cy="${f(cy)}" r="10" fill="none" stroke="${ink.base}" stroke-width="2.2"/>`;

  const glowR = maxR * Math.pow(1 / nRings, 0.92) * 3.0;
  const coreGlow = `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(glowR)}" fill="url(#hwa-${sideKey}-core)"/>`;

  // CROWN: a single hairline halo ring outside the field.
  const crownHalo = t.sizeClass === "CROWN"
    ? `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(maxR * 1.06)}" fill="none" stroke="${BONE}" stroke-opacity="0.12" stroke-width="1.2"/>`
    : "";

  return `${coreGlow}
    ${crownHalo}
    ${rings.join("\n    ")}
    ${strata}
    <line x1="${f(wallA[0])}" y1="${f(wallA[1])}" x2="${f(wallB[0])}" y2="${f(wallB[1])}" stroke="${BONE}" stroke-opacity="0.5" stroke-width="2"/>
    ${ticks}
    ${wall2}
    ${contact}
    ${core}
    ${mark}`;
}

function renderSvg(t) {
  const ink = SIDE_INK[t.side];
  const sideKey = t.side === "LONG" ? "L" : "S";
  const pnlText = `${t.pnl >= 0 ? "+" : ""}${t.pnl.toFixed(1)}%`;
  const art = renderArt(t);
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${CANVAS} ${CANVAS}" role="img" aria-labelledby="hwa-${t.displayId}-t">
  <title id="hwa-${t.displayId}-t">HWA Genesis ${t.displayId} — simulated ${t.side.toLowerCase()} pressure field</title>
  <defs>
    <radialGradient id="hwa-${sideKey}-bg" cx="50%" cy="44%" r="78%">
      <stop offset="0" stop-color="#0A2B21"/>
      <stop offset="0.55" stop-color="#061A14"/>
      <stop offset="1" stop-color="#${BG}"/>
    </radialGradient>
    <radialGradient id="hwa-${sideKey}-core" cx="50%" cy="50%" r="50%">
      <stop offset="0" stop-color="${ink.base}" stop-opacity="0.16"/>
      <stop offset="1" stop-color="${ink.base}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${CANVAS}" height="${CANVAS}" fill="url(#hwa-${sideKey}-bg)"/>
  ${GEOM_OPEN}<g>
    ${art}
  </g>${GEOM_CLOSE}
  <g font-family="ui-monospace, 'Cascadia Mono', Menlo, Consolas, monospace" font-size="19" letter-spacing="2.5">
    <text x="72" y="1150" fill="${MIST}" fill-opacity="0.85">HWA ${t.displayId}/333 · ${t.sizeClass}</text>
    <text x="1128" y="1150" text-anchor="end" fill="${ink.base}" fill-opacity="0.62">${t.side} ${t.leverage}X · ${pnlText} · SIM</text>
  </g>
</svg>
`;
}

function geometryFingerprint(svg) {
  const start = svg.indexOf(GEOM_OPEN);
  const end = svg.indexOf(GEOM_CLOSE);
  if (start === -1 || end === -1 || end <= start) throw new Error("Missing geometry markers");
  return sha256(svg.slice(start + GEOM_OPEN.length, end));
}

// ---------------------------------------------------------------------------
// Metadata
// ---------------------------------------------------------------------------

function metadataFor(t, imageUri, imageHash, fingerprint) {
  return {
    name: `HWA Genesis Position #${t.displayId}`,
    description:
      "A pressure field: organic contour rings crushed against a straight liquidation wall. All trading statistics are simulated, all visual traits are cosmetic, and every token represents one equal unit of the 333-token Genesis snapshot.",
    image: imageUri,
    background_color: BG,
    attributes: [
      { trait_type: "Edition", value: "HWA Genesis" },
      { trait_type: "Direction", value: DIRECTION },
      { trait_type: "Size Class", value: t.sizeClass },
      { trait_type: "Class Supply", display_type: "number", value: t.classSupply },
      { trait_type: "Side", value: t.side },
      { trait_type: "Formation", value: t.formation },
      { trait_type: "Wall Proximity", value: t.leverageBand },
      { trait_type: "Leverage", display_type: "number", value: t.leverage },
      { trait_type: "PNL Band", value: t.pnlBand },
      { trait_type: "Simulated PNL", display_type: "number", value: t.pnl },
      { trait_type: "Surface", value: t.surface },
      { trait_type: "Position Size HYPE", display_type: "number", value: t.sizeHype },
      { trait_type: "Renderer", value: RENDERER_VERSION },
      { trait_type: "Snapshot Unit", value: "1 / 333" },
      { trait_type: "Simulated", value: "Yes" },
    ],
    properties: {
      token_id: t.tokenId,
      renderer: RENDERER_VERSION,
      direction: DIRECTION,
      simulated: true,
      equal_snapshot_unit: "1/333",
      simulated_entry: t.entry,
      simulated_mark: t.mark,
      visual_seed: t.visualSeed,
      image_sha256: imageHash,
      geometry_fingerprint_sha256: fingerprint,
    },
  };
}

// ---------------------------------------------------------------------------
// Gallery + contact sheet
// ---------------------------------------------------------------------------

function renderGallery(traits) {
  const cards = traits.map((t) => `
      <article class="p" data-class="${t.sizeClass}" data-side="${t.side}" data-formation="${t.formation}">
        <img src="./images/${t.displayId}.svg" alt="HWA Genesis Position #${t.displayId}" loading="lazy">
        <div><strong>#${t.displayId}</strong><span>${t.sizeClass} · ${t.side} ${t.leverage}X</span></div>
      </article>`).join("");
  const classButtons = Object.keys(CLASSES).map((name) => `<button data-k="class" data-v="${name}">${name}</button>`).join("");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>HWA Genesis v3 — 333 pressure fields</title>
<style>
  :root{color-scheme:dark}
  *{box-sizing:border-box}body{margin:0;background:#030C09;color:#E9F5EF;font-family:ui-monospace,'Cascadia Mono',Menlo,Consolas,monospace}
  header{position:sticky;top:0;z-index:3;padding:18px clamp(16px,4vw,56px);display:flex;gap:18px;align-items:center;justify-content:space-between;flex-wrap:wrap;background:rgba(3,12,9,.92);backdrop-filter:blur(14px);border-bottom:1px solid #0E2A21}
  h1{font-size:clamp(17px,2.6vw,26px);margin:0;letter-spacing:.06em;font-weight:600}
  header p{margin:4px 0 0;color:#547065;font-size:11px;letter-spacing:.14em}
  nav{display:flex;gap:6px;flex-wrap:wrap}
  button{border:1px solid #12352A;background:#04110D;color:#7E9A8F;border-radius:999px;padding:7px 12px;font:11px ui-monospace,monospace;letter-spacing:.08em;cursor:pointer}
  button:hover,button.on{color:#030C09;background:#6FEFC6;border-color:#6FEFC6}
  main{padding:24px clamp(12px,3vw,44px) 64px;display:grid;grid-template-columns:repeat(auto-fill,minmax(215px,1fr));gap:16px}
  main.mini{grid-template-columns:repeat(auto-fill,88px);gap:8px}
  main.mini .p div{display:none}
  .p{margin:0}.p[hidden]{display:none}
  .p img{display:block;width:100%;aspect-ratio:1;border-radius:12px;border:1px solid #0E2A21;background:#04110D}
  .p div{display:flex;justify-content:space-between;gap:8px;padding:8px 2px;color:#547065;font-size:10.5px;letter-spacing:.06em}
  .p strong{color:#C9E8DC;font-weight:600}
  @media(max-width:640px){main{grid-template-columns:repeat(2,1fr);gap:10px;padding-inline:10px}}
</style>
</head>
<body>
  <header>
    <div><h1>HWA GENESIS — 333 PRESSURE FIELDS</h1><p>DETERMINISTIC · UNIQUE · SIMULATED · ${RENDERER_VERSION}</p></div>
    <nav>
      <button class="on" data-k="all" data-v="ALL">ALL</button>${classButtons}
      <button data-k="side" data-v="LONG">LONG</button><button data-k="side" data-v="SHORT">SHORT</button>
      <button data-k="formation" data-v="FIELD">FIELD</button><button data-k="formation" data-v="VENT">VENT</button><button data-k="formation" data-v="VISE">VISE</button>
      <button id="mini">80PX</button>
    </nav>
  </header>
  <main>${cards}</main>
  <script>
    const buttons=[...document.querySelectorAll('button[data-k]')];
    const cards=[...document.querySelectorAll('.p')];
    const state={class:null,side:null,formation:null};
    function apply(){
      for(const c of cards){
        c.hidden=(state.class&&c.dataset.class!==state.class)||(state.side&&c.dataset.side!==state.side)||(state.formation&&c.dataset.formation!==state.formation);
      }
      for(const b of buttons){
        const k=b.dataset.k,v=b.dataset.v;
        b.classList.toggle('on',k==='all'?(!state.class&&!state.side&&!state.formation):state[k]===v);
      }
    }
    for(const b of buttons)b.addEventListener('click',()=>{
      const k=b.dataset.k,v=b.dataset.v;
      if(k==='all'){state.class=state.side=state.formation=null}
      else state[k]=state[k]===v?null:v;
      apply();
    });
    document.getElementById('mini').addEventListener('click',()=>document.querySelector('main').classList.toggle('mini'));
  </script>
</body>
</html>`;
}

function renderContactSheet(traits, imagesById) {
  const used = new Set();
  const findWhere = (fn) => {
    const t = traits.find((x) => !used.has(x.tokenId) && fn(x));
    if (t) used.add(t.tokenId);
    return t;
  };
  const picks = [
    ...Object.keys(CLASSES).map((c) => ({ label: `${c} MASTER`, t: findWhere((x) => x.sizeClass === c) })),
    { label: "LONG WIN", t: findWhere((x) => x.side === "LONG" && x.pnl > 3) },
    { label: "LONG LOSS", t: findWhere((x) => x.side === "LONG" && x.pnl < -3) },
    { label: "SHORT WIN", t: findWhere((x) => x.side === "SHORT" && x.pnl > 3) },
    { label: "SHORT LOSS", t: findWhere((x) => x.side === "SHORT" && x.pnl < -3) },
    { label: "VISE", t: findWhere((x) => x.formation === "VISE") },
    { label: "VENT", t: findWhere((x) => x.formation === "VENT") },
    { label: "TERMINAL 50X", t: findWhere((x) => x.leverage === 50) },
    { label: "FLAT", t: findWhere((x) => x.pnlBand === "FLAT") },
    { label: "OUTLIER", t: findWhere((x) => x.pnlBand === "OUTLIER") },
    { label: "STORM", t: findWhere((x) => x.surface === "STORM") },
  ].filter((p) => p.t);
  const cell = 380;
  const gap = 22;
  const cols = 5;
  const rows = Math.ceil(picks.length / cols);
  const width = 40 * 2 + cols * cell + (cols - 1) * gap;
  const height = 110 + rows * (cell + 64) + 20;
  const cells = picks.map((p, i) => {
    const x = 40 + (i % cols) * (cell + gap);
    const y = 110 + Math.floor(i / cols) * (cell + 64);
    const b64 = Buffer.from(imagesById.get(p.t.tokenId)).toString("base64");
    return `<image x="${x}" y="${y}" width="${cell}" height="${cell}" href="data:image/svg+xml;base64,${b64}"/>
  <text x="${x + cell / 2}" y="${y + cell + 28}" text-anchor="middle" fill="#78938A" font-family="monospace" font-size="15" letter-spacing="2">${p.label} · #${p.t.displayId}</text>`;
  }).join("\n  ");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
  <rect width="${width}" height="${height}" fill="#030C09"/>
  <text x="40" y="52" fill="#E9F5EF" font-family="monospace" font-size="30" letter-spacing="4">HWA GENESIS V3 · ${DIRECTION} · SIM</text>
  <text x="40" y="82" fill="#547065" font-family="monospace" font-size="15" letter-spacing="3">333 UNIQUE PRESSURE FIELDS · ${RENDERER_VERSION}</text>
  ${cells}
</svg>`;
}

// ---------------------------------------------------------------------------
// Generate + verify
// ---------------------------------------------------------------------------

function assertEmptyOrMissing(outputPath) {
  if (!existsSync(outputPath)) return;
  if (!statSync(outputPath).isDirectory()) throw new Error(`Output exists and is not a directory: ${outputPath}`);
  if (readdirSync(outputPath).length !== 0) throw new Error(`Refusing to overwrite non-empty output: ${outputPath}`);
}

function countBy(traits, key) {
  const counts = {};
  for (const t of traits) counts[t[key]] = (counts[t[key]] ?? 0) + 1;
  return counts;
}

function forbiddenScan(svg, fileName) {
  if (/Hyperliquid|TokenWorks|referral/i.test(svg)) throw new Error(`Forbidden brand term in ${fileName}`);
  // The W3C namespace declaration is the only URL allowed in a canonical asset.
  const withoutNamespace = svg.replaceAll('xmlns="http://www.w3.org/2000/svg"', "");
  if (/https?:/i.test(withoutNamespace)) throw new Error(`External URL in ${fileName}`);
  if (/url\((?!#)/.test(withoutNamespace)) throw new Error(`External url() reference in ${fileName}`);
  if (/@font-face|@import/i.test(withoutNamespace)) throw new Error(`External font in ${fileName}`);
}

function verifyOutput(outputPath) {
  const manifestPath = join(outputPath, "manifest.json");
  const traitsPath = join(outputPath, "traits.json");
  if (!existsSync(manifestPath) || !existsSync(traitsPath)) throw new Error("Missing manifest.json or traits.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const traits = JSON.parse(readFileSync(traitsPath, "utf8"));
  if (manifest.supply !== SUPPLY || traits.length !== SUPPLY) throw new Error("Supply mismatch");

  const imageFiles = readdirSync(join(outputPath, "images")).filter((n) => n.endsWith(".svg"));
  const metadataFiles = readdirSync(join(outputPath, "metadata")).filter((n) => n.endsWith(".json"));
  if (imageFiles.length !== SUPPLY || metadataFiles.length !== SUPPLY) throw new Error("Asset file count mismatch");

  const imageHashes = new Set();
  const fingerprints = new Set();
  const visualSeeds = new Set();
  const ids = new Set();
  for (const t of traits) {
    if (ids.has(t.tokenId)) throw new Error(`Duplicate token ID ${t.tokenId}`);
    ids.add(t.tokenId);
    if (visualSeeds.has(t.visualSeed)) throw new Error(`Duplicate visual seed ${t.visualSeed}`);
    visualSeeds.add(t.visualSeed);

    // Displayed-data coherence: side, leverage and pnl are printed on the card;
    // entry/mark live in metadata and must satisfy mark = entry * (1 + dir*pnl/(100*lev)).
    const dir = t.side === "LONG" ? 1 : -1;
    const expectedMark = t.entry * (1 + (dir * t.pnl) / (100 * t.leverage));
    // Stored values are rounded to 8 decimals; allow that quantization.
    if (Math.abs(expectedMark - t.mark) > 5e-8 + t.entry * 1e-6) throw new Error(`Entry/mark incoherent for token ${t.tokenId}`);
    if (!LEVERAGE_BANDS[t.leverageBand].values.includes(t.leverage)) throw new Error(`Leverage outside band for token ${t.tokenId}`);
    if (pnlBand(t.pnl) !== t.pnlBand) throw new Error(`PNL band mismatch for token ${t.tokenId}`);
    if (surfaceTier(t.volatility) !== t.surface) throw new Error(`Surface mismatch for token ${t.tokenId}`);

    const fileName = `${pad3(t.tokenId)}.svg`;
    const svg = readFileSync(join(outputPath, "images", fileName), "utf8");
    forbiddenScan(svg, fileName);
    const imageHash = sha256(svg);
    if (imageHashes.has(imageHash)) throw new Error(`Duplicate rendered SVG hash at ${fileName}`);
    imageHashes.add(imageHash);
    const fingerprint = geometryFingerprint(svg);
    if (fingerprints.has(fingerprint)) throw new Error(`Duplicate geometry fingerprint at ${fileName}`);
    fingerprints.add(fingerprint);

    const metadata = JSON.parse(readFileSync(join(outputPath, "metadata", `${pad3(t.tokenId)}.json`), "utf8"));
    if (metadata.properties.token_id !== t.tokenId) throw new Error(`Metadata token mismatch for ${t.tokenId}`);
    if (metadata.properties.image_sha256 !== imageHash) throw new Error(`Metadata image hash mismatch for ${t.tokenId}`);
    if (metadata.properties.geometry_fingerprint_sha256 !== fingerprint) throw new Error(`Metadata fingerprint mismatch for ${t.tokenId}`);
    const entry = manifest.files.find((e) => e.tokenId === t.tokenId);
    if (!entry || entry.imageSha256 !== imageHash || entry.geometryFingerprint !== fingerprint) {
      throw new Error(`Manifest hash mismatch for token ${t.tokenId}`);
    }
    if (entry.metadataSha256 !== sha256File(join(outputPath, "metadata", `${pad3(t.tokenId)}.json`))) {
      throw new Error(`Manifest metadata hash mismatch for token ${t.tokenId}`);
    }
  }
  for (let id = 1; id <= SUPPLY; id += 1) if (!ids.has(id)) throw new Error(`Missing token ID ${id}`);

  const assertCounts = (actual, expected, label) => {
    for (const [name, cfg] of Object.entries(expected)) {
      const want = typeof cfg === "number" ? cfg : cfg.count;
      if ((actual[name] ?? 0) !== want) throw new Error(`${label} ${name} count mismatch: ${actual[name] ?? 0} != ${want}`);
    }
  };
  assertCounts(countBy(traits, "sizeClass"), CLASSES, "class");
  assertCounts(countBy(traits, "side"), SIDES, "side");
  assertCounts(countBy(traits, "formation"), FORMATIONS, "formation");
  assertCounts(countBy(traits, "leverageBand"), LEVERAGE_BANDS, "leverage band");
  assertCounts(countBy(traits, "sizeClass"), manifest.exactCounts.classes, "manifest class");
  assertCounts(countBy(traits, "side"), manifest.exactCounts.sides, "manifest side");
  assertCounts(countBy(traits, "formation"), manifest.exactCounts.formations, "manifest formation");
  assertCounts(countBy(traits, "leverageBand"), manifest.exactCounts.leverageBands, "manifest leverage band");
  assertCounts(countBy(traits, "pnlBand"), manifest.exactCounts.pnlBands, "manifest pnl band");
  assertCounts(countBy(traits, "surface"), manifest.exactCounts.surfaces, "manifest surface");

  if (imageHashes.size !== SUPPLY || fingerprints.size !== SUPPLY || visualSeeds.size !== SUPPLY) {
    throw new Error("Uniqueness invariant failed");
  }
  const aggregate = sha256(manifest.files.map((e) => `${e.tokenId}:${e.imageSha256}:${e.metadataSha256}:${e.geometryFingerprint}`).join("\n"));
  if (aggregate !== manifest.aggregateSha256) throw new Error("Aggregate manifest hash mismatch");
  return {
    imageCount: imageHashes.size,
    fingerprintCount: fingerprints.size,
    metadataCount: metadataFiles.length,
    counts: manifest.exactCounts,
    aggregate,
  };
}

function generate(outputPath, imageBaseUri, force) {
  if (force && existsSync(outputPath)) rmSync(outputPath, { recursive: true, force: true });
  assertEmptyOrMissing(outputPath);
  mkdirSync(join(outputPath, "images"), { recursive: true });
  mkdirSync(join(outputPath, "metadata"), { recursive: true });

  const classOf = assignExact("HWA_GENESIS_V3_CLASS", CLASSES);
  const sideOf = assignExact("HWA_GENESIS_V3_SIDE", SIDES);
  const formationOf = assignExact("HWA_GENESIS_V3_FORMATION", FORMATIONS);
  const levBandOf = assignExact("HWA_GENESIS_V3_LEV", LEVERAGE_BANDS);

  const traits = Array.from({ length: SUPPLY }, (_, i) => {
    const id = i + 1;
    return buildTraits(id, classOf.get(id), sideOf.get(id), formationOf.get(id), levBandOf.get(id));
  });

  const imagesById = new Map();
  const fileEntries = [];
  for (const t of traits) {
    const svg = renderSvg(t);
    const imageName = `${t.displayId}.svg`;
    writeFileSync(join(outputPath, "images", imageName), svg, "utf8");
    imagesById.set(t.tokenId, svg);
    const imageHash = sha256(svg);
    const fingerprint = geometryFingerprint(svg);
    t.geometryFingerprint = fingerprint;
    const metadata = metadataFor(t, `${imageBaseUri}${imageName}`, imageHash, fingerprint);
    const metadataJson = `${JSON.stringify(metadata, null, 2)}\n`;
    writeFileSync(join(outputPath, "metadata", `${t.displayId}.json`), metadataJson, "utf8");
    fileEntries.push({
      tokenId: t.tokenId,
      image: `images/${imageName}`,
      imageSha256: imageHash,
      geometryFingerprint: fingerprint,
      metadata: `metadata/${t.displayId}.json`,
      metadataSha256: sha256(metadataJson),
    });
  }

  writeFileSync(join(outputPath, "traits.json"), `${JSON.stringify(traits, null, 2)}\n`, "utf8");
  writeFileSync(join(outputPath, "gallery.html"), renderGallery(traits), "utf8");
  writeFileSync(join(outputPath, "contact-sheet.svg"), renderContactSheet(traits, imagesById), "utf8");

  const manifest = {
    schemaVersion: 2,
    collection: "Hyper World Assets Genesis",
    symbol: "HWAG",
    direction: DIRECTION,
    rendererVersion: RENDERER_VERSION,
    supply: SUPPLY,
    deterministicScheme: "SHA-256 scoped seeds derived from token ID; no runtime randomness",
    simulatedTradingData: true,
    equalEconomicUnits: true,
    imageBaseUri,
    exactCounts: {
      classes: Object.fromEntries(Object.entries(CLASSES).map(([k, v]) => [k, v.count])),
      sides: Object.fromEntries(Object.entries(SIDES).map(([k, v]) => [k, v.count])),
      formations: Object.fromEntries(Object.entries(FORMATIONS).map(([k, v]) => [k, v.count])),
      leverageBands: Object.fromEntries(Object.entries(LEVERAGE_BANDS).map(([k, v]) => [k, v.count])),
      pnlBands: countBy(traits, "pnlBand"),
      surfaces: countBy(traits, "surface"),
    },
    classMasterIds: Object.fromEntries(
      Object.keys(CLASSES).map((name) => [name, traits.find((t) => t.sizeClass === name).tokenId]),
    ),
    traitsSha256: sha256File(join(outputPath, "traits.json")),
    gallerySha256: sha256File(join(outputPath, "gallery.html")),
    contactSheetSha256: sha256File(join(outputPath, "contact-sheet.svg")),
    files: fileEntries,
    aggregateSha256: sha256(
      fileEntries.map((e) => `${e.tokenId}:${e.imageSha256}:${e.metadataSha256}:${e.geometryFingerprint}`).join("\n"),
    ),
  };
  writeFileSync(join(outputPath, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return verifyOutput(outputPath);
}

const args = parseArgs(process.argv.slice(2));
const outputPath = resolveSafeOutput(args.output);
const result = args.verifyOnly ? verifyOutput(outputPath) : generate(outputPath, args.imageBaseUri, args.force);
process.stdout.write(
  `${args.verifyOnly ? "Verified" : "Generated and verified"} ${result.imageCount} unique SVGs, ` +
    `${result.fingerprintCount} unique geometry fingerprints, ${result.metadataCount} metadata files.\n` +
    `Classes: ${Object.entries(result.counts.classes).map(([k, v]) => `${k}=${v}`).join(", ")}\n` +
    `Sides: ${Object.entries(result.counts.sides).map(([k, v]) => `${k}=${v}`).join(", ")} · ` +
    `Formations: ${Object.entries(result.counts.formations).map(([k, v]) => `${k}=${v}`).join(", ")}\n` +
    `Aggregate SHA-256: ${result.aggregate}\n` +
    `Output: ${outputPath}\n`,
);
