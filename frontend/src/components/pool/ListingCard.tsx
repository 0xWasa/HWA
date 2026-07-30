"use client";

import { sanitizeLabel, timeAgo } from "@/lib/format";
import { formatOddsPercent, oddsOneIn } from "@/lib/units";
import { RARITY_COLOR, rarityFromOdds } from "@/protocol/rarity";
import type { Listing, ListingStatus } from "@/protocol/types";
import { NFTImage } from "@/components/nft/NFTImage";
import { RarityTag } from "@/components/nft/RarityTag";
import { Hype } from "@/components/ui/Hype";
import { Tag } from "@/components/ui/Tag";

/** Single source of truth for status wording — chips and text slots must agree. */
export const STATUS_LABEL: Record<ListingStatus, string> = {
  staged: "Staged",
  active: "In pool",
  allocated: "Allocated",
  settled: "Settled",
  withdrawn: "Withdrawn",
};

export function statusTag(listing: Listing) {
  switch (listing.status) {
    case "staged":
      return <Tag tone="amber">{STATUS_LABEL.staged}</Tag>;
    case "active":
      return null; // active is the default — visual silence
    case "allocated":
      return <Tag tone="blue">{STATUS_LABEL.allocated}</Tag>;
    case "settled":
      return <Tag tone="neutral">{STATUS_LABEL.settled}</Tag>;
    case "withdrawn":
      return <Tag tone="neutral">{STATUS_LABEL.withdrawn}</Tag>;
  }
}

/** "Opens a detail view" affordance — shared by every clickable pool row. */
export function RowChevron({ className = "" }: { className?: string }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
      className={`shrink-0 text-faint transition-[color,transform] duration-200 group-hover:translate-x-0.5 group-hover:text-accent group-focus-visible:text-accent ${className}`}
    >
      <path d="M9 5l7 7-7 7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Amber ♛ mark. Never hover-only: the glyph is decorative, the label is read. */
function CrownGlyph({ className = "" }: { className?: string }) {
  return (
    <span className={`shrink-0 ${className}`}>
      <span aria-hidden className="text-amber">
        ♛
      </span>
      <span className="sr-only">Crown holder — earns the crown pot</span>
    </span>
  );
}

/* Row and header share one template so the columns can never drift apart.
   Narrow widths drop whole columns (1-in-N, then odds + age) rather than
   shrinking type below 12px. */
const ROW_GRID =
  "grid-cols-[44px_minmax(0,1fr)_104px_18px] sm:grid-cols-[44px_minmax(0,1fr)_104px_76px_64px_18px] lg:grid-cols-[44px_minmax(0,1fr)_104px_84px_76px_64px_18px]";

/** Column header for the list view — must sit directly above <ListingRow>. */
export function ListingRowHeader() {
  return (
    <div
      className={`grid ${ROW_GRID} items-center gap-3 border-b border-line bg-elevated/40 px-3 py-2 sm:px-4`}
    >
      <span />
      <span className="mlabel uppercase text-mute">Position</span>
      <span className="mlabel text-right uppercase text-mute">Backing</span>
      <span className="mlabel hidden text-right uppercase text-mute lg:block">1-in-N</span>
      <span className="mlabel hidden text-right uppercase text-mute sm:block">Odds</span>
      <span className="mlabel hidden text-right uppercase text-mute sm:block">Age</span>
      <span />
    </div>
  );
}

/** Grid card — image-first, data-tight. */
export function ListingCard({
  listing,
  totalWeight,
  onOpen,
}: {
  listing: Listing;
  totalWeight: bigint;
  onOpen: (id: bigint) => void;
}) {
  const name = sanitizeLabel(listing.nft.name, `${sanitizeLabel(listing.nft.collectionName, "Unknown")} #${listing.tokenId}`);
  const inPool = listing.status === "active";
  const status = statusTag(listing);
  const rarityInk = RARITY_COLOR[rarityFromOdds(listing.weight, totalWeight)];
  return (
    <button
      onClick={() => onOpen(listing.id)}
      data-testid={`listing-card-${listing.id}`}
      className="card group relative overflow-hidden p-2 text-left"
    >
      {/* Hover/focus treatment lives on an overlay: `.card` is unlayered CSS and
          would win over utility-level border/shadow overrides. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-lg ring-1 ring-transparent transition-[box-shadow,background-color] duration-200 group-hover:bg-ink/[0.025] group-hover:ring-line-strong group-focus-visible:ring-accent"
      />
      {/* Rarity rail — the card-game frame leaking into the terminal grid. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-[2.5px] opacity-55 transition-opacity duration-200 group-hover:opacity-100"
        style={{ background: `linear-gradient(90deg, transparent, ${rarityInk}, transparent)` }}
      />

      <div className="relative overflow-hidden rounded-md">
        {/* Decorative: the name is read from the text below, so alt="" keeps the
            button's accessible name from repeating it. */}
        <NFTImage
          src={listing.nft.imageUrl}
          alt=""
          rounded={false}
          className="transition-transform duration-300 ease-[var(--ease-swift)] group-hover:scale-[1.04]"
        />
        {listing.isCrown && (
          <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-sm bg-bg/85 px-1.5 py-1 text-2xs font-semibold uppercase leading-none tracking-wide text-ink ring-1 ring-amber/45 backdrop-blur-sm">
            <CrownGlyph />
            Crown
          </span>
        )}
        {status && <span className="absolute right-2 top-2">{status}</span>}
      </div>

      <div className="relative px-1 pb-0.5 pt-2.5">
        <div className="flex items-start justify-between gap-2">
          <span className="min-w-0 flex-1 truncate text-base font-medium text-ink">{name}</span>
          <RarityTag weight={listing.weight} totalWeight={totalWeight} />
        </div>
        <div className="mt-0.5 truncate text-xs text-mute">
          {sanitizeLabel(listing.nft.collectionName, "Unknown collection")}
        </div>

        <div className="card-inset mt-2.5 grid grid-cols-2 gap-2 p-2">
          <div className="min-w-0">
            <div className="mlabel uppercase text-mute">Backing</div>
            <Hype wei={listing.backing} className="mt-1 block truncate text-sm text-ink" />
          </div>
          <div className="min-w-0 text-right">
            <div className="mlabel uppercase text-mute">Odds</div>
            <div
              className="num mt-1 truncate font-mono text-sm text-dim"
              title={inPool ? oddsOneIn(listing.weight, totalWeight) : undefined}
            >
              {inPool ? formatOddsPercent(listing.weight, totalWeight) : "—"}
            </div>
          </div>
        </div>

        <div className="mt-2 flex items-center justify-between gap-2 text-xs text-mute">
          <span className="num font-mono">#{listing.id.toString()}</span>
          <span>{timeAgo(listing.listedAt)}</span>
        </div>
      </div>
    </button>
  );
}

/** List row — tabular, comparison-friendly. */
export function ListingRow({
  listing,
  totalWeight,
  onOpen,
}: {
  listing: Listing;
  totalWeight: bigint;
  onOpen: (id: bigint) => void;
}) {
  const name = sanitizeLabel(listing.nft.name, `${sanitizeLabel(listing.nft.collectionName, "Unknown")} #${listing.tokenId}`);
  const inPool = listing.status === "active";
  const rarityInk = RARITY_COLOR[rarityFromOdds(listing.weight, totalWeight)];
  return (
    <button
      onClick={() => onOpen(listing.id)}
      data-testid={`listing-row-${listing.id}`}
      className={`group relative grid w-full ${ROW_GRID} items-center gap-3 border-b border-line-subtle px-3 py-2.5 text-left transition-colors duration-150 last:border-b-0 hover:border-line hover:bg-elevated/70 focus-visible:bg-elevated/70 sm:px-4`}
    >
      {/* Persistent rarity rail; brightens under the pointer. Never reflows. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-2 left-0 w-[3px] rounded-r-xs opacity-40 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100"
        style={{ background: rarityInk }}
      />

      <div className="size-11 overflow-hidden rounded-md ring-1 ring-line-subtle">
        <NFTImage src={listing.nft.imageUrl} alt="" rounded={false} />
      </div>

      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-1.5">
          {listing.isCrown && <CrownGlyph className="text-sm leading-none" />}
          <span className="truncate text-base font-medium text-ink">{name}</span>
        </div>
        <div className="mt-1 flex min-w-0 items-center gap-1.5">
          <span className="min-w-0 truncate text-xs text-mute">
            {sanitizeLabel(listing.nft.collectionName, "Unknown collection")}
          </span>
          <RarityTag weight={listing.weight} totalWeight={totalWeight} />
          {statusTag(listing)}
        </div>
      </div>

      <div className="truncate text-right">
        <Hype wei={listing.backing} className="text-sm text-ink" />
      </div>
      <div className="num hidden truncate text-right font-mono text-sm text-mute lg:block">
        {inPool ? oddsOneIn(listing.weight, totalWeight) : "—"}
      </div>
      <div className="num hidden truncate text-right font-mono text-sm text-dim sm:block">
        {inPool ? formatOddsPercent(listing.weight, totalWeight) : "—"}
      </div>
      <div className="hidden truncate text-right text-xs text-mute sm:block">{timeAgo(listing.listedAt)}</div>

      <div className="flex justify-end">
        <RowChevron />
      </div>
    </button>
  );
}
