"use client";

import { useState, type ReactNode } from "react";
import { sanitizeLabel, shortAddress } from "@/lib/format";
import { formatOddsPercent, oddsOneIn } from "@/lib/units";
import type { AcquisitionTicket, Listing, PoolSnapshot } from "@/protocol/types";
import { useAccountState } from "@/protocol/provider";
import { Button } from "@/components/ui/Button";
import { Hype } from "@/components/ui/Hype";
import { NFTImage } from "@/components/nft/NFTImage";
import { InlineSettlementPanel } from "@/components/positions/InlineSettlementPanel";
import { SharePurchaseModal } from "./SharePurchaseModal";

export function PurchaseResultSurface({
  listing,
  ticket,
  snapshot,
  onClose,
  onNext,
  batchLabel,
  animated = false,
}: {
  listing: Listing;
  ticket?: AcquisitionTicket;
  snapshot?: PoolSnapshot;
  onClose?: () => void;
  onNext?: () => void;
  batchLabel?: string;
  /** Pack-opening choreography (reveal overlay only — the permalink route
      renders the same surface statically and stays idempotent). */
  animated?: boolean;
}) {
  const account = useAccountState();
  const [shareOpen, setShareOpen] = useState(false);
  const name = sanitizeLabel(listing.nft.name, `NFT #${listing.tokenId}`);
  const collection = sanitizeLabel(listing.nft.collectionName, "Unknown collection");
  const reconstructedWeight = snapshot && listing.status === "allocated"
    ? snapshot.totalWeight + listing.weight
    : snapshot?.totalWeight;
  const totalWeight = reconstructedWeight && reconstructedWeight > 0n ? reconstructedWeight : undefined;
  const paid = ticket ? ticket.feePaid + ticket.serviceFeePaid : listing.acquiredFor;
  const pl = paid !== undefined ? listing.backing - paid : null;
  const awaitingChoice = listing.status === "allocated";

  return (
    <div className="w-full" data-testid="purchase-result-surface">
      <div className="grid gap-8 lg:grid-cols-[minmax(18rem,0.78fr)_minmax(0,1.22fr)] lg:gap-12">
        <div className="flex flex-col items-center lg:sticky lg:top-6 lg:self-start">
          <div className={`relative w-full max-w-[24rem] ${animated ? "anim-reveal-burst" : ""}`}>
            <div aria-hidden className="absolute -inset-12 rounded-full bg-secondary/18 blur-3xl" />
            <div className="relative overflow-hidden rounded-2xl border border-accent/40 bg-panel shadow-[12px_16px_0_-8px_color-mix(in_srgb,var(--hwa-secondary)_72%,transparent),0_38px_90px_rgba(0,0,0,.62)]">
              <div className="border-b border-line bg-inset/95 px-4 py-3">
                <div className="flex items-center justify-between gap-3 font-mono text-3xs uppercase tracking-[0.13em] text-faint">
                  <span><span className="text-accent">HWA</span> · VERIFIED DRAW</span>
                  <span>GRADE <strong className="text-ink">{listing.isCrown ? "CROWN" : "10"}</strong></span>
                </div>
                <div className="mt-2 flex items-end justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-ink">{name}</div>
                    <div className="truncate text-2xs text-mute">{collection}</div>
                  </div>
                  <span className="num font-mono text-2xs text-dim">#{listing.tokenId.toString()}</span>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-3 border-t border-line-subtle pt-2 font-mono text-3xs uppercase tracking-wide text-faint">
                  <span>Backing<strong className="mt-0.5 block text-dim"><Hype wei={listing.backing} maxDecimals={3} /></strong></span>
                  <span>Class<strong className="mt-0.5 block text-chain">NFT reward</strong></span>
                  <span>Odds<strong className="mt-0.5 block text-accent">{totalWeight ? formatOddsPercent(listing.weight, totalWeight) : "recorded"}</strong></span>
                </div>
              </div>
              <NFTImage src={listing.nft.imageUrl} alt={name} rounded={false} />
              <span aria-hidden className="hero-card-spectrum pointer-events-none absolute inset-0 opacity-30" />
            </div>
          </div>

          <div className="mt-5 flex w-full max-w-[24rem] gap-2">
            <Button variant="secondary" className="flex-1" onClick={() => setShareOpen(true)} data-testid="open-share-purchase">
              Share draw
            </Button>
            {onClose && (
              <Button variant="ghost" className="flex-1" onClick={onClose}>
                Keep browsing
              </Button>
            )}
          </div>
        </div>

        <div className={`min-w-0 ${animated ? "reveal-cascade" : ""}`}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              {batchLabel && <div className="mlabel mb-2 text-secondary-readable">{batchLabel}</div>}
              <h1 className="purchase-success-gradient text-4xl font-extrabold tracking-tight sm:text-5xl">
                {awaitingChoice ? "Purchase Successful" : "Acquisition Result"}
              </h1>
              <h2 className="mt-2 text-2xl font-semibold text-ink sm:text-3xl">{name}</h2>
              <p className="num mt-2 font-mono text-2xs text-mute">
                {listing.collection} · token #{listing.tokenId.toString()}
              </p>
            </div>
            {onNext && (
              <Button variant="violet" onClick={onNext} data-testid="reveal-next">Next position →</Button>
            )}
          </div>

          <dl className="mt-7 divide-y divide-line-subtle border-y border-line-subtle">
            <ResultRow label="Backing" value={<Hype wei={listing.backing} maxDecimals={4} />} />
            <ResultRow label="Pool odds" value={totalWeight ? `${formatOddsPercent(listing.weight, totalWeight)} · ${oddsOneIn(listing.weight, totalWeight)}` : "Recorded on-chain"} />
            {paid !== undefined && <ResultRow label="All-in paid" value={<Hype wei={paid} maxDecimals={4} />} />}
            {pl !== null && <ResultRow label="Position P/L" value={<Hype wei={pl} maxDecimals={4} signed className={pl >= 0n ? "text-green" : "text-red"} />} />}
            <ResultRow label="Token" value={`#${listing.tokenId.toString()}`} />
            <ResultRow label="Listing" value={`#${listing.id.toString()}`} />
            <ResultRow label="Depositor" value={<span className="num font-mono">{shortAddress(listing.depositor, 6)}</span>} />
            {ticket && <ResultRow label="Request" value={<span className="num font-mono">#{ticket.requestId.toString()} · sequence {ticket.sequence.toString()}</span>} />}
          </dl>

          <div className="mt-7">
            <InlineSettlementPanel listing={listing} />
          </div>
        </div>
      </div>

      <SharePurchaseModal
        open={shareOpen}
        listing={listing}
        requestId={ticket?.requestId}
        paid={paid}
        totalWeight={totalWeight}
        wallet={account.address}
        onClose={() => setShareOpen(false)}
      />
    </div>
  );
}

function ResultRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="grid grid-cols-[8rem_minmax(0,1fr)] gap-4 py-3 text-sm sm:grid-cols-[10rem_minmax(0,1fr)]">
      <dt className="text-mute">{label}</dt>
      <dd className="min-w-0 break-words font-semibold text-ink">{value}</dd>
    </div>
  );
}
