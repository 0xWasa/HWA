"use client";

import { fullDate, sanitizeLabel, shortAddress, timeAgo } from "@/lib/format";
import { formatOddsPercent, oddsOneIn } from "@/lib/units";
import { useAccountState } from "@/protocol/provider";
import type { PoolSnapshot } from "@/protocol/types";
import { useListing } from "@/state/queries";
import { Drawer } from "@/components/ui/Drawer";
import { Hype } from "@/components/ui/Hype";
import { Skeleton } from "@/components/ui/Skeleton";
import { NFTImage } from "@/components/nft/NFTImage";
import { RarityTag } from "@/components/nft/RarityTag";
import { statusTag } from "./ListingCard";

/** Deep-linkable listing detail (?listing=<id>). */
export function ListingDetailDrawer({
  listingId,
  snapshot,
  onClose,
}: {
  listingId: bigint | null;
  snapshot?: PoolSnapshot;
  onClose: () => void;
}) {
  const { data: listing, isLoading } = useListing(listingId);
  const account = useAccountState();
  const totalWeight = snapshot?.totalWeight ?? 0n;

  return (
    <Drawer
      open={listingId !== null}
      onClose={onClose}
      title={
        listing ? (
          <span className="flex items-center gap-2">
            {sanitizeLabel(listing.nft.name, `Listing #${listing.id}`)}
            {statusTag(listing)}
          </span>
        ) : (
          "Listing"
        )
      }
    >
      {isLoading || !listing ? (
        <div className="space-y-3 p-4">
          <Skeleton className="aspect-square w-full" />
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-3 w-1/2" />
        </div>
      ) : (
        <div className="space-y-4 p-4" data-testid="listing-detail">
          <div className="mx-auto max-w-[340px]">
            <NFTImage src={listing.nft.imageUrl} alt={sanitizeLabel(listing.nft.name, `#${listing.tokenId}`)} />
          </div>

          <div className="flex items-center justify-between">
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-ink">
                {sanitizeLabel(listing.nft.name, `#${listing.tokenId}`)}
              </div>
              <div className="truncate text-xs text-mute">
                {sanitizeLabel(listing.nft.collectionName, "Unknown collection")} ·{" "}
                <span className="num font-mono">#{listing.tokenId.toString()}</span>
              </div>
            </div>
            <RarityTag weight={listing.weight} totalWeight={totalWeight} />
          </div>

          <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-line bg-line-subtle">
            {[
              ["Backing", <Hype key="b" wei={listing.backing} />],
              [
                "Selection odds",
                listing.status === "active" ? (
                  <span key="o" title={oddsOneIn(listing.weight, totalWeight)}>
                    {formatOddsPercent(listing.weight, totalWeight)}
                  </span>
                ) : (
                  "—"
                ),
              ],
              ["Listing ID", <span key="i" className="num font-mono">#{listing.id.toString()}</span>],
              ["Listed", <span key="t" title={fullDate(listing.listedAt)}>{timeAgo(listing.listedAt)}</span>],
              ["Depositor", <span key="d" className="num font-mono">{shortAddress(listing.depositor)}</span>],
              [
                "Weight",
                <span key="w" className="num font-mono" title="1e36 / backing">
                  {listing.weight.toString().length > 12
                    ? `${listing.weight.toString().slice(0, 6)}…e${listing.weight.toString().length - 1}`
                    : listing.weight.toString()}
                </span>,
              ],
            ].map(([label, value], i) => (
              <div key={i} className="bg-panel p-2.5">
                <div className="text-2xs uppercase tracking-wide text-mute">{label}</div>
                <div className="mt-0.5 text-sm text-ink">{value}</div>
              </div>
            ))}
          </dl>

          {listing.isCrown && (
            <div className="rounded-md border border-amber/30 bg-amber/8 p-2.5 text-xs text-amber">
              ♛ This is the current top deposit. It receives a share of every distributed fee into its pot until it is
              allocated, withdrawn or beaten by a 10% larger deposit.
            </div>
          )}

          {listing.status === "active" && (
            <p className="text-2xs leading-snug text-mute">
              Acquisitions draw a <strong className="text-dim">random</strong> position from the whole pool — this
              specific NFT cannot be purchased directly. Its odds above are the chance per single acquisition.
            </p>
          )}

          {listing.status === "allocated" && (
            <div className="rounded-md border border-blue/30 bg-blue/8 p-2.5 text-xs text-blue">
              Allocated to <span className="num font-mono">{shortAddress(listing.purchaser ?? "")}</span>
              {listing.purchaser === account.address && " — that's you. Settle it from My Positions."}
            </div>
          )}

          {account.address === listing.depositor && (listing.status === "active" || listing.status === "staged") && (
            <a
              href="/positions"
              className="block rounded-sm border border-line bg-control p-2.5 text-center text-xs font-medium text-dim hover:text-ink"
            >
              Manage this deposit in My Positions →
            </a>
          )}
        </div>
      )}
    </Drawer>
  );
}
