# HWA Genesis Collection v3 — "Pressure Field" specification

Date: 2026-07-27
Status: **APPROVED AS THE FINAL HWA GENESIS COLLECTION; 333 deterministic v3 assets generated and
verified. The production VPS hostname and final HTTPS base URI are NOT frozen. No Genesis contract
has been deployed and no on-chain action has been taken.**

## 1. How v3 was chosen

Phase 1 produced three genuinely different artistic directions, rendered from the same 8
archetype specimens (identical class/side/leverage/PNL per direction) for a like-for-like
comparison:

- **A — Pressure Field** (liquidation topography): organic contour rings crushed against a
  straight liquidation wall;
- **B — Position Mass** (the HWA drop): a single liquid mass whose buoyancy is PNL and whose
  drip toward a liquidation point is leverage;
- **C — Market Sigil** (conviction glyphs): one continuous monoline rune per position on a
  hidden polar grid.

The Phase 1 comparison gallery is preserved at `frontend/public/genesis/v3-explorations/`
(`index.html`, `contact-sheet.svg`, renderer `scripts/generate-hwa-genesis-v3-explorations.mjs`).
**Direction A was validated** ("go designs A") and industrialized as v3. Directions B and C
remain archived in the exploration renderer and can be revived later as separate editions.

v1 (framed PNL card) and v2 (abstract liquidity footprint) are preserved untouched at
`frontend/public/genesis/v1/` and `frontend/public/genesis/v2/`. Neither is the proposed
mainnet collection.

## 2. Concept

Each token is a **pressure field**: a nest of organic contour rings — the position — pressed
against one absolute straight line — the liquidation wall. The trading data is not the
composition; it is the physics acting on the composition:

- **Leverage** decides how close the wall cuts into the field. 2X barely grazes the outer
  contour; 50X laminates the rings into compressed strata.
- **Side** decides where the wall waits: below the field for LONG, above it for SHORT.
- **PNL** lights the core: winners get a filled bright core, 1–3 bright inner rings and a mark
  dot drifting away from the wall; losers get a hollow core, dimmed rings, the outer two
  contours decaying into dashes, and a mark dot sliding toward the wall.
- **Volatility** storms the contours through seeded harmonics, calmed near the wall (pressure
  flattens turbulence — this also prevents shelf artifacts).
- Where the outer ring actually touches the wall, a short bright **contact** segment marks the
  pressure point; beyond the wall, two-to-three faint **strata** echo the liquidated shadow.

There is no card frame, no chart, no orderbook, no dashboard, no mascot and no logo quotation.
The micro-caption (`HWA 042/333 · CLASS` / `SIDE 25X · +12.4% · SIM`) is the only text and is
deliberately secondary. Every number shown is fictional and marked `SIM`.

## 3. Visual grammar

| Data | Visual consequence |
|---|---|
| Size Class | field footprint (0.52 → 0.95 of canvas radius), ring count (5 → 14), CROWN hairline halo |
| Side | wall below + mint ink (LONG) / wall above + rose ink (SHORT) |
| Leverage band | wall distance: FAR grazes, TERMINAL laminates |
| PNL sign/magnitude | core filled vs hollow, 1–3 bright inner rings, mark position, dashed outer decay |
| Formation | FIELD standard / VENT dotted pressure-escape sector (always opens away from the wall) / VISE second fainter wall squeezing the field into a capsule |
| Surface (volatility) | GLASS / RIPPLE / SWELL / STORM contour turbulence |
| FLAT band (±3%) | bone micro-dot core (position going nowhere) |

Palette: abyss-green radial background (`#0A2B21 → #030C09`), LONG mint `#6FEFC6` family,
SHORT rose `#FF7E9B` family, bone `#E9F5EF` for the wall/marks, mist `#7E9A8F` for captions.
System monospace stack only; no remote fonts; no external assets; no blur/glow filters.

## 4. Exact distributions (all sum to 333)

Assigned deterministically and independently of each other and of PNL, via SHA-256 hash-sorted
token id lists per scope (`HWA_GENESIS_V3_CLASS`, `_SIDE`, `_FORMATION`, `_LEV`).

| Size Class | Supply | Footprint | Rings |
|---|---:|---:|---:|
| SCALP | 200 | 0.52 | 5 |
| SIZE | 80 | 0.62 | 7 |
| WHALE | 35 | 0.72 | 9 |
| COLOSSAL | 15 | 0.83 | 11 |
| CROWN | 3 | 0.95 | 14 |

| Side | Supply | | Formation | Supply | | Leverage band | Supply | Values |
|---|---:|---|---|---:|---|---|---:|---|
| LONG | 193 | | FIELD | 231 | | FAR | 55 | 2/3/4X |
| SHORT | 140 | | VENT | 68 | | NEAR | 118 | 5/8/10/12X |
| | | | VISE | 34 | | PRESS | 98 | 15/20/25X |
| | | | | | | SQUEEZE | 47 | 30/35/40/45X |
| | | | | | | TERMINAL | 15 | 50X |

Derived (seeded, computed for this build and asserted by the verifier against the manifest):
PNL bands DRAWDOWN 153 / FLAT 20 / GREEN 104 / RUNNER 52 / OUTLIER 4;
Surfaces GLASS 95 / RIPPLE 90 / SWELL 66 / STORM 82.

Economics: every token is strictly **1/333 of the Genesis snapshot**. Class, formation and all
other traits are cosmetic rarity only, carry no protocol weight, and positive PNL is not rarer
than negative PNL nor correlated with any rarity axis.

## 5. Determinism and reproducibility

- Renderer: `scripts/generate-hwa-genesis-v3.mjs`, version `HWA-GEN-3.0.0`, dependency-free
  (node:crypto/fs/path only).
- Every random draw comes from an sfc32 RNG seeded by SHA-256 of a scoped label containing the
  token id (`HWA_GENESIS_V3_TRAITS:<id>`, `HWA_GENESIS_V3_ART:<id>`, …). Same script + same id
  ⇒ byte-identical SVG. No `Date`, no `Math.random`.
- Simulated numbers are internally coherent: `mark = entry × (1 + dir·pnl/(100·lev))`,
  verified for every token.
- SVG def ids are side-scoped (`hwa-L-*` / `hwa-S-*`), so identical ids always carry identical
  content even if multiple cards are inlined into one DOM.

## 6. Geometry fingerprint (text-independent uniqueness)

Each SVG wraps its artwork in `<!--GEOM--> … <!--/GEOM-->` markers. The caption text lives
outside the markers. The **geometry fingerprint** is the SHA-256 of the marker slice — pure
geometry, no token id, no PNL, no text. The verifier recomputes it from the file and asserts:

- 333 distinct geometry fingerprints (tokens stay unique even with all text masked);
- fingerprint equality between file, metadata `properties.geometry_fingerprint_sha256` and
  manifest entry.

## 7. Automated verification (all passing for this build)

`node scripts/generate-hwa-genesis-v3.mjs --verify-only` asserts:

- exactly 333 images and 333 metadata files, no missing id in 1..333, no duplicates;
- 333 unique visual seeds, 333 unique SVG SHA-256, 333 unique geometry fingerprints;
- displayed-data coherence (side/leverage/PNL on card; entry/mark relation in metadata);
- leverage within its band, PNL band and Surface tier consistent with stored values;
- exact class/side/formation/leverage-band counts, and manifest-recorded counts for the
  derived PNL band and Surface distributions;
- no `Hyperliquid` / `TokenWorks` / `referral` strings, no external URL, no external `url()`,
  no `@font-face`/`@import` (the W3C `xmlns` namespace is the only allowed URL);
- per-file and aggregate manifest hashes.

Build aggregate SHA-256: `96b80e5c8a06b07407d92b58dbf7865aab242439bdfdb5d8436e370cd2915648`

Frontend `npm run typecheck` and `npm run build` pass with the assets in place. The gallery
was screenshot-verified at 1440×1100 and 390×844.

## 8. Files

- `frontend/public/genesis/v3/images/001.svg … 333.svg` — canonical 1200×1200 SVGs (~15 MB total);
- `frontend/public/genesis/v3/metadata/001.json … 333.json` — ERC-721 metadata templates
  (image URI prefix placeholder `ipfs://__HWA_GENESIS_V3_IMAGES_CID__/`);
- `frontend/public/genesis/v3/traits.json` — canonical trait manifest (includes fingerprints);
- `frontend/public/genesis/v3/manifest.json` — counts, class masters, per-file hashes, aggregate;
- `frontend/public/genesis/v3/gallery.html` — responsive review gallery (class/side/formation
  filters + true-80px mode);
- `frontend/public/genesis/v3/contact-sheet.svg` + `.png` — 15 curated cells (5 class masters,
  side×outcome, VISE, VENT, TERMINAL, FLAT, OUTLIER, STORM);
- `scripts/generate-hwa-genesis-v3.mjs` — deterministic renderer + verifier;
- `scripts/render-hwa-genesis-v3-contact-sheet-png.mjs` — PNG derivative export (uses the
  frontend's sharp; not part of canonical determinism);
- npm helpers: `genesis:v3:generate`, `genesis:v3:verify`, `genesis:v3:png` in `frontend/package.json`;
- local viewer: `node scripts/serve-genesis-v3-explorations.mjs` → `http://localhost:4390/`
  (v3 gallery) and `/explorations` (Phase 1 archive); launch config `genesis-v3-gallery`.

## 9. Remaining pipeline to mainnet (deliberately NOT executed)

1. **COMPLETE:** final v3, its five class masters and all three CROWNs were explicitly approved on
   2026-07-27.
2. Choose the production HTTPS asset hostname and configure the supplied Nginx policy.
3. Run `scripts/PrepareHWAGenesisHosting.ps1 -PublicOrigin https://assets.example.tld`. The script
   locks the approved source-art aggregate and creates a versioned, upload-ready directory.
4. Upload only the generated `public/` directory. The immutable version path contains the full
   approved aggregate. Keep the primary VPS, two independent backups and an offline hash archive.
5. Run `scripts/VerifyHWAGenesisHosting.ps1 -PackageRoot <package> -Remote`. It fetches all 333
   images and all 333 metadata documents, rejects redirects, and verifies MIME, one-year immutable
   cache headers and every SHA-256 hash.
6. Put the attested HTTPS `tokenBaseUri` in `HWA_GENESIS_NFT_BASE_URI`, mint all 333 ids to the Safe,
   verify every token URI, then call `freezeSnapshot()`.

The contract metadata files are named `1` through `333` with no extension because
`HWAGenesisNFT.tokenURI()` returns `baseURI + tokenId`. IPFS may be operated as an optional mirror,
but it is no longer a launch dependency. Until the production remote attestation passes,
`deploymentAllowed` remains false and the mainnet release gate rejects the launch.
