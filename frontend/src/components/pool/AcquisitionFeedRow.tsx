"use client";

import { sanitizeLabel, timeAgo } from "@/lib/format";
import type { Listing, SettlementOutcome } from "@/protocol/types";
import { Hype } from "@/components/ui/Hype";
import { NFTImage } from "@/components/nft/NFTImage";
import { RowChevron } from "./ListingCard";

/**
 * "Recent" feed row — a purchase, not a listing: what was acquired, for how
 * much, and how it settled. Mirrors the live product's acquisition feed.
 */
type Outcome = { label: string; className: string };

/** Not a SettlementOutcome — the state before one exists. */
const PENDING: Outcome = { label: "Pending claim", className: "text-amber bg-amber/12" };

/* Keyed by the union so a new SettlementOutcome fails the build instead of
   silently falling through to "Pending claim". */
const OUTCOME: Record<SettlementOutcome, Outcome> = {
  kept: { label: "NFT reward", className: "text-secondary-readable bg-secondary/14" },
  relisted: { label: "Relisted", className: "text-blue bg-blue/12" },
  bid_accepted: { label: "Bid accepted", className: "text-green bg-green/12" },
  bid_accepted_tokens: { label: "Bid as $HWA", className: "text-green bg-green/12" },
  depositor_reclaim_nft: { label: "Depositor took NFT", className: "text-mute bg-control" },
  depositor_reclaim_backing: { label: "Depositor took HYPE", className: "text-mute bg-control" },
  finalized: { label: "Finalized", className: "text-mute bg-control" },
};

export function AcquisitionFeedRow({
  listing,
  onOpen,
}: {
  listing: Listing;
  onOpen: (id: bigint) => void;
}) {
  const name = sanitizeLabel(listing.nft.name, `#${listing.tokenId}`);
  const outcome = listing.settlement ? OUTCOME[listing.settlement] : PENDING;
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

      <div className="size-11 overflow-hidden rounded-md ring-1 ring-line-subtle">
        <NFTImage src={listing.nft.imageUrl} alt="" rounded={false} />
      </div>

      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="mlabel truncate text-mute">{timeAgo(listing.allocatedAt ?? listing.listedAt)}</span>
        <span className="truncate text-md font-semibold leading-tight text-ink">{name}</span>
        <span className="truncate text-xs leading-tight text-mute">
          {sanitizeLabel(listing.nft.collectionName, "Unknown collection")}
        </span>
      </div>

      <div className="grid min-w-[6.5rem] justify-items-end gap-1 text-right sm:min-w-[8rem]">
        <Hype wei={listing.backing} maxDecimals={3} className="text-md font-semibold text-ink" />
        {listing.acquiredFor !== undefined && (
          <span className="num font-mono text-2xs text-mute">
            acquired <Hype wei={listing.acquiredFor} maxDecimals={4} unit={false} /> HYPE
          </span>
        )}
        <span className={`mlabel inline-flex items-center rounded-xs px-1.5 py-1 ${outcome.className}`}>
          {outcome.label}
        </span>
      </div>

      <RowChevron />
    </button>
  );
}
