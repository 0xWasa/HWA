"use client";

import { sanitizeLabel } from "@/lib/format";
import type { AcquisitionTicket, Listing } from "@/protocol/types";
import { useListing } from "@/state/queries";
import { Hype } from "@/components/ui/Hype";
import { NFTImage } from "@/components/nft/NFTImage";
import { env } from "@/config/env";
import { randomnessSecurityBufferSec } from "@/protocol/params";

const TICKET_STEPS: { key: AcquisitionTicket["phase"][]; label: string }[] = [
  { key: ["requested"], label: "Requested" },
  { key: ["randomness_pending"], label: "Randomness" },
  { key: ["randomness_cached", "processing"], label: "Processing" },
  { key: ["allocated"], label: "Revealed" },
];

/** Acquisition request tracker: request → randomness → ordered processing → reveal. */
export function TicketProgress({ ticket }: { ticket: AcquisitionTicket }) {
  const { data: listing } = useListing(ticket.phase === "allocated" ? (ticket.listingId ?? null) : null);
  const failed = ["expired", "refunded", "timed_out"].includes(ticket.phase);
  const stepIdx = failed ? -1 : TICKET_STEPS.findIndex((s) => s.key.includes(ticket.phase));
  const longWait =
    ticket.phase === "randomness_pending" &&
    Date.now() / 1000 - ticket.requestedAt > randomnessSecurityBufferSec(env.chainId) + 15;

  return (
    <div
      className="rounded-sm border border-line-subtle bg-inset p-2"
      data-testid={`ticket-${ticket.requestId}`}
      data-phase={ticket.phase}
    >
      <div className="mb-1.5 flex items-center justify-between text-2xs">
        <span className="num font-mono text-mute">req #{ticket.requestId.toString()}</span>
        <span className="num font-mono text-faint">seq {ticket.sequence.toString()}</span>
      </div>

      {!failed ? (
        <>
          <div className="flex items-center gap-1">
            {TICKET_STEPS.map((s, i) => {
              const reached = stepIdx >= i || ticket.phase === "allocated";
              const current = stepIdx === i && ticket.phase !== "allocated";
              return (
                <div key={s.label} className="flex flex-1 flex-col gap-1">
                  <div
                    className={`h-[3px] rounded-full ${reached ? "bg-green" : "bg-control"} ${current ? "anim-pulse" : ""}`}
                  />
                  <span className={`text-3xs leading-none ${reached ? "text-green" : "text-faint"}`}>{s.label}</span>
                </div>
              );
            })}
          </div>
          {longWait && (
            <p className="mt-1.5 text-2xs leading-snug text-amber">
              Randomness is taking longer than usual. If the word misses its deadline (block{" "}
              <span className="num font-mono">{ticket.wordDeadlineBlock?.toString() ?? "—"}</span>), the request expires
              and your fee is credited as a refund.
            </p>
          )}
          {ticket.phase === "allocated" && listing && <RevealCard listing={listing} requestId={ticket.requestId} />}
        </>
      ) : (
        <div className="rounded-xs border border-amber/30 bg-amber/8 p-1.5 text-2xs">
          <span className="font-semibold text-amber">
            {ticket.phase === "expired" ? "Expired — word missed its deadline." : "Refunded."}
          </span>{" "}
          <span className="text-dim">
            {ticket.refund !== undefined && (
              <>
                <Hype wei={ticket.refund} maxDecimals={4} /> credited — withdraw it from My Positions → Refunds.
              </>
            )}
          </span>
        </div>
      )}
    </div>
  );
}

function RevealCard({ listing, requestId }: { listing: Listing; requestId: bigint }) {
  const name = sanitizeLabel(listing.nft.name, `#${listing.tokenId}`);
  return (
    <div
      className="anim-reveal mt-2 flex items-center gap-2.5 rounded-sm border border-secondary/45 bg-secondary-deep/55 p-2"
      data-testid="reveal-card"
    >
      <div className="size-12 shrink-0 overflow-hidden rounded-xs">
        <NFTImage src={listing.nft.imageUrl} alt={name} rounded={false} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs font-semibold text-secondary-readable">{name}</div>
        <div className="truncate text-2xs text-dim">{sanitizeLabel(listing.nft.collectionName, "Unknown collection")}</div>
        <div className="text-2xs text-mute">
          backing <Hype wei={listing.backing} maxDecimals={3} />
        </div>
      </div>
      <a
        href={`/acquisitions/${requestId.toString()}`}
        className="shrink-0 rounded-sm border border-accent/50 px-2 py-1 text-2xs font-medium text-accent hover:bg-accent/10"
      >
        Result →
      </a>
    </div>
  );
}
