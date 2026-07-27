# Design system — Hyper World Assets

**Structure from fwa.fun, identity owned by Hyper World Assets.** The product
mechanics and layout mirror the live FWA app (extracted in
`DESIGN_EXTRACT_FWA.md`), while the skin is the proprietary **Volt Loot**
direction: Midnight canvas, ultraviolet depth and a rare acid-lime interaction
rim. Hyperliquid mint remains an infrastructure signal, never the product's
main pigment. Every value lives as a CSS variable in `src/app/globals.css`;
dark is the default and `.light` on `<html>` flips the theme (navbar toggle,
persisted as `hwa.theme`).

## Color

Signature: **acid rim / violet shadow**. Approximate visual proportions are
72% Midnight, 18% neutral surfaces, 7% ultraviolet and no more than 3% Volt.
Volt means primary action or current selection; ultraviolet means depth,
navigation and review; mint means HyperEVM/on-chain health.

| Utility | Dark | Light | Use |
|---|---|---|---|
| `bg` | `#080a12` | `#f6f5ee` | page / Midnight |
| `panel` | `#0e1220` | `#ffffff` | cards |
| `elevated` | `#151a2c` | `#eceef7` | drawers, popovers, info cards |
| `surface3` | `#1a2034` | `#e7e9f3` | deepest raised |
| `control` | `#20263b` | `#e1e4f0` | chips and inputs |
| `inset` | `#0b0e18` | `#ffffff` | fields, segment tracks |
| `line` / `line-subtle` / `line-strong` | `#2a3148` / `#1c2235` / `#3b4563` | `#d4d8e7` / `#e3e5ee` / `#b8bfd4` | borders |
| `ink` / `dim` / `mute` / `faint` | `#f5f6ff` / `#c8cee5` / `#8f96b2` / `#7c85a2` | inverse ramp | text |
| `accent` / `accent-edge` / `accent-hover` / `accent-fg` | `#d8ff52` / `#8fae22` / `#e8ff91` / `#080a12` | `#beeb36` / `#829f24` / `#cffa4d` / `#101308` | Volt: primary action and selection |
| `secondary` / `secondary-readable` / `secondary-deep` | `#7354f5` / `#a995ff` / `#2a205a` | `#6247e5` / `#5b3fd6` / `#e5e0ff` | ultraviolet depth and navigation |
| `chain` / `gold` | `#50d2c1` / `#ffd166` | `#168f83` / `#a96f00` | HyperEVM proof / crown and grail |
| `red` / `green` / `amber` / `blue` | `#ff5d73` / `#48d6a3` / `#ff9f43` / `#5cb7ff` | darkened equivalents | danger / success / warning / info |

Rarity is independent of brand: Common `#a2a9bc`, Uncommon `#67d5a9`, Rare
`#54c7ff`, Epic `#a995ff`, Grail `#ffd166`. Never tint NFT artwork with a brand
color; rarity may color a label or a short rail only.

## Typography

Three cuts, self-hosted through `next/font` (`src/app/fonts.ts`):

- **Sora** — display: wordmark, `h1`/`h2`, `.font-display`. Tracking `-0.02em`.
- **Manrope** — UI and body copy (14px default, 16px `text-md` for names/prose).
- **JetBrains Mono** — every amount, id, hash, and the `.mlabel` micro-label
  (10px/600), with `tabular-nums` via `.num`. Sort chips drop to `text-3xs` (9px).

## The 3D pressable button (`.btn3d`)

The primary control uses Volt: 1px border in the edge color with a **4px
bottom edge**, colored glow `0 10px 22px`, radius 8px. `:active` presses it —
`translateY(2px)`, bottom edge 2px, `brightness(.92)`, reduced glow. Disabled
desaturates. Variants: `--primary` (Volt), `--violet` (secondary action),
`--danger`, default (neutral),
`--flat` (connected-wallet: 1px, no glow, no press). Sizes `xs` 24 / `ctl` 32 /
`lg` 48 (`rounded-lg`, the purchase and swap CTAs).

## Craft pass (prjx-inspired)

Borrowed from prjx.com as *craft*, not colors:

- **Floating capsule chrome** (`.capsule`): the navbar is three pills hovering
  over the page (brand+routes · status · actions) with a gradient scrim so
  content fades out beneath instead of colliding with it.
- **Soft elevated surfaces**: `.card` / `.card-inset` on a 5/8/12/16/22/28 radii
  scale, lifted with `--elev-1` / `--elev-2`. Nothing is boxy.
- **Sparkline stat cards** (`Sparkline` + `StatCard`): micro-label, big mono
  number, optional signed delta chip, and an area plot along the lower edge.
  The series is a real client-side rolling sample of live snapshots — the plot
  is withheld until 3 genuine samples exist and captioned "since page load"
  rather than inventing history.
- **Ambient ticker** (`ActivityTicker`): a slim marquee of real protocol events
  above the footer, desktop-only, dismissible, pausing on hover and falling
  back to a static scrollable strip under reduced motion. The moving track is
  `aria-hidden`; a static "Activity ↗" link carries keyboard users.
- **The reveal moment** (`RevealOverlay`): an allocation is the payoff, so it
  gets a centered celebration — ultraviolet halo, Volt artwork rim, odds it beat,
  and a direct "Settle now". Escape/backdrop dismiss, focus trapped, auto-closes,
  queued "1 of N" for batch purchases.
- **NFT foil hover** (`HeroPrizeStack`): the active card uses a 1200px
  perspective, restrained pointer tilt, layered header/art depth, a moving
  Volt → chain-mint → ultraviolet `color-dodge` spectrum, soft-light scan
  texture and local radial glare. Leaving the card eases every value back to
  neutral; `prefers-reduced-motion` removes both tilt and foil.
- **`.grid-paper`** graph backdrop layered under the hero with the aurora.

## Components

- **Segment** (`.segment`): inset track, mono items, active on `line-strong`;
  correct radiogroup semantics (roving tabindex, arrow keys).
- **Purchase sidebar** (432px, `border-l`): feed segment → sort bar → feed rows →
  sticky purchase box (Quantity + h-11 slider, drift presets, guarded CTA,
  price-anatomy caption, live tickets). **Recent** is the *acquisition* feed —
  what was bought, for how much, and how it settled; **Top / Pool / Deposits**
  are listing feeds.
- **Hero**: rarity-distribution strip (probability mass per band + `View Pool ↓`),
  fanned **prize stack** (all active listings browsable by pointer, a bounded
  visual window, automatic cycling paused on hover/focus), caption, crown strip
  — over `dot-grid` + a slow ultraviolet `aurora`.
- **Pages**: Pool · `$HWA` token (chart + swap) · Acquisitions (purchase
  analytics) · Manage (positions) · Activity · Rewards · Deposit · Docs · Terms,
  plus the terms gate shown once per connected address.

## Motion

Functional only, all collapsing under `prefers-reduced-motion`:
`btn3d` press (160ms) · `anim-fade-up` · `anim-feed-item` (132ms) ·
`anim-reveal` (allocation) · `anim-tick` (a value changed) ·
`anim-cta-glow` (idle breathing on the primary CTA) · `anim-ping` (live dot) ·
`aurora` (18s hero drift) · skeleton shimmer.

## Ecosystem

The first intended collections are HyperEVM-native: **Hypurr**, **Wealthy Hypio
Babies**, **PiP & Friends**, **Hypers**, **Mad Kins**. In mock mode their art is
generated locally (a geometric cat for Hypurr, drops for PiP, orbs for Hypio…) —
placeholders, never their real artwork, and real addresses only ever come from
the deployment manifest.

## Voice

Unchanged by the reskin: one randomly selected position, risk of loss,
`indexed ≠ confirmed`, `submitted ≠ success`, no invented yields, HYPE only
(never Ξ/ETH), HyperEVM ≠ HyperCore, mock data always labeled.
