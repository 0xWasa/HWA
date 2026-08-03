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

/** Not a SettlementOutcome — the states before one exists. Labels are wording
    contracts shared with chips elsewhere; only the stamp frame is styled.
    An allocated row is simply inside its settlement window: calling that
    "Pending claim" read as money stuck, which it is not. PENDING is kept for
    the genuinely unknown case, a settled row whose outcome did not resolve. */
const AWAITING: Outcome = { label: "Awaiting settlement", className: "stamp stamp--blue" };
const PENDING: Outcome = { label: "Pending claim", className: "stamp stamp--amber" };

/* Keyed by the union so a new SettlementOutcome fails the build instead of
   silently falling through to "Pending claim". */
const OUTCOME: Record<SettlementOutcome, Outcome> = {
  kept: { label: "NFT reward", className: "stamp stamp--violet stamp--tilt-r" },
  relisted: { label: "Relisted", className: "stamp stamp--blue stamp--flat" },
  bid_accepted: { label: "Bid accepted", className: "stamp stamp--green stamp--tilt-r" },
  bid_accepted_tokens: { label: "Bid as $HWA", className: "stamp stamp--green" },
  depositor_reclaim_nft: { label: "Depositor took NFT", className: "stamp stamp--flat" },
  depositor_reclaim_backing: { label: "Depositor took HYPE", className: "stamp stamp--flat" },
  finalized: { label: "Finalized", className: "stamp stamp--flat" },
};

export function AcquisitionFeedRow({
  listing,
  onOpen,
}: {
  listing: Listing;
  onOpen: (id: bigint) => void;
}) {
  const name = sanitizeLabel(listing.nft.name, `#${listing.tokenId}`);
  const outcome = listing.settlement
    ? OUTCOME[listing.settlement]
    : listing.status === "allocated"
      ? AWAITING
      : PENDING;
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
        <span className={outcome.className}>{outcome.label}</span>
      </div>

      <RowChevron />
    </button>
  );
}
