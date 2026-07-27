# fwa.fun design extraction — reference for the HWA restyle

Captured live from https://fwa.fun on 2026-07-25 (computed styles, stylesheet rules, DOM
structure). This is the fidelity target for the Hyper World Assets frontend.

## Tokens (dark, default)

| Token | Value | | Token | Value |
|---|---|---|---|---|
| background | `#050405` | | accent | `#e991a5` |
| surface | `#120f11` | | accent-edge | `#c86e84` |
| surface-secondary | `#1a1518` | | accent-foreground | `#fef6f9` |
| surface-tertiary | `#211c1f` | | danger | `#fa355c` |
| border | `#221e20` | | success | `#40bd5e` |
| separator | `#1c181b` | | warning | `#f29c4c` |
| default (control) | `#1f1a1d` | | muted | `#a49ea2` |
| field-background | `#120f11` | | field-placeholder | `#a29fa1` |
| overlay | `#120f11` | | segment | `#383437` |

Light theme: background `#f9f4f5`, accent `#d86f85` (edge `#b84f6a`), border `#e3dcde`,
default `#f3e7ec`, muted `#786f72`, separator `#e9e3e5`, surface-secondary `#f5edf0`,
surface-tertiary `#f0e8eb`, scrollbar `#d9d3d5`. Theme = `dark` class on `<html>` +
`color-scheme`; site defaults dark with a nav toggle.

## Typography

- Body: **Inter**, 16px. Foreground near-white (lab ≈ `#fbfbfb`).
- **Functional micro-mono**: `ui-monospace, SFMono-Regular, Menlo, monospace` at
  **10px/600** for segments, "View Pool", nav-ish actions; **9px** for sort labels/chips.
- CTA: 12px semibold. Buttons: 14px/500.

## The button system (signature)

`.button` (non-ghost): `border: 1px solid var(edge)` with **`border-bottom-width: 4px`**
(darker edge color) + **colored glow** `box-shadow: 0 10px 22px var(bg)` (~24% alpha
visually), `border-radius: 8px`, transitions 160ms.
**Pressed**: `translateY(2px)`, `border-bottom-width: 2px`, `brightness(.92)`, smaller
shadow. **Disabled**: `saturate(.7)`, no press. Connected-wallet variant: flat (1px
border, no shadow/transform). Ghost: transparent, hover bg = foreground/10-ish.
Sizes: sm h-8 px-3 (Connect), md h-10, lg **h-12 rounded-lg px-5** (main CTA).

## Layout

- Nav 65px, transparent, px-32px: logo image 48px (left) · spacer · theme toggle (ghost
  icon 40px) · Connect wallet (sm primary, w-9.5rem).
- **Hero**: `h-[calc(100dvh-5.25rem)]`, dot-grid pattern layer (48px SVG tile, opacity
  .15, radial mask fading out), grid `[833px | 432px]`:
  - Left: h-14 stats bar (border-b; 5 items "dot + mono label"; right cells `border-l`
    with mono 10px **View Pool** anchor + collapse icon) then centered **prize stack**
    (~10 absolutely-stacked images, `w-[43%] max-w-[min(18rem,38dvh)]`, fanned).
  - Right **purchase sidebar**: `border-l bg-background`, columns:
    1. h-14 border-b: `segment` control (Recent/Top/Pool/Deposits), mono 10px,
       animated indicator, item h-7 rounded-md.
    2. h-9 border-b `bg-surface-secondary/40`: `Sort` 9px muted + chips h-6 min-w-12
       rounded px-1.5 text-[9px] (Value / Date↓ / Name).
    3. Scrollable **feed rows**: `grid-cols-[2.5rem_1fr_auto] gap-2 px-3 border-b` —
       40px thumb (`rounded` 4px), middle (meta 8px / name 16px / sub 12px), right
       (value / sub / chip) `min-w-[8.5rem] text-right`.
    4. **Sticky purchase box** (border-t, px-4 py-3, max-w-28rem): `Quantity` (10px
       muted) + value; **slider h-11 w-full rounded-lg border** (batch 1–5); CTA lg
       primary h-12 w-full "1 NFT · <price> · Ξ0"; caption 10px muted + underlined
       "Read more".
- **Info strip** below hero: `max-w-5xl px-6`, 2-col explainer cards
  (`rounded-lg border-border/60 bg-background-secondary/30 p-5`), `border-t`
  separators, 6 stat pills in 3-col grid (`px-4 py-2.5`, label left muted / value
  right).
- **Pool section**: full-width, own feed + same sidebar patterns.
- Footer: `max-w-5xl py-6 text-sm text-muted`, brand left, links right
  (Activity · Docs · Terms).

## Motifs & motion

- Dot-grid SVG tile 48px, two layers `opacity=.15` (fills `#1C1F21` / `#0A0A0A`,
  inverted in light), masked `radial-gradient(black 10% → transparent 100%)`.
- Skeletons: `skeleton--shimmer` on `rounded-md` blocks; feed rows appear with
  `feed-item-enter` (fade + translate, .132s).
- Currency shown as `Ξ` suffix — **HWA uses `HYPE` everywhere instead**.
- Indexer: Ponder; manifest endpoint `/api/ponder/deployment` returns
  `{chainId, chainName, contracts{...}, poolId, startBlock}` — matches our
  DeploymentManifest design (INTEGRATION_NEEDS.md).

## HWA divergences (deliberate)

Brand: **Hyper World Assets**, wordmark HWA (no FWA logo asset copied); token label
$HWA; HYPE replaces ETH/Ξ; four routed screens (Pool, Activity, Positions, Rewards)
instead of a one-pager, but nav/footer styled to match; mock banner and scenario
tooling retained.
