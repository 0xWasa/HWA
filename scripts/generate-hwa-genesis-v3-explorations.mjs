#!/usr/bin/env node
// HWA Genesis v3 — PHASE 1 exploration renderer.
// Three artistic directions, rendered from the SAME 8 archetype specimens so the
// directions can be compared like-for-like. Deterministic: SHA-256 seeded, no
// runtime randomness, no external assets, no remote fonts.
//
// Direction A — PRESSURE FIELD   organic contour rings crushed against a liquidation wall
// Direction B — POSITION MASS    one liquid mass: buoyancy = pnl, drip = leverage pull
// Direction C — MARKET SIGIL     one continuous conviction glyph on a hidden polar grid
//
// Output: frontend/public/genesis/v3-explorations/  (does not touch v1/v2)

import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(SCRIPT_DIR, "..");
const OUT = resolve(PROJECT_ROOT, "frontend/public/genesis/v3-explorations");
const CANVAS = 1200;

// ---------------------------------------------------------------------------
// Deterministic RNG (same construction as the v2 renderer)
// ---------------------------------------------------------------------------

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
const f = (x) => (Math.round(x * 100) / 100).toString();
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const TAU = Math.PI * 2;

function softplus(x) {
  if (x > 30) return x;
  if (x < -30) return 0;
  return Math.log1p(Math.exp(x));
}

// ---------------------------------------------------------------------------
// Shared HWA identity
// ---------------------------------------------------------------------------

const SIDE_INK = {
  LONG: {
    base: "#6FEFC6", bright: "#D9FFF1", dim: "#2E6B58", deep: "#0E3327",
    gradTop: "#BFFFE7", gradBottom: "#2FBE92", hollow: "#082019",
  },
  SHORT: {
    base: "#FF7E9B", bright: "#FFD9E2", dim: "#753247", deep: "#351522",
    gradTop: "#FFC9D7", gradBottom: "#E85579", hollow: "#230F17",
  },
};

const BONE = "#E9F5EF";
const MIST = "#7E9A8F";

const CLASSES = {
  SCALP:    { footprint: 0.37, rings: 5 },
  SIZE:     { footprint: 0.47, rings: 6 },
  WHALE:    { footprint: 0.60, rings: 8 },
  COLOSSAL: { footprint: 0.76, rings: 10 },
  CROWN:    { footprint: 0.94, rings: 13 },
};

// The 8 shared archetype specimens (cover both sides, win/loss on both sides,
// every size class, low → max leverage, calm → max volatility).
const SPECIMENS = [
  { id: 12,  cls: "SCALP",    side: "LONG",  lev: 3,  pnl: 18.4,   vol: 0.25 },
  { id: 77,  cls: "SCALP",    side: "SHORT", lev: 8,  pnl: -34.2,  vol: 0.45 },
  { id: 104, cls: "SIZE",     side: "LONG",  lev: 20, pnl: 127.6,  vol: 0.60 },
  { id: 156, cls: "SIZE",     side: "SHORT", lev: 5,  pnl: 42.9,   vol: 0.35 },
  { id: 208, cls: "WHALE",    side: "LONG",  lev: 12, pnl: -61.8,  vol: 0.70 },
  { id: 251, cls: "WHALE",    side: "SHORT", lev: 25, pnl: 210.5,  vol: 0.55 },
  { id: 300, cls: "COLOSSAL", side: "LONG",  lev: 40, pnl: 388.0,  vol: 0.85 },
  { id: 333, cls: "CROWN",    side: "SHORT", lev: 50, pnl: -93.4,  vol: 1.00 },
];

const pad3 = (n) => String(n).padStart(3, "0");

function caption(spec) {
  const ink = SIDE_INK[spec.side];
  const pnlText = `${spec.pnl >= 0 ? "+" : ""}${spec.pnl.toFixed(1)}%`;
  return `
  <g font-family="ui-monospace, 'Cascadia Mono', Menlo, Consolas, monospace" font-size="19" letter-spacing="2.5">
    <text x="72" y="1150" fill="${MIST}" fill-opacity="0.85">HWA ${pad3(spec.id)}/333 · ${spec.cls}</text>
    <text x="1128" y="1150" text-anchor="end" fill="${ink.base}" fill-opacity="0.62">${spec.side} ${spec.lev}X · ${pnlText} · SIM</text>
  </g>`;
}

function shell(spec, uid, artBody) {
  const ink = SIDE_INK[spec.side];
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${CANVAS} ${CANVAS}" role="img" aria-labelledby="${uid}-t">
  <title id="${uid}-t">HWA Genesis ${pad3(spec.id)} — simulated ${spec.side.toLowerCase()} position</title>
  <defs>
    <radialGradient id="${uid}-bg" cx="50%" cy="44%" r="78%">
      <stop offset="0" stop-color="#0A2B21"/>
      <stop offset="0.55" stop-color="#061A14"/>
      <stop offset="1" stop-color="#030C09"/>
    </radialGradient>
    <linearGradient id="${uid}-mass" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${ink.gradTop}"/>
      <stop offset="1" stop-color="${ink.gradBottom}"/>
    </linearGradient>
    <radialGradient id="${uid}-core" cx="50%" cy="50%" r="50%">
      <stop offset="0" stop-color="${ink.base}" stop-opacity="0.16"/>
      <stop offset="1" stop-color="${ink.base}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${CANVAS}" height="${CANVAS}" fill="url(#${uid}-bg)"/>
  ${artBody}
  ${caption(spec)}
</svg>
`;
}

// Catmull-Rom closed loop → smooth cubic Bézier path
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

// ---------------------------------------------------------------------------
// Direction A — PRESSURE FIELD (liquidation topography)
// ---------------------------------------------------------------------------

function renderPressureField(spec) {
  const rng = rngFor(`HWA_V3A:${spec.id}`);
  const ink = SIDE_INK[spec.side];
  const cfg = CLASSES[spec.cls];
  const levNorm = clamp(spec.lev / 50, 0, 1);
  const win = spec.pnl >= 0;

  const maxR = cfg.footprint * 520;
  const tilt = between(rng, -0.10, 0.10);
  // Wall normal: LONG liquidates below (wall under the mass), SHORT above.
  const nSign = spec.side === "LONG" ? 1 : -1;
  const n = [Math.sin(tilt) * nSign, Math.cos(tilt) * nSign];
  const tangent = [Math.cos(tilt), -Math.sin(tilt)];
  const wallDist = maxR * (1.02 - 0.68 * levNorm);

  // Composition: balance the whole system (field + wall) around the canvas center.
  const shift = (maxR - wallDist) * 0.5;
  const cx = 600 + n[0] * shift + between(rng, -22, 22);
  const cy = 600 + n[1] * shift;

  const amp = 0.035 + 0.085 * spec.vol;
  const f1 = 2 + Math.floor(rng() * 2);
  const f2 = 4 + Math.floor(rng() * 2);
  const f3 = 6 + Math.floor(rng() * 4);
  const ph1 = rng() * TAU;
  const ph2 = rng() * TAU;
  const ph3 = rng() * TAU;

  const nRings = cfg.rings;
  const N = 168;
  const k = maxR * 0.055;
  const rings = [];
  let contactMin = Infinity;
  let contactMax = -Infinity;

  for (let ri = 0; ri < nRings; ri += 1) {
    const t = (ri + 1) / nRings;
    const baseR = maxR * Math.pow(t, 0.92);
    const gap = 16 + (nRings - 1 - ri) * 11;
    const limit = wallDist - gap;
    const pts = [];
    for (let i = 0; i < N; i += 1) {
      const th = (i / N) * TAU;
      const wob = 1 + amp * (0.35 + 0.65 * t) *
        (Math.sin(f1 * th + ph1) + 0.55 * Math.sin(f2 * th + ph2) + 0.30 * Math.sin(f3 * th + ph3));
      const r = baseR * wob;
      let p = [r * Math.cos(th), r * Math.sin(th)];
      const d0 = p[0] * n[0] + p[1] * n[1];
      const dNew = d0 - k * softplus((d0 - limit) / k);
      p = [p[0] + n[0] * (dNew - d0), p[1] + n[1] * (dNew - d0)];
      if (ri === nRings - 1 && d0 > limit + 2) {
        const proj = p[0] * tangent[0] + p[1] * tangent[1];
        if (proj < contactMin) contactMin = proj;
        if (proj > contactMax) contactMax = proj;
      }
      pts.push([cx + p[0], cy + p[1]]);
    }
    const tt = 1 - t;
    const width = 1.4 + tt * 1.5;
    const baseOpacity = 0.34 + tt * 0.56;
    const opacity = win ? baseOpacity : baseOpacity * 0.8;
    const dashed = !win && ri >= nRings - 2 ? ` stroke-dasharray="6 10"` : "";
    const stroke = ri <= 1 ? ink.bright : ink.base;
    rings.push(
      `<path d="${smoothClosedPath(pts)}" fill="none" stroke="${stroke}" stroke-opacity="${opacity.toFixed(2)}" stroke-width="${width.toFixed(2)}"${dashed}/>`,
    );
  }

  // The liquidation wall: a quiet, absolute line with small price ticks.
  const wp = [cx + n[0] * wallDist, cy + n[1] * wallDist];
  const wallA = [wp[0] - tangent[0] * 760, wp[1] - tangent[1] * 760];
  const wallB = [wp[0] + tangent[0] * 760, wp[1] + tangent[1] * 760];
  const ticks = Array.from({ length: 15 }, (_, i) => {
    const s = -700 + (i / 14) * 1400;
    const bx = wp[0] + tangent[0] * s;
    const by = wp[1] + tangent[1] * s;
    return `<line x1="${f(bx)}" y1="${f(by)}" x2="${f(bx + n[0] * 9)}" y2="${f(by + n[1] * 9)}" stroke="${BONE}" stroke-opacity="0.22" stroke-width="1.4"/>`;
  }).join("");

  let contact = "";
  if (contactMax > contactMin) {
    const pad = 26;
    const a = [wp[0] + tangent[0] * (contactMin - pad), wp[1] + tangent[1] * (contactMin - pad)];
    const b = [wp[0] + tangent[0] * (contactMax + pad), wp[1] + tangent[1] * (contactMax + pad)];
    contact = `<line x1="${f(a[0])}" y1="${f(a[1])}" x2="${f(b[0])}" y2="${f(b[1])}" stroke="${ink.bright}" stroke-opacity="0.55" stroke-width="2.6"/>`;
  }

  // Mark: winners drift away from the wall, losers hang near it.
  const pnlMag = Math.abs(spec.pnl);
  const markDist = win
    ? -maxR * (0.16 + 0.34 * clamp(spec.pnl / 300, 0, 1))
    : (wallDist - 26) * (0.35 + 0.6 * clamp(pnlMag / 100, 0, 1));
  const mp = [cx + n[0] * markDist, cy + n[1] * markDist];
  const mark = `
    <circle cx="${f(mp[0])}" cy="${f(mp[1])}" r="6" fill="${BONE}"/>
    <circle cx="${f(mp[0])}" cy="${f(mp[1])}" r="12" fill="none" stroke="${BONE}" stroke-opacity="0.4" stroke-width="1.3"/>`;

  const core = win
    ? `<circle cx="${f(cx)}" cy="${f(cy)}" r="10" fill="${ink.bright}"/>
       <circle cx="${f(cx)}" cy="${f(cy)}" r="19" fill="none" stroke="${ink.base}" stroke-opacity="0.55" stroke-width="1.6"/>`
    : `<circle cx="${f(cx)}" cy="${f(cy)}" r="10" fill="none" stroke="${ink.base}" stroke-width="2.2"/>`;

  const uid = `a${pad3(spec.id)}`;
  const glowR = maxR * Math.pow(1 / nRings, 0.92) * 2.6;
  const coreGlow = `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(glowR)}" fill="url(#${uid}-core)"/>`;

  // Quiet echo strata beyond the wall: the liquidated shadow.
  const strata = [30, 62, 98].map((d, i) => {
    const p = [wp[0] + n[0] * d, wp[1] + n[1] * d];
    const reach = 720 - i * 120;
    return `<line x1="${f(p[0] - tangent[0] * reach)}" y1="${f(p[1] - tangent[1] * reach)}" x2="${f(p[0] + tangent[0] * reach)}" y2="${f(p[1] + tangent[1] * reach)}" stroke="${ink.base}" stroke-opacity="${(0.09 - i * 0.027).toFixed(3)}" stroke-width="1.3"/>`;
  }).join("\n    ");

  return `
  <g>
    ${coreGlow}
    ${rings.join("\n    ")}
    ${strata}
    <line x1="${f(wallA[0])}" y1="${f(wallA[1])}" x2="${f(wallB[0])}" y2="${f(wallB[1])}" stroke="${BONE}" stroke-opacity="0.5" stroke-width="2"/>
    ${ticks}
    ${contact}
    ${core}
    ${mark}
  </g>`;
}

// ---------------------------------------------------------------------------
// Direction B — POSITION MASS (the HWA drop)
// ---------------------------------------------------------------------------

function renderPositionMass(spec) {
  const rng = rngFor(`HWA_V3B:${spec.id}`);
  const ink = SIDE_INK[spec.side];
  const cfg = CLASSES[spec.cls];
  const levNorm = clamp(spec.lev / 50, 0, 1);
  const win = spec.pnl >= 0;
  const uid = `b${pad3(spec.id)}`;

  const R = 60 + cfg.footprint * 262;
  const waterY = 600 + between(rng, -12, 12);
  const cx = 600 + between(rng, -26, 26);

  // Buoyancy: winners float above the entry waterline, losers sink below.
  const buoy = (0.14 + 0.48 * clamp(Math.abs(spec.pnl) / 260, 0, 1)) * R * (win ? 1 : -1);
  // Drip: LONG is pulled down toward liquidation, SHORT is pulled up.
  const dir = spec.side === "LONG" ? 1 : -1;
  const dripTilt = between(rng, -0.16, 0.16);
  const dv = [Math.sin(dripTilt), Math.cos(dripTilt) * dir];

  // Stretch amplitude grows with leverage; frame budget caps it.
  const split = spec.lev >= 44;
  let A = R * (0.12 + 1.05 * levNorm) * (split ? 0.42 : 1);
  A = Math.min(A, 900 - 2 * R);
  const w = 0.62 - 0.38 * levNorm;

  let cyRaw = waterY - buoy;
  const lo = dir > 0 ? 128 + R : 128 + R + A;
  const hi = dir > 0 ? 1046 - R - A : 1046 - R;
  const cy = clamp(cyRaw, Math.min(lo, hi), Math.max(lo, hi));

  const dripAngle = Math.atan2(dv[1], dv[0]);
  const rippleAmp = 0.012 + 0.02 * spec.vol;
  const ph1 = rng() * TAU;
  const ph2 = rng() * TAU;

  const N = 176;
  const outline = [];
  const rim = [];
  // Difference-of-gaussians: a narrow spike with a concave waist around it,
  // so high leverage reads as a real drip about to detach, not a fat pear.
  const waist = 0.30;
  const spike = (A / R) / (1 - waist);
  for (let i = 0; i < N; i += 1) {
    const th = (i / N) * TAU;
    let dth = Math.abs(th - dripAngle);
    if (dth > Math.PI) dth = TAU - dth;
    const bump = spike * (Math.exp(-((dth / w) ** 2)) - waist * Math.exp(-((dth / (2.3 * w)) ** 2)));
    const back = -0.05 * (A / R) * Math.exp(-(((Math.PI - dth) / 0.9) ** 2));
    const ripple = rippleAmp * (0.6 * Math.sin(3 * th + ph1) + 0.4 * Math.sin(5 * th + ph2));
    const r = R * (1 + bump + back + ripple);
    outline.push([cx + r * Math.cos(th), cy + r * Math.sin(th)]);
    rim.push([cx + r * 0.9 * Math.cos(th), cy + r * 0.9 * Math.sin(th)]);
  }
  const outlinePath = smoothClosedPath(outline);

  const massPaint = win
    ? `<path d="${outlinePath}" fill="url(#${uid}-mass)"/>
       <ellipse cx="${f(cx - R * 0.28)}" cy="${f(cy - R * 0.36)}" rx="${f(R * 0.24)}" ry="${f(R * 0.11)}" transform="rotate(-27 ${f(cx - R * 0.28)} ${f(cy - R * 0.36)})" fill="#FFFFFF" fill-opacity="0.10"/>`
    : `<path d="${outlinePath}" fill="${ink.hollow}" stroke="${ink.base}" stroke-width="2.7"/>
       <path d="${smoothClosedPath(rim)}" fill="none" stroke="${ink.dim}" stroke-opacity="0.8" stroke-width="1.2"/>`;

  // Entry waterline with a clean gap where the mass crosses it.
  let waterline;
  const dy = waterY - cy;
  if (Math.abs(dy) < R * 0.98) {
    const half = Math.sqrt(Math.max(0, R * R - dy * dy)) * 1.05 + 16;
    waterline = `
    <line x1="64" y1="${f(waterY)}" x2="${f(cx - half)}" y2="${f(waterY)}" stroke="${BONE}" stroke-opacity="0.34" stroke-width="1.6"/>
    <line x1="${f(cx + half)}" y1="${f(waterY)}" x2="1136" y2="${f(waterY)}" stroke="${BONE}" stroke-opacity="0.34" stroke-width="1.6"/>`;
  } else {
    waterline = `<line x1="64" y1="${f(waterY)}" x2="1136" y2="${f(waterY)}" stroke="${BONE}" stroke-opacity="0.34" stroke-width="1.6"/>`;
  }
  waterline += `
    <line x1="64" y1="${f(waterY - 7)}" x2="64" y2="${f(waterY + 7)}" stroke="${BONE}" stroke-opacity="0.34" stroke-width="1.6"/>
    <line x1="1136" y1="${f(waterY - 7)}" x2="1136" y2="${f(waterY + 7)}" stroke="${BONE}" stroke-opacity="0.34" stroke-width="1.6"/>`;

  // Where the mass pierces its entry line, the water climbs it: small menisci.
  let ripples = "";
  if (Math.abs(dy) < R * 0.96) {
    const half = Math.sqrt(Math.max(0, R * R - dy * dy)) * 1.05 + 16;
    const mL = cx - half;
    const mR = cx + half;
    ripples = `
    <path d="M ${f(mL - 46)} ${f(waterY)} Q ${f(mL - 8)} ${f(waterY)} ${f(mL + 2)} ${f(waterY - 15)}" fill="none" stroke="${ink.base}" stroke-opacity="0.5" stroke-width="1.6"/>
    <path d="M ${f(mR + 46)} ${f(waterY)} Q ${f(mR + 8)} ${f(waterY)} ${f(mR - 2)} ${f(waterY - 15)}" fill="none" stroke="${ink.base}" stroke-opacity="0.5" stroke-width="1.6"/>`;
  } else {
    // Fully risen or sunk: two quiet ripple dashes where the drip axis crosses the line.
    const ax = cx + dv[0] * ((waterY - cy) / (dv[1] || 1));
    ripples = `
    <line x1="${f(ax - 34)}" y1="${f(waterY)}" x2="${f(ax + 34)}" y2="${f(waterY)}" stroke="${ink.base}" stroke-opacity="0.22" stroke-width="2.2" stroke-linecap="round"/>
    <line x1="${f(ax - 16)}" y1="${f(waterY + (cy > waterY ? 10 : -10))}" x2="${f(ax + 16)}" y2="${f(waterY + (cy > waterY ? 10 : -10))}" stroke="${ink.base}" stroke-opacity="0.12" stroke-width="2" stroke-linecap="round"/>`;
  }

  // Liquidation marker past the drip tip; a dotted pull-line connects them.
  const tip = R + A;
  const markerDist = Math.max(tip * 1.14, R + A * 1.18 + R * (1.5 - 1.38 * levNorm));
  const mx = cx + dv[0] * markerDist;
  const my = cy + dv[1] * markerDist;
  const sx = cx + dv[0] * (tip + 8);
  const sy = cy + dv[1] * (tip + 8);
  const liq = `
    <line x1="${f(sx)}" y1="${f(sy)}" x2="${f(mx - dv[0] * 16)}" y2="${f(my - dv[1] * 16)}" stroke="${ink.dim}" stroke-opacity="0.55" stroke-width="1.5" stroke-dasharray="1 8" stroke-linecap="round"/>
    <circle cx="${f(mx)}" cy="${f(my)}" r="8" fill="none" stroke="${MIST}" stroke-opacity="0.8" stroke-width="1.6"/>`;

  // Split state (extreme leverage): a shed satellite droplet mid-flight.
  let satellite = "";
  if (split) {
    const sr = R * 0.15;
    const sd = markerDist * 0.72;
    const scx = cx + dv[0] * sd;
    const scy = cy + dv[1] * sd;
    const satPaint = win ? `fill="url(#${uid}-mass)"` : `fill="${ink.hollow}" stroke="${ink.base}" stroke-width="2"`;
    satellite = `
    <circle cx="${f(scx)}" cy="${f(scy)}" r="${f(sr)}" ${satPaint}/>
    <circle cx="${f(cx + dv[0] * (tip + (sd - tip) * 0.35))}" cy="${f(cy + dv[1] * (tip + (sd - tip) * 0.35))}" r="5.5" fill="${ink.base}" fill-opacity="0.85"/>
    <circle cx="${f(cx + dv[0] * (tip + (sd - tip) * 0.62))}" cy="${f(cy + dv[1] * (tip + (sd - tip) * 0.62))}" r="3.2" fill="${ink.base}" fill-opacity="0.6"/>`;
  }

  return `
  <g>
    ${ripples}
    ${waterline}
    ${liq}
    ${massPaint}
    ${satellite}
  </g>`;
}

// ---------------------------------------------------------------------------
// Direction C — MARKET SIGIL (conviction glyph)
// ---------------------------------------------------------------------------

function renderMarketSigil(spec) {
  const ink = SIDE_INK[spec.side];
  const cfg = CLASSES[spec.cls];
  const levNorm = clamp(spec.lev / 50, 0, 1);
  const win = spec.pnl >= 0;

  const cx = 600;
  const cy = 585;
  const sigilR = 70 + cfg.footprint * 375;
  const r1 = sigilR * 0.52;
  const r2 = sigilR;
  const strokeW = 9 + cfg.footprint * 16;
  const segCount = 3 + Math.round(levNorm * 5);

  const nodeAngle = (ai) => (ai * TAU) / 12;
  const nodePos = (ring, ai) => {
    const R = ring === 1 ? r1 : r2;
    const th = nodeAngle(ai);
    return [cx + R * Math.cos(th), cy + R * Math.sin(th)];
  };

  // Sample a segment densely enough for exact bounding-box work.
  const sampleSeg = (sg) => {
    const a = nodePos(sg.from.ring, sg.from.ai);
    const b = nodePos(sg.to.ring, sg.to.ai);
    if (sg.op !== "ARC") return [a, b];
    const R = sg.from.ring === 1 ? r1 : r2;
    const th0 = nodeAngle(sg.from.ai);
    const th1 = nodeAngle(sg.to.ai);
    return Array.from({ length: 13 }, (_, i) => {
      const th = th0 + ((th1 - th0) * i) / 12;
      return [cx + R * Math.cos(th), cy + R * Math.sin(th)];
    });
  };

  // Seeded walk on the polar grid. LONG sigils ascend, SHORT sigils descend.
  const wantAscend = spec.side === "LONG";
  let solution = null;
  for (let attempt = 0; attempt < 900 && !solution; attempt += 1) {
    const rng = rngFor(`HWA_V3C:${spec.id}:${attempt}`);
    const startChoices = wantAscend ? [2, 3, 4] : [8, 9, 10];
    let ring = rng() < 0.5 ? 1 : 2;
    let ai = startChoices[Math.floor(rng() * startChoices.length)];
    const start = { ring, ai };
    const segs = [];
    let prevOp = "";
    for (let s = 0; s < segCount; s += 1) {
      const roll = rng();
      const pArc = 0.74 - 0.42 * spec.vol;
      const pRad = 0.20;
      let op = roll < pArc ? "ARC" : roll < pArc + pRad ? "RAD" : "CHORD";
      if (op === "RAD" && prevOp === "RAD") op = "ARC";
      if (op === "ARC") {
        const mag = 2 + Math.floor(rng() * 4); // 60°..150°
        const sgn = rng() < 0.5 ? -1 : 1;
        const from = { ring, ai };
        ai = ai + sgn * mag;
        segs.push({ op, from, to: { ring, ai }, sweep: sgn > 0 ? 1 : 0 });
      } else if (op === "RAD") {
        const from = { ring, ai };
        ring = ring === 1 ? 2 : 1;
        segs.push({ op, from, to: { ring, ai } });
      } else {
        const mag = 3 + Math.floor(rng() * 4); // straight secant
        const sgn = rng() < 0.5 ? -1 : 1;
        const from = { ring, ai };
        ai = ai + sgn * mag;
        segs.push({ op, from, to: { ring, ai } });
      }
      prevOp = op;
    }
    const p0 = nodePos(start.ring, start.ai);
    const last = segs[segs.length - 1].to;
    const pEnd = nodePos(last.ring, last.ai);
    const rise = p0[1] - pEnd[1];
    if (wantAscend ? rise < sigilR * 0.5 : -rise < sigilR * 0.5) continue;
    // Balance: reject glyphs that collapse into a narrow column or bar.
    const pts = segs.flatMap(sampleSeg);
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    const bw = Math.max(...xs) - Math.min(...xs);
    const bh = Math.max(...ys) - Math.min(...ys);
    if (bw < sigilR * 0.8 || bh < sigilR * 0.8) continue;
    const aspect = bw / bh;
    if (aspect < 0.55 || aspect > 1.8) continue;
    solution = {
      start,
      segs,
      shift: [600 - (Math.max(...xs) + Math.min(...xs)) / 2, 585 - (Math.max(...ys) + Math.min(...ys)) / 2],
    };
  }
  if (!solution) throw new Error(`No sigil solution for specimen ${spec.id}`);

  const segGeom = solution.segs.map((sg) => {
    const a = nodePos(sg.from.ring, sg.from.ai);
    const b = nodePos(sg.to.ring, sg.to.ai);
    return { sg, a, b };
  });

  const endRingR = strokeW * 1.12;
  const trimLen = endRingR + strokeW * 0.42;
  const segPaths = segGeom.map(({ sg, a, b }, i) => {
    const isLast = i === segGeom.length - 1;
    if (sg.op === "ARC") {
      const R = sg.from.ring === 1 ? r1 : r2;
      let th1 = nodeAngle(sg.to.ai);
      if (isLast) {
        const th0 = nodeAngle(sg.from.ai);
        const dth = trimLen / R;
        th1 = th1 > th0 ? th1 - dth : th1 + dth;
      }
      const bx = cx + R * Math.cos(th1);
      const by = cy + R * Math.sin(th1);
      return { d: `M ${f(a[0])} ${f(a[1])} A ${f(R)} ${f(R)} 0 0 ${sg.sweep} ${f(bx)} ${f(by)}`, a, b };
    }
    let bx = b[0];
    let by = b[1];
    if (isLast) {
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      bx = b[0] - ((b[0] - a[0]) / len) * trimLen;
      by = b[1] - ((b[1] - a[1]) / len) * trimLen;
    }
    return { d: `M ${f(a[0])} ${f(a[1])} L ${f(bx)} ${f(by)}`, a, b };
  });

  const brokenIndex = win ? -1 : Math.floor(segPaths.length / 2);
  const strokes = segPaths.map((sp, i) => {
    const dash = i === brokenIndex ? ` stroke-dasharray="0.1 ${f(strokeW * 1.9)}"` : "";
    return `<path d="${sp.d}" fill="none" stroke="${ink.base}" stroke-width="${f(strokeW)}" stroke-linecap="round"${dash}/>`;
  });

  const startP = segPaths[0].a;
  const endP = segPaths[segPaths.length - 1].b;
  const midP = segPaths[Math.floor(segPaths.length / 2)].a;
  const [dx, dyShift] = solution.shift;
  const gcx = 600 - dx;
  const gcy = 585 - dyShift;

  const echo = (spec.cls === "COLOSSAL" || spec.cls === "CROWN")
    ? `<g transform="translate(${f(gcx)} ${f(gcy)}) scale(1.15) translate(${f(-gcx)} ${f(-gcy)})" opacity="0.07">
        ${segPaths.map((sp) => `<path d="${sp.d}" fill="none" stroke="${ink.base}" stroke-width="${f(strokeW * 0.4)}" stroke-linecap="round"/>`).join("\n        ")}
      </g>`
    : "";

  const gridGhost = `
    <circle cx="${cx}" cy="${cy}" r="${f(r1)}" fill="none" stroke="${BONE}" stroke-opacity="0.05" stroke-width="1.2"/>
    <circle cx="${cx}" cy="${cy}" r="${f(r2)}" fill="none" stroke="${BONE}" stroke-opacity="0.05" stroke-width="1.2"/>
    ${Array.from({ length: 12 }, (_, i) => {
      const p = nodePos(2, i);
      return `<circle cx="${f(p[0])}" cy="${f(p[1])}" r="2" fill="${MIST}" fill-opacity="0.13"/>`;
    }).join("\n    ")}
    <circle cx="${cx}" cy="${cy}" r="2" fill="${MIST}" fill-opacity="0.13"/>`;

  const diamondR = strokeW * 0.72;
  const decorations = `
    <circle cx="${f(startP[0])}" cy="${f(startP[1])}" r="${f(strokeW * 0.86)}" fill="${ink.bright}"/>
    <circle cx="${f(endP[0])}" cy="${f(endP[1])}" r="${f(endRingR)}" fill="none" stroke="${ink.base}" stroke-width="${f(strokeW * 0.5)}"/>
    <rect x="${f(midP[0] - diamondR)}" y="${f(midP[1] - diamondR)}" width="${f(diamondR * 2)}" height="${f(diamondR * 2)}" transform="rotate(45 ${f(midP[0])} ${f(midP[1])})" fill="${ink.bright}"/>`;

  return `
  <g transform="translate(${f(dx)} ${f(dyShift)})">
    ${gridGhost}
    ${echo}
    ${strokes.join("\n    ")}
    ${decorations}
  </g>`;
}

// ---------------------------------------------------------------------------
// Gallery + contact sheet
// ---------------------------------------------------------------------------

const DIRECTIONS = [
  {
    key: "a",
    name: "A — Pressure Field",
    subtitle: "Topographie de liquidation",
    render: renderPressureField,
    concept: [
      "Chaque token est un champ de pression : des anneaux organiques concentriques (la position) écrasés contre une ligne droite absolue — le prix de liquidation.",
      "Le levier rapproche le mur du cœur : à 50X les anneaux sont laminés en strates, à 3X ils flottent à peine effleurés.",
      "Le côté place le mur en dessous (LONG) ou au-dessus (SHORT) ; les gagnants ont un cœur plein qui s'éloigne du mur, les perdants un cœur creux qui y glisse.",
      "La volatilité déforme les anneaux par harmoniques seedées : aucun contour n'est jamais identique.",
      "C'est une empreinte digitale de position — la donnée devient relief, plus aucun chiffre n'est nécessaire.",
    ].join(" "),
    thumb: "À 80 px il reste : un organisme d'anneaux mint/rose pressé contre une ligne — silhouette unique dans l'écosystème NFT.",
  },
  {
    key: "b",
    name: "B — Position Mass",
    subtitle: "La goutte HWA",
    render: renderPositionMass,
    concept: [
      "Un seul objet : une masse de liquidité — la goutte HWA — dont la taille est la classe de position.",
      "La ligne fine horizontale est le prix d'entrée : les gagnants flottent au-dessus, les perdants coulent en dessous — la flottabilité EST le PNL.",
      "Le levier étire la goutte vers son point de liquidation (un petit anneau vide) : 3X reste sereine et ronde, 50X se déchire et lâche un satellite.",
      "Les LONG gouttent vers le bas, les SHORT montent à contre-gravité ; victoire = masse pleine, perte = masse vidée en contour.",
      "C'est le concept le plus radical : un glyphe unique, à la TokenWorks, où toute la physique du trade tient dans une silhouette.",
    ].join(" "),
    thumb: "À 80 px : une silhouette pleine ou creuse, qui monte ou qui goutte — quatre lectures immédiates, zéro texte nécessaire.",
  },
  {
    key: "c",
    name: "C — Market Sigil",
    subtitle: "Glyphes de conviction",
    render: renderMarketSigil,
    concept: [
      "Chaque token est un sigil : un trait continu unique tracé sur une grille polaire invisible, comme une rune de conviction.",
      "Le nombre de segments est le levier, les arcs sont le calme, les cordes tendues la volatilité.",
      "Les sigils LONG s'élèvent du bas vers le haut, les SHORT plongent ; le point plein est l'entrée, l'anneau vide la liquidation.",
      "Une perte casse un segment en pointillés — le trait survit mais porte la cicatrice.",
      "La collection devient un alphabet : 333 marques de position, comme un système d'écriture inventé par le marché.",
    ].join(" "),
    thumb: "À 80 px : un idéogramme monoligne épais, lisible comme un caractère — chaque token est une lettre distincte du même alphabet.",
  },
];

function specimenLabel(spec) {
  return `${pad3(spec.id)} · ${spec.cls} · ${spec.side} ${spec.lev}X · ${spec.pnl >= 0 ? "+" : ""}${spec.pnl.toFixed(1)}%`;
}

function galleryHtml() {
  const sections = DIRECTIONS.map((dir) => {
    const cards = SPECIMENS.map((spec) => `
      <figure>
        <img src="cards/${dir.key}-${pad3(spec.id)}.svg" alt="${dir.name} — specimen ${pad3(spec.id)}" loading="lazy">
        <figcaption>${specimenLabel(spec)}</figcaption>
      </figure>`).join("");
    const thumbs = SPECIMENS.map((spec) => `<img src="cards/${dir.key}-${pad3(spec.id)}.svg" alt="" loading="lazy">`).join("");
    return `
  <section id="dir-${dir.key}">
    <header class="dir-head">
      <h2><span>${dir.name}</span><em>${dir.subtitle}</em></h2>
      <p class="concept">${dir.concept}</p>
      <p class="thumb-note"><strong>Test miniature :</strong> ${dir.thumb}</p>
    </header>
    <div class="grid">${cards}</div>
    <div class="thumbrow"><span class="thumbrow-label">80&nbsp;px</span>${thumbs}</div>
  </section>`;
  }).join("\n");

  const hero = DIRECTIONS.map((dir) => `
      <a class="hero-cell" href="#dir-${dir.key}">
        <img src="cards/${dir.key}-300.svg" alt="${dir.name}">
        <span>${dir.name}</span>
      </a>`).join("");

  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>HWA Genesis v3 — trois directions</title>
<style>
  :root{color-scheme:dark}
  *{box-sizing:border-box;margin:0}
  body{background:#030C09;color:#E9F5EF;font-family:ui-monospace,'Cascadia Mono',Menlo,Consolas,monospace}
  .top{padding:clamp(28px,6vw,72px) clamp(18px,5vw,72px) 12px;max-width:1500px;margin:0 auto}
  h1{font-size:clamp(22px,3.4vw,40px);letter-spacing:.04em;font-weight:600}
  .top p{color:#7E9A8F;margin-top:10px;font-size:13px;letter-spacing:.12em}
  .hero{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;padding:26px clamp(18px,5vw,72px);max-width:1500px;margin:0 auto}
  .hero-cell{position:relative;display:block;border:1px solid #12352A;border-radius:14px;overflow:hidden;text-decoration:none}
  .hero-cell img{display:block;width:100%;aspect-ratio:1}
  .hero-cell span{position:absolute;left:12px;bottom:10px;color:#E9F5EF;font-size:12px;letter-spacing:.14em;text-shadow:0 1px 8px #000}
  section{max-width:1500px;margin:0 auto;padding:34px clamp(18px,5vw,72px) 8px}
  .dir-head h2{display:flex;flex-wrap:wrap;gap:8px 18px;align-items:baseline;font-size:clamp(19px,2.4vw,28px);letter-spacing:.05em}
  .dir-head h2 em{color:#6FEFC6;font-size:.62em;font-style:normal;letter-spacing:.22em;text-transform:uppercase}
  .concept{color:#A9C2B8;line-height:1.75;font-size:14px;margin-top:14px;max-width:1050px}
  .thumb-note{color:#7E9A8F;font-size:12.5px;line-height:1.7;margin-top:10px;max-width:1050px}
  .thumb-note strong{color:#C9E8DC}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:16px;margin-top:26px}
  figure img{display:block;width:100%;aspect-ratio:1;border-radius:12px;border:1px solid #0E2A21;background:#04110D}
  figcaption{color:#78938A;font-size:10.5px;letter-spacing:.08em;padding:8px 2px 0}
  .thumbrow{display:flex;align-items:center;gap:10px;margin:22px 0 6px;flex-wrap:wrap}
  .thumbrow img{width:80px;height:80px;border-radius:8px;border:1px solid #0E2A21}
  .thumbrow-label{color:#547065;font-size:11px;letter-spacing:.2em;margin-right:6px}
  footer{max-width:1500px;margin:0 auto;padding:44px clamp(18px,5vw,72px) 80px;color:#547065;font-size:12px;line-height:1.8;letter-spacing:.06em}
  @media(max-width:760px){.hero{grid-template-columns:1fr;gap:10px}.grid{grid-template-columns:repeat(2,1fr);gap:10px}}
</style>
</head>
<body>
  <div class="top">
    <h1>HWA GENESIS — PHASE 1 · TROIS DIRECTIONS</h1>
    <p>8 SPÉCIMENS PARTAGÉS PAR DIRECTION · MÊMES CLASSES, SIDES, LEVIERS, PNL · DONNÉES SIMULÉES</p>
  </div>
  <div class="hero">${hero}</div>
${sections}
  <footer>
    Toutes les statistiques affichées sont fictives et simulées. Aucun des visuels n'utilise d'asset externe ni de police distante.<br>
    Spécimens identiques par direction : ${SPECIMENS.map((s) => pad3(s.id)).join(" · ")} — validation d'une direction requise avant génération des 333.
  </footer>
</body>
</html>`;
}

function contactSheet(files) {
  const cell = 380;
  const gap = 22;
  const left = 200;
  const top = 120;
  const rowH = cell + 92;
  const width = left + 8 * cell + 7 * gap + 60;
  const height = top + DIRECTIONS.length * rowH + 40;
  const rows = DIRECTIONS.map((dir, di) => {
    const y = top + di * rowH;
    const cells = SPECIMENS.map((spec, si) => {
      const svg = files.get(`${dir.key}-${pad3(spec.id)}`);
      const b64 = Buffer.from(svg).toString("base64");
      const x = left + si * (cell + gap);
      return `<image x="${x}" y="${y}" width="${cell}" height="${cell}" href="data:image/svg+xml;base64,${b64}"/>
      <text x="${x + cell / 2}" y="${y + cell + 30}" text-anchor="middle" fill="#78938A" font-family="monospace" font-size="15">${specimenLabel(spec)}</text>`;
    }).join("\n    ");
    return `
    <text x="40" y="${y + 30}" fill="#E9F5EF" font-family="monospace" font-size="24" letter-spacing="2">${dir.name.toUpperCase()}</text>
    <text x="40" y="${y + 58}" fill="#547065" font-family="monospace" font-size="15" letter-spacing="3">${dir.subtitle.toUpperCase()}</text>
    ${cells}`;
  }).join("\n");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
  <rect width="${width}" height="${height}" fill="#030C09"/>
  <text x="40" y="64" fill="#E9F5EF" font-family="monospace" font-size="34" letter-spacing="4">HWA GENESIS V3 — PHASE 1 · TROIS DIRECTIONS · SIM</text>
  ${rows}
</svg>`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

mkdirSync(join(OUT, "cards"), { recursive: true });

const files = new Map();
for (const dir of DIRECTIONS) {
  for (const spec of SPECIMENS) {
    const uid = `${dir.key}${pad3(spec.id)}`;
    const svg = shell(spec, uid, dir.render(spec));
    const name = `${dir.key}-${pad3(spec.id)}`;
    files.set(name, svg);
    writeFileSync(join(OUT, "cards", `${name}.svg`), svg, "utf8");
  }
}

writeFileSync(join(OUT, "index.html"), galleryHtml(), "utf8");
writeFileSync(join(OUT, "contact-sheet.svg"), contactSheet(files), "utf8");

const hashes = new Set([...files.values()].map((s) => createHash("sha256").update(s).digest("hex")));
if (hashes.size !== files.size) throw new Error("Duplicate rendered SVGs across specimens");
process.stdout.write(`Rendered ${files.size} exploration SVGs (${DIRECTIONS.length} directions x ${SPECIMENS.length} specimens), all unique.\nOutput: ${OUT}\n`);
