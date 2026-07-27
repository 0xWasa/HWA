"use client";

import { sanitizeLabel, timeAgo } from "@/lib/format";
import { formatOddsPercent } from "@/lib/units";
import type { Listing } from "@/protocol/types";
import { Hype } from "@/components/ui/Hype";
import { NFTImage } from "@/components/nft/NFTImage";
import { RarityTag } from "@/components/nft/RarityTag";
import { RowChevron, STATUS_LABEL } from "./ListingCard";

/**
 * fwa.fun sidebar feed row: [44px thumb | meta+name+collection | values | ›].
 */
export function FeedRow({
  listing,
  totalWeight,
  onOpen,
}: {
  listing: Listing;
  totalWeight: bigint;
  onOpen: (id: bigint) => void;
}) {
  const name = sanitizeLabel(listing.nft.name, `#${listing.tokenId}`);
  const inPool = listing.status === "active";
  return (
    <button
      onClick={() => onOpen(listing.id)}
      data-testid={`feed-row-${listing.id}`}
      className="anim-feed-item group relative grid w-full min-w-0 grid-cols-[2.75rem_minmax(0,1fr)_auto_0.875rem] items-center gap-2.5 border-b border-line-subtle px-3 py-2.5 text-left transition-colors duration-150 hover:border-line hover:bg-elevated/70 focus-visible:bg-elevated/70 sm:px-4"
    >
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-2 left-0 w-[3px] rounded-r-xs bg-secondary opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100"
      />

      <div className="relative size-11 overflow-hidden rounded-md ring-1 ring-line-subtle">
        <NFTImage src={listing.nft.imageUrl} alt="" rounded={false} />
        {listing.isCrown && (
          <span className="absolute left-0 top-0 rounded-br-sm bg-bg/85 px-1 text-2xs leading-4 text-amber backdrop-blur-sm">
            <span aria-hidden>♛</span>
            <span className="sr-only">Crown holder</span>
          </span>
        )}
      </div>

      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="mlabel truncate text-mute">
          #{listing.id.toString()} · {timeAgo(listing.listedAt)}
        </span>
        <span className="truncate text-md font-semibold leading-tight text-ink">{name}</span>
        <span className="truncate text-xs leading-tight text-mute">
          {sanitizeLabel(listing.nft.collectionName, "Unknown collection")}
        </span>
      </div>

      <div className="grid min-w-[6.5rem] justify-items-end gap-1 text-right sm:min-w-[8rem]">
        <Hype wei={listing.backing} maxDecimals={3} className="text-md font-semibold text-ink" />
        {/* Odds only mean something while the position is selectable; otherwise the
            slot carries the status in the same wording as the status chip. */}
        {inPool ? (
          <span className="num font-mono text-2xs text-mute">
            {formatOddsPercent(listing.weight, totalWeight)}
          </span>
        ) : (
          <span className="text-2xs text-mute">{STATUS_LABEL[listing.status]}</span>
        )}
        <RarityTag weight={listing.weight} totalWeight={totalWeight} />
      </div>

      <RowChevron />
    </button>
  );
}
