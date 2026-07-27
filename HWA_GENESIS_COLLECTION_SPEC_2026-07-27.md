# HWA Genesis Collection — visual and metadata specification

Date: 2026-07-27  
Status: **ARCHIVED — v1/v2 design history only. The approved canonical mainnet collection is
`HWA_GENESIS_COLLECTION_V3_SPEC.md` / renderer `HWA-GEN-3.0.0`.**

This document is retained for audit provenance. None of the v1/v2 images or metadata may be used
for the mainnet Genesis base URI.

## 1. Collection thesis

The 333 HWA Genesis NFTs are presented as fictional on-chain trading positions. Their visual
language borrows the immediate readability of a crypto PNL share card—large signed performance,
position side, size, entry and mark—while using an original HWA identity instead of reproducing
Hyperliquid branding, logos, mascots, typography or exact layouts.

Each NFT is a **Genesis Position**, not a representation of a real account or trade. Every rendered
asset must visibly carry `GENESIS POSITION` and `SIMULATED` or `GENESIS / SIM`.

The canonical NFT is a self-contained square SVG so it works in wallets, marketplaces and the HWA
pool carousel. Raster and landscape social cards are derivative exports, never the canonical source.

The high-level generative principle is informed by TokenWorks' public Ten Thousand Tokens
retrospective: a visually pleasing on-chain SVG, a black background and randomized orbital elements.
HWA uses an independently implemented market-orbit renderer, original geometry and its own visual
identity; no TokenWorks asset, source code or composition is copied.

Primary reference: `https://www.token.works/archive/tenthousandtokens`.

## 2. Art direction

- Near-black green terminal background with a nearly invisible market grid and flowing liquidity
  contours.
- HWA accents: acid lime and violet for identity, HyperEVM-friendly teal for bid liquidity, coral
  for ask liquidity and drawdowns.
- One abstract market footprint replaces illustration and mascot: bid/ask depth, an entry line, a
  coherent price trace, a mark point and a minimal position glyph.
- There is no floating collectible frame. Size Class changes the physical footprint occupied by the
  liquidity field, leaving progressively less negative space as position size increases.
- Information hierarchy: PNL first, side and market second, size/entry/mark third, ID and class last.
- Dense enough for trader culture, readable enough to understand in under two seconds.
- No Hyperliquid logo, wordmark, mascot, referral link, screenshot or copied composition.

The earlier `COLOSSAL` moodboard is stored at:

`frontend/public/genesis/concepts/hwa-genesis-colossal-v1.png`

It is not part of the collection. Production typography, geometry and numbers are rendered
deterministically in code.

The canonical abstract v2 collection is stored at:

- renderer: `scripts/generate-hwa-genesis.mjs`;
- images: `frontend/public/genesis/v2/images/001.svg` through `333.svg`;
- metadata templates: `frontend/public/genesis/v2/metadata/001.json` through `333.json`;
- canonical traits: `frontend/public/genesis/v2/traits.json`;
- collection manifest: `frontend/public/genesis/v2/manifest.json`;
- responsive review gallery: `frontend/public/genesis/v2/gallery.html`;
- five-class review sheet: `frontend/public/genesis/v2/contact-sheet.svg`.

The original framed v1 output remains preserved at `frontend/public/genesis/v1/` for visual and
audit history, but it is not the proposed mainnet collection.

Verified v1 aggregate SHA-256:

`f9f454d64b3616d4a6f92547af5eebcb9a5974a028893e83ca8439fb2236ab46`

## 3. Exact 333-card size distribution

| Size Class | Supply | Share | Liquidity-field occupancy | Visual treatment |
|---|---:|---:|---:|---|
| `SCALP` | 200 | 60.06% | 56% | compact depth field, maximum negative space |
| `SIZE` | 80 | 24.02% | 66% | broader depth and a second contour |
| `WHALE` | 35 | 10.51% | 77% | expanded book depth and denser tape |
| `COLOSSAL` | 15 | 4.50% | 88% | near-full market field and brighter mark pulse |
| `CROWN` | 3 | 0.90% | 100% | maximum footprint and three-point signature |
| **Total** | **333** | **100%** |  |  |

Size Class changes presentation and collectible rarity only. It does **not** change ownership
rights, protocol weight, rewards or the Splitter allocation. Every token represents one equal unit
of the 333-token snapshot.

## 4. Front and back of the card

### Front

- `HWA` and `GENESIS POSITION` identity;
- simulated market and `LONG` / `SHORT` side;
- large signed PNL percentage;
- simulated size in HYPE;
- simulated entry and mark;
- Size Class and token number;
- small `SIMULATED` disclosure.

### Back / click-to-inspect state

The existing HWA card-flip interaction exposes:

- canonical token ID and metadata CID;
- Size Class and all visual traits;
- `1 / 333` equal snapshot unit;
- Genesis edition and renderer version;
- image hash and an explorer link after deployment;
- explicit statement that the position and PNL are fictional.

The flip must preserve the same card scale, perspective and hover response as the front.

## 5. Canonical traits

All 333 combinations are unique. The minimum metadata attribute set is:

| Trait | Allowed values / rule |
|---|---|
| `Edition` | `HWA Genesis` |
| `Size Class` | `SCALP`, `SIZE`, `WHALE`, `COLOSSAL`, `CROWN` |
| `Side` | `LONG`, `SHORT` |
| `Market` | a reviewed fictional market label, default `HWA/HYPE` |
| `PNL Band` | `Drawdown`, `Flat`, `Green`, `Runner`, `Outlier` |
| `Leverage` | cosmetic integer from `1x` to `50x` |
| `Footprint` | `Orbit`, `Pulse`, `Grid`, `Vector`, `Void` |
| `Risk Contour` | `1` to `5` |
| `Frame Finish` | `Obsidian`, `Lime`, `Violet`, `Cyan`, `Prismatic` |
| `Signal` | one reviewed short market-state label |
| `Renderer` | immutable renderer version, initially `HWA-GEN-1` |

PNL, entry, mark, leverage and size are generated as internally coherent fictional values. Positive
PNL is not rarer than negative PNL and does not determine Size Class. A loss can be a Crown and a
large win can be a Scalp; the collection celebrates trading culture rather than implying guaranteed
performance.

## 6. Deterministic production pipeline

The 333 finished cards are not independently AI-generated. Production uses the deterministic SVG
renderer committed in `scripts/generate-hwa-genesis.mjs`:

1. freeze this visual system and the five Size Class counts;
2. derive scoped SHA-256 seeds from each token ID;
3. build the 333-row canonical trait manifest;
4. render typography, coherent simulated stats, liquidity footprints, price traces and IDs from
   that manifest;
5. export one self-contained square SVG per token;
6. export one ERC-721 metadata JSON template per token;
7. validate exact trait counts, unique seeds, unique SVG hashes, metadata/image hashes and the
   aggregate manifest hash;
8. manually review all three Crowns, all fifteen Colossals and a stratified sample of every class;
9. pin the `images` directory through at least two independent IPFS pinning providers;
10. regenerate into a new output directory with the real `--image-base-uri ipfs://<IMAGE_CID>/`,
    re-run verification, then pin the final metadata directory;
11. set the final `ipfs://<METADATA_CID>/` base URI, mint all 333 IDs to the Safe, verify every
    token URI and only then call `freezeSnapshot()`.

The generator seed and complete canonical manifest are published with the assets. Token IDs may be
permuted so they do not encode Size Class, but no hidden randomness or reveal mechanism is required:
traits have no economic effect and the initial custody is the Safe.

## 7. Required outputs before mainnet freeze

- `333` square canonical SVGs — **complete and verified for abstract v2**;
- `333` metadata JSON templates — **complete and verified for abstract v2; image CID placeholder remains**;
- one canonical trait JSON — **complete**;
- dependency-free renderer source — **complete**;
- aggregate SHA-256 manifest — **complete**;
- optional landscape social derivatives — pending, not required for the NFT base URI;
- IPFS CID replicated and fetched through two independent gateways;
- automated verification report with zero missing IDs, duplicate token numbers or count drift;
- explicit visual approval of the five class masters.

Until the art is approved, the image and metadata directories are pinned, and the final metadata is
reviewed with real immutable URIs, `HWA_GENESIS_NFT_BASE_URI` remains a launch blocker and the
Genesis NFT contract must not be deployed on mainnet.

## 8. Concept-generation prompt

The visual prototype was generated from the following production brief:

> Design one original HWA Genesis Position NFT card inspired by the visual language of crypto PNL
> share cards while creating an independent HWA identity. Use an obsidian trading-terminal backdrop,
> market grid, risk contours, acid-lime/violet/cyan light, and a large premium vertical position
> monolith containing an original liquid-crystal reactor core. Square 1:1 composition; COLOSSAL tier;
> information hierarchy built around HWA, GENESIS POSITION, a large signed PNL, LONG/SHORT, size in
> HYPE, entry, mark, class and token ID. Do not use the Hyperliquid wordmark, logo, mascot, referral
> code, screenshot, exact layout, watermark or unrequested text.
