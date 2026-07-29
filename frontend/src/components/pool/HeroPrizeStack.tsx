"use client";

import { useEffect, useMemo, useRef, useState, type PointerEvent, type ReactNode } from "react";
import Link from "next/link";
import { sanitizeLabel, shortAddress, timeAgo } from "@/lib/format";
import { formatOddsPercent, oddsOneIn } from "@/lib/units";
import { RARITY_COLOR, rarityFromOdds } from "@/protocol/rarity";
import type { Listing, PoolSnapshot } from "@/protocol/types";
import { Hype } from "@/components/ui/Hype";
import { NFTImage } from "@/components/nft/NFTImage";
import { Skeleton } from "@/components/ui/Skeleton";

const CYCLE_MS = 4_500;
const VISIBLE_SIDE_SLOTS = 3;

/** Place rank #1 in the center, then alternate #2/#3 left and right. */
function rankSlot(index: number): number {
  if (index === 0) return 0;
  return index % 2 === 1 ? -Math.ceil(index / 2) : Math.ceil(index / 2);
}

function resetCardFx(element: HTMLDivElement | null) {
  if (!element) return;
  element.style.setProperty("--card-tilt-x", "0deg");
  element.style.setProperty("--card-tilt-y", "0deg");
  element.style.setProperty("--card-pointer-x", "50%");
  element.style.setProperty("--card-pointer-y", "50%");
  element.style.setProperty("--card-spectrum-x", "50%");
  element.style.setProperty("--card-spectrum-y", "50%");
  element.style.setProperty("--card-fx-opacity", "0");
  element.dataset.fxActive = "false";
}

function moveCardFx(event: PointerEvent<HTMLDivElement>) {
  event.stopPropagation();
  if (event.pointerType !== "mouse" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const bounds = event.currentTarget.getBoundingClientRect();
  const x = Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width));
  const y = Math.min(1, Math.max(0, (event.clientY - bounds.top) / bounds.height));
  event.currentTarget.style.setProperty("--card-tilt-x", `${((0.5 - y) * 8).toFixed(2)}deg`);
  event.currentTarget.style.setProperty("--card-tilt-y", `${((x - 0.5) * 10).toFixed(2)}deg`);
  event.currentTarget.style.setProperty("--card-pointer-x", `${(x * 100).toFixed(1)}%`);
  event.currentTarget.style.setProperty("--card-pointer-y", `${(y * 100).toFixed(1)}%`);
  event.currentTarget.style.setProperty("--card-spectrum-x", `${(100 - x * 100).toFixed(1)}%`);
  event.currentTarget.style.setProperty("--card-spectrum-y", `${(100 - y * 100).toFixed(1)}%`);
  event.currentTarget.style.setProperty("--card-fx-opacity", "1");
  event.currentTarget.dataset.fxActive = "true";
}

/**
 * Panoramic FWA-style prize deck. Every active listing participates in the
 * browser: a horizontal pointer sweep maps across the full ranked set while a
 * bounded visual window keeps image and DOM work under control.
 */
export function HeroPrizeStack({
  listings,
  snapshot,
  onOpen,
}: {
  listings: Listing[];
  snapshot?: PoolSnapshot;
  onOpen: (id: bigint) => void;
}) {
  const deck = useMemo(() => {
    const active = listings.filter((listing) => listing.status === "active");
    return [...active].sort((a, b) => {
      if (a.backing === b.backing) return a.id < b.id ? -1 : 1;
      return a.backing > b.backing ? -1 : 1;
    });
  }, [listings]);

  const [front, setFront] = useState(0);
  const [paused, setPaused] = useState(false);
  const [cursorPct, setCursorPct] = useState(50);
  const [flippedId, setFlippedId] = useState<string | null>(null);
  const activeCardRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ pointerId: number; startX: number; startFront: number; moved: number } | null>(null);
  /** True for the click that ends a real drag, so browsing never opens a card. */
  const dragSuppressClick = useRef(false);

  useEffect(() => {
    setFront((current) => Math.min(current, Math.max(0, deck.length - 1)));
  }, [deck.length]);

  useEffect(() => {
    resetCardFx(activeCardRef.current);
    setFlippedId(null);
  }, [front]);

  useEffect(() => {
    if (deck.length < 2 || paused) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = setInterval(() => setFront((current) => (current + 1) % deck.length), CYCLE_MS);
    return () => clearInterval(timer);
  }, [deck.length, paused]);

  if (deck.length === 0) {
    if (!snapshot) {
      return (
        <div className="flex flex-col items-center gap-3" data-testid="prize-stack">
          <Skeleton className="aspect-square w-56 rounded-lg" />
          <Skeleton className="h-4 w-40" />
        </div>
      );
    }

    return (
      <div className="anim-fade-up flex w-full max-w-2xl flex-col items-center px-3 text-center" data-testid="prize-stack">
        <div className="genesis-deck relative mb-7 h-48 w-48 sm:h-56 sm:w-56" aria-hidden>
          <div className="genesis-orbit absolute inset-0 rounded-full border border-dashed border-accent/25" />
          <div className="absolute inset-[14%] rotate-[-10deg] rounded-2xl border border-line-strong bg-panel/70 shadow-2xl" />
          <div className="absolute inset-[14%] rotate-[8deg] rounded-2xl border border-line bg-elevated/70 shadow-2xl" />
          <div className="absolute inset-[14%] grid place-items-center rounded-2xl border border-accent/35 bg-bg/90 shadow-2xl backdrop-blur">
            <div className="absolute inset-3 rounded-xl border border-dashed border-line" />
            <div className="flex flex-col items-center gap-2">
              <span className="grid size-11 place-items-center rounded-full border border-accent/30 bg-accent/10 text-lg text-accent">+</span>
              <span className="mlabel text-accent">GENESIS SLOT</span>
              <span className="num font-mono text-2xs text-mute">POOL / 000</span>
            </div>
          </div>
          <span className="absolute right-0 top-4 rounded-full border border-accent/25 bg-bg/90 px-2.5 py-1 text-2xs font-semibold text-accent shadow-lg">
            Deposits open
          </span>
        </div>
        <div className="mlabel mb-2 text-chain">HyperEVM testnet · genesis state</div>
        <h2 className="max-w-xl text-2xl font-semibold tracking-tight text-ink sm:text-[2rem] sm:leading-tight">
          The pool starts with one NFT.
        </h2>
        <p className="mt-2 max-w-lg text-sm leading-relaxed text-mute">
          No active position exists yet. Seed the testnet pool with an allowlisted NFT and HYPE backing; the first real
          card will replace this slot on-chain.
        </p>
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          <Link href="/deposit" className="btn3d btn3d--primary inline-flex h-10 items-center px-4 text-xs font-semibold">
            Seed the pool
          </Link>
          <a href="#mechanics" className="inline-flex h-10 items-center rounded-md border border-line px-4 text-xs font-semibold text-dim transition-colors hover:border-line-strong hover:text-ink">
            See how it works ↓
          </a>
        </div>
      </div>
    );
  }

  const activeFront = Math.min(front, deck.length - 1);
  const frontListing = deck[activeFront]!;
  const totalWeight = snapshot?.totalWeight ?? 0n;
  const frontSlot = rankSlot(activeFront);
  const visible = deck
    .map((listing, index) => ({ listing, index, relativeSlot: rankSlot(index) - frontSlot }))
    .filter(({ index, relativeSlot }) => index === activeFront || Math.abs(relativeSlot) <= VISIBLE_SIDE_SLOTS);

  function step(direction: -1 | 1) {
    setPaused(true);
    setFront((current) => (current + direction + deck.length) % deck.length);
  }

  /** Drag to browse. Hover must never change the card: the deck sits between
   *  the page and the buy panel, and cards flipping under a passing cursor
   *  makes the whole hero feel broken. */
  function onDragStart(event: PointerEvent<HTMLDivElement>) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startFront: front, moved: 0 };
    setPaused(true);
  }

  function onDragMove(event: PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.startX;
    drag.moved = Math.max(drag.moved, Math.abs(dx));
    // One card per ~96px of travel, dragging left advances forward.
    const steps = Math.trunc(-dx / 96);
    const next = (((drag.startFront + steps) % deck.length) + deck.length) % deck.length;
    setFront(next);
    setCursorPct(50 + Math.max(-40, Math.min(40, dx / 8)));
  }

  function onDragEnd(event: PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (drag && drag.pointerId === event.pointerId) {
      dragSuppressClick.current = drag.moved > 6;
      dragRef.current = null;
      // The click event fires right after pointerup; clear on the next tick.
      window.setTimeout(() => {
        dragSuppressClick.current = false;
      }, 0);
    }
    setCursorPct(50);
  }

  /** A drag that travelled must not also fire the card's click. */
  function consumedByDrag(): boolean {
    return dragSuppressClick.current;
  }

  return (
    <div
      className="flex w-full flex-col items-center"
      data-testid="prize-stack"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => {
        setPaused(false);
        setCursorPct(50);
      }}
      onFocus={() => setPaused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node)) setPaused(false);
      }}
    >
      <div
        className="hero-card-stage relative h-[20rem] w-full touch-pan-y overflow-x-clip sm:h-[26rem] lg:h-[min(30rem,57dvh)]"
        data-testid="hero-stage"
        data-front-index={activeFront}
        data-total={deck.length}
        role="group"
        tabIndex={0}
        aria-roledescription="carousel"
        aria-label={`${deck.length} active NFT positions. Use the arrow keys or drag to browse.`}
        style={{ cursor: dragRef.current ? "grabbing" : "grab" }}
        onPointerDown={onDragStart}
        onPointerMove={onDragMove}
        onPointerUp={onDragEnd}
        onPointerCancel={onDragEnd}
        onKeyDown={(event) => {
          if (event.key === "ArrowRight") {
            event.preventDefault();
            step(1);
          } else if (event.key === "ArrowLeft") {
            event.preventDefault();
            step(-1);
          }
        }}
      >
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-[8%] bottom-[8%] h-1/2 rounded-[50%] opacity-70 blur-3xl transition-[background] duration-300"
          style={{
            background: `radial-gradient(circle at ${cursorPct}% 65%, color-mix(in srgb, var(--hwa-secondary) 34%, transparent), transparent 38%)`,
          }}
        />

        {visible.map(({ listing, index, relativeSlot }) => {
          const distance = Math.abs(relativeSlot);
          const isFront = index === activeFront;
          const scale = isFront ? 1 : Math.max(0.68, 0.86 - distance * 0.07);
          const y = isFront ? 0 : Math.min(56, distance * distance * 4 + distance * 6);
          const rotation = isFront ? 0 : relativeSlot * 4.2;
          const tier = rarityFromOdds(listing.weight, totalWeight);
          const label = sanitizeLabel(listing.nft.name, `#${listing.tokenId}`);

          return (
            <button
              key={listing.id.toString()}
              type="button"
              data-testid={`hero-card-${listing.id.toString()}`}
              data-active={isFront ? "true" : "false"}
              data-flipped={isFront && flippedId === listing.id.toString() ? "true" : "false"}
              onClick={() => {
                if (consumedByDrag()) return;
                if (isFront) {
                  setPaused(true);
                  setFlippedId((current) => (current === listing.id.toString() ? null : listing.id.toString()));
                } else {
                  setFront(index);
                }
              }}
              tabIndex={isFront ? 0 : -1}
              aria-label={
                isFront
                  ? flippedId === listing.id.toString()
                    ? `Show artwork for ${label}`
                    : `Show on-card details for ${label}`
                  : `Focus ${label}`
              }
              className="absolute left-1/2 top-1/2 w-[clamp(10rem,28vw,18.5rem)] text-left transition-[transform,opacity,filter] duration-500 ease-[cubic-bezier(.22,1,.36,1)] will-change-transform"
              style={{
                zIndex: 100 - distance,
                transform: `translate(-50%, -50%) translateX(calc(${relativeSlot} * clamp(4.4rem, 10.5vw, 8.8rem))) translateY(${y}px) rotate(${rotation}deg) scale(${scale})`,
                opacity: isFront ? 1 : Math.max(0.32, 0.7 - distance * 0.13),
                // Side cards are depth, not content: blurring them stops their
                // labels competing with the front card for the eye.
                filter: isFront
                  ? "none"
                  : `blur(${(distance * 0.8).toFixed(1)}px) saturate(${Math.max(0.5, 0.9 - distance * 0.1)}) brightness(${Math.max(0.55, 0.88 - distance * 0.08)})`,
              }}
            >
              <div
                ref={isFront ? activeCardRef : undefined}
                data-fx-active="false"
                onPointerMove={isFront ? moveCardFx : undefined}
                onPointerLeave={isFront ? (event) => resetCardFx(event.currentTarget) : undefined}
                className={`hero-prize-card relative overflow-hidden rounded-xl border bg-panel ${
                  isFront ? "hero-prize-card--active" : ""
                } ${
                  isFront ? "border-accent/45" : "border-line-strong"
                } ${isFront && flippedId === listing.id.toString() ? "hero-card-is-flipped" : ""}`}
                style={{
                  boxShadow: isFront
                    ? "10px 16px 0 -8px color-mix(in srgb, var(--hwa-secondary) 72%, transparent), 0 32px 80px rgba(0,0,0,.62), 0 0 0 1px color-mix(in srgb, var(--hwa-accent) 38%, transparent), 0 0 34px color-mix(in srgb, var(--hwa-secondary) 32%, transparent)"
                    : "0 16px 34px rgba(0,0,0,.32)",
                }}
              >
                {isFront && (
                <div className="hero-card-header relative z-10 border-b border-line bg-inset/95 px-2.5 py-2">
                  <div className="flex items-center justify-between gap-2 text-3xs font-bold uppercase tracking-[0.12em] text-faint">
                    <span>
                      <span className="text-accent">#{index + 1}</span> · <span className="text-chain">HWA VERIFIED</span>
                    </span>
                    <span>{listing.isCrown ? "CROWN" : `RANK ${String(index + 1).padStart(2, "0")}`}</span>
                  </div>
                  <div className="mt-1 flex items-end justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-2xs font-semibold text-ink sm:text-xs">{label}</div>
                      <div className="truncate text-3xs text-mute">
                        {sanitizeLabel(listing.nft.collectionName, "Unknown collection")}
                      </div>
                    </div>
                    <span className="num shrink-0 font-mono text-3xs font-semibold text-dim">#{listing.id.toString()}</span>
                  </div>
                  {/* Two cells, not three: "1 in N" and the percentage are the
                      same fact, and three columns truncated the number. */}
                  <div className="mt-2 grid grid-cols-[1fr_auto] gap-2 border-t border-line-subtle pt-1.5 text-3xs uppercase tracking-wide text-faint">
                    <span>Backing <strong className="block truncate font-mono text-dim"><Hype wei={listing.backing} maxDecimals={2} /></strong></span>
                    <span className="text-right">
                      Chance
                      <strong className="block truncate font-mono" style={{ color: RARITY_COLOR[tier] }}>
                        {oddsOneIn(listing.weight, totalWeight)}
                      </strong>
                    </span>
                  </div>
                </div>
                )}
                <div className="hero-card-art relative z-0">
                  <NFTImage src={listing.nft.imageUrl} alt={isFront ? label : ""} rounded={false} />
                </div>
                <span aria-hidden className="hero-card-spectrum pointer-events-none absolute inset-0 z-20" />
                <span aria-hidden className="hero-card-texture pointer-events-none absolute inset-0 z-20" />
                <span aria-hidden className="hero-card-glare pointer-events-none absolute inset-0 z-20" />
                {listing.isCrown && (
                  <span className="absolute bottom-2 left-2 z-30 rounded-xs border border-gold/35 bg-bg/90 px-1.5 py-0.5 text-3xs font-bold text-gold backdrop-blur">
                    ♛ TOP DEPOSIT
                  </span>
                )}
                {isFront && (
                  <div className="hero-card-back-overlay absolute inset-0 z-40 flex flex-col overflow-hidden rounded-[inherit] border border-accent/30 bg-bg p-3 sm:p-4">
                    <div aria-hidden className="absolute inset-0 bg-[linear-gradient(125deg,rgba(216,255,82,.22),transparent_34%,rgba(80,210,193,.14)_54%,rgba(115,84,245,.30))]" />
                    <div aria-hidden className="dot-grid absolute inset-0 opacity-35" />
                    <div className="relative z-10 flex items-start justify-between gap-3 border-b border-white/10 pb-3">
                      <div className="min-w-0">
                        <div className="mlabel text-chain">HWA POSITION DATA</div>
                        <div className="mt-1 truncate text-sm font-semibold text-ink">{label}</div>
                        <div className="truncate text-2xs text-mute">{sanitizeLabel(listing.nft.collectionName, "Unknown collection")}</div>
                      </div>
                      <span className="num rounded-sm border border-accent/30 bg-accent/8 px-2 py-1 font-mono text-2xs text-accent">#{index + 1}</span>
                    </div>

                    <dl className="relative z-10 mt-3 space-y-2 text-2xs sm:mt-4 sm:space-y-2.5">
                      <CardDatum label="P/L" value={<Hype wei={listing.pendingFees} maxDecimals={3} signed className={listing.pendingFees > 0n ? "text-green" : "text-dim"} />} />
                      <CardDatum label="Backing" value={<Hype wei={listing.backing} maxDecimals={3} />} />
                      <CardDatum label="Odds" value={<span className="num font-mono" style={{ color: RARITY_COLOR[tier] }}>{formatOddsPercent(listing.weight, totalWeight)}</span>} />
                      <CardDatum label="Since" value={timeAgo(listing.listedAt)} />
                      <CardDatum label="Listing" value={<span className="num font-mono">#{listing.id.toString()}</span>} />
                      <CardDatum label="Depositor" value={<span className="num font-mono">{shortAddress(listing.depositor)}</span>} />
                    </dl>

                    <div className="relative z-10 mt-auto pt-3 text-center font-mono text-3xs uppercase tracking-[0.14em] text-mute">
                      Tap to flip back
                    </div>
                  </div>
                )}
                {isFront && (
                  <span
                    aria-hidden
                    className="pointer-events-none absolute inset-0 z-50 rounded-xl ring-1 ring-inset ring-accent/55"
                  />
                )}
              </div>
            </button>
          );
        })}
      </div>

      <div className="relative z-20 mt-3 flex w-full max-w-2xl flex-col items-center gap-3 px-3 text-center">
        <div className="flex items-center gap-3">
          <button
            type="button"
            aria-label="Previous listed NFT"
            onClick={() => step(-1)}
            className="grid size-7 place-items-center rounded-full border border-line bg-panel text-xs text-mute transition-colors hover:border-secondary/60 hover:text-secondary-readable"
          >
            ←
          </button>
          <div className="min-w-0" key={frontListing.id.toString()} aria-live="polite">
            <div className="anim-fade-up truncate text-md font-semibold text-ink">
              {sanitizeLabel(frontListing.nft.name, `#${frontListing.tokenId}`)}
            </div>
            <div className="mt-0.5 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-2xs text-mute">
              <span>{sanitizeLabel(frontListing.nft.collectionName, "Unknown collection")}</span>
              <span className="num font-mono"><Hype wei={frontListing.backing} maxDecimals={2} /> backing</span>
              <span className="num font-mono">{formatOddsPercent(frontListing.weight, totalWeight)} odds</span>
              <button
                type="button"
                onClick={() => onOpen(frontListing.id)}
                data-testid="hero-open-details"
                className="font-semibold text-accent hover:text-accent-hover"
              >
                Full details
              </button>
            </div>
          </div>
          <button
            type="button"
            aria-label="Next listed NFT"
            onClick={() => step(1)}
            className="grid size-7 place-items-center rounded-full border border-line bg-panel text-xs text-mute transition-colors hover:border-secondary/60 hover:text-secondary-readable"
          >
            →
          </button>
        </div>

        <div className="flex flex-col items-center gap-2">
          <div className="flex items-center gap-2 text-3xs uppercase tracking-wide text-faint">
            <span className="hidden sm:inline">Drag or use ← →</span>
            <span className="num font-mono text-mute" data-testid="hero-position">
              {String(activeFront + 1).padStart(2, "0")} / {String(deck.length).padStart(2, "0")}
            </span>
          </div>
          {deck.length <= 12 ? (
            <div className="flex items-center gap-1.5" role="tablist" aria-label="Choose a listed NFT">
              {deck.map((listing, index) => (
                <button
                  key={listing.id.toString()}
                  type="button"
                  role="tab"
                  aria-selected={index === activeFront}
                  aria-label={sanitizeLabel(listing.nft.name, `Position ${index + 1}`)}
                  onClick={() => {
                    setPaused(true);
                    setFront(index);
                  }}
                  className={`h-1.5 rounded-full transition-all duration-300 ${
                    index === activeFront ? "w-5 bg-accent" : "w-1.5 bg-control hover:bg-line-strong"
                  }`}
                />
              ))}
            </div>
          ) : (
            <span aria-hidden className="h-1 w-28 overflow-hidden rounded-full bg-control/80 ring-1 ring-inset ring-line sm:w-40">
              <span
                className="block h-full rounded-full bg-accent transition-[width] duration-300"
                style={{ width: `${((activeFront + 1) / deck.length) * 100}%` }}
              />
            </span>
          )}
        </div>

        {snapshot?.crown && (
          <button
            type="button"
            onClick={() => onOpen(snapshot.crown!.listingId)}
            data-testid="crown-card"
            className="mt-1 flex items-center gap-2.5 rounded-md border border-gold/30 bg-gold/8 px-3 py-1.5 text-2xs transition-colors hover:border-gold/60"
          >
            <span aria-hidden className="text-sm leading-none text-gold">♛</span>
            <span className="text-dim">
              Top deposit earns <span className="font-semibold text-gold">{(snapshot.crown.shareBps / 100).toFixed(0)}%</span>{" "}
              of every fee · pot{" "}
              <span className="num font-mono font-semibold text-gold">
                <Hype wei={snapshot.crown.pot} maxDecimals={2} unit={false} /> HYPE
              </span>
            </span>
          </button>
        )}
      </div>
    </div>
  );
}

function CardDatum({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-white/8 bg-black/20 px-2.5 py-2 backdrop-blur-sm">
      <dt className="text-mute">{label}</dt>
      <dd className="min-w-0 truncate font-semibold text-ink">{value}</dd>
    </div>
  );
}
