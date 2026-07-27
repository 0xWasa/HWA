"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { sanitizeLabel, timeAgo } from "@/lib/format";
import type { PurchaseRecord } from "@/protocol/types";
import { HashLink } from "@/components/ui/HashLink";
import { Hype } from "@/components/ui/Hype";
import { Tag } from "@/components/ui/Tag";
import { NFTImage } from "@/components/nft/NFTImage";

type SortKey = "date" | "pl";
type Direction = "asc" | "desc";

const OUTCOME: Record<PurchaseRecord["outcome"], { label: string; tone: "neutral" | "accent" | "blue" | "amber" }> = {
  kept: { label: "Kept", tone: "accent" },
  relisted: { label: "Kept & relisted", tone: "accent" },
  bid_accepted: { label: "Sold back (HYPE)", tone: "blue" },
  bid_accepted_tokens: { label: "Sold back (HWA)", tone: "blue" },
  depositor_reclaim_nft: { label: "Depositor took NFT", tone: "amber" },
  depositor_reclaim_backing: { label: "Depositor took backing", tone: "amber" },
  finalized: { label: "Finalized", tone: "neutral" },
  allocated: { label: "Awaiting settlement", tone: "blue" },
  refunded: { label: "Refunded", tone: "amber" },
  pending: { label: "In flight", tone: "neutral" },
};

/**
 * Per-row P/L is only defined once a position was actually received: a pending
 * request has no outcome yet, and a refunded one returns the fee instead of a
 * position — neither is a loss, so both render as "—" rather than a number.
 */
function rowPL(r: PurchaseRecord): bigint | null {
  if (r.outcome === "pending" || r.outcome === "refunded") return null;
  // Without a position there is no backing to compare against, so backingReceived
  // would be a structural 0 and render as a loss that never happened.
  if (r.listingId === undefined) return null;
  return r.backingReceived - r.allInPaid;
}

function plClass(pl: bigint): string {
  if (pl > 0n) return "text-green";
  if (pl < 0n) return "text-red";
  return "text-dim";
}

const GRID =
  "grid grid-cols-[40px_minmax(0,1fr)] items-center gap-x-3 gap-y-1.5 px-3 " +
  "md:grid-cols-[40px_minmax(0,1.7fr)_66px_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,148px)]";

/** Numeric/meta cell: label-left card row on mobile, right-aligned column on desktop. */
const CELL = "col-span-2 flex items-center justify-between gap-2 md:col-span-1 md:justify-end";

/**
 * The per-cell label is visible on mobile and sr-only (not `hidden`) on desktop:
 * the desktop column headers are a separate grid row with no programmatic
 * association, so dropping these entirely would leave bare numbers unlabelled.
 */
const CELL_LABEL = "text-2xs text-mute md:sr-only";

export function PurchaseHistoryTable({ records }: { records: PurchaseRecord[] }) {
  const [sort, setSort] = useState<SortKey>("date");
  const [direction, setDirection] = useState<Direction>("desc");

  const sorted = useMemo(() => {
    const sign = direction === "desc" ? -1 : 1;
    return [...records].sort((a, b) => {
      if (sort === "date") return sign * (a.timestamp - b.timestamp);
      const pa = rowPL(a);
      const pb = rowPL(b);
      // Rows without a defined P/L always sink to the bottom, either direction.
      if (pa === null && pb === null) return b.timestamp - a.timestamp;
      if (pa === null) return 1;
      if (pb === null) return -1;
      if (pa === pb) return b.timestamp - a.timestamp;
      return pa < pb ? -sign : sign;
    });
  }, [records, sort, direction]);

  const toggle = (key: SortKey) => {
    if (key === sort) setDirection((d) => (d === "desc" ? "asc" : "desc"));
    else {
      setSort(key);
      setDirection("desc");
    }
  };

  const sortButton = (key: SortKey, label: string) => (
    <SortButton active={sort === key} direction={direction} onClick={() => toggle(key)} label={label} />
  );

  return (
    <div data-testid="purchase-history-table">
      {/* mobile sort bar — the desktop column headers are hidden below md */}
      <div className="flex items-center gap-2 border-b border-line-subtle px-3 py-2 md:hidden">
        <span className="mlabel text-mute">Sort</span>
        {sortButton("date", "Date")}
        {sortButton("pl", "P/L")}
      </div>

      <div className={`${GRID} hidden border-b border-line-subtle py-1.5 text-2xs uppercase tracking-wide text-mute md:grid`}>
        <span />
        <span>Position</span>
        <span className="text-right">{sortButton("date", "Age")}</span>
        <span className="text-right">All-in paid</span>
        <span className="text-right">Backing received</span>
        <span className="text-right">{sortButton("pl", "P/L")}</span>
        <span className="text-right">Outcome</span>
      </div>

      <ul className="divide-y divide-line-subtle">
        {sorted.map((r) => {
          const pl = rowPL(r);
          const outcome = OUTCOME[r.outcome];
          return (
            <li key={r.requestId.toString()} className={`${GRID} py-2.5`} data-testid={`purchase-${r.requestId}`}>
              <div className="size-10 shrink-0 overflow-hidden rounded-sm">
                <NFTImage src={r.nft?.imageUrl} alt="" rounded={false} />
              </div>

              <div className="min-w-0">
                <Link
                  href={`/acquisitions/${r.requestId.toString()}`}
                  className="block truncate text-xs font-medium text-ink hover:text-accent"
                  aria-label={`Open acquisition ${r.requestId.toString()}`}
                >
                  {sanitizeLabel(r.nft?.name, r.listingId ? `Position #${r.listingId}` : "No position")}
                </Link>
                <div className="truncate text-2xs text-mute">
                  {sanitizeLabel(r.nft?.collectionName, "Unknown collection")}
                  <span className="md:hidden"> · {timeAgo(r.timestamp)}</span>
                </div>
              </div>

              <div className="hidden text-right text-2xs text-mute md:block">{timeAgo(r.timestamp)}</div>

              <div className={CELL}>
                <span className={CELL_LABEL}>All-in paid</span>
                <Hype wei={r.allInPaid} maxDecimals={4} className="text-xs text-dim" unit={false} />
              </div>

              <div className={CELL}>
                <span className={CELL_LABEL}>Backing received</span>
                {r.listingId === undefined ? (
                  <span className="num font-mono text-xs text-mute">
                    <span aria-hidden>—</span>
                    <span className="sr-only">No position received.</span>
                  </span>
                ) : (
                  <Hype wei={r.backingReceived} maxDecimals={4} className="text-xs text-dim" unit={false} />
                )}
              </div>

              <div className={CELL}>
                <span className={CELL_LABEL}>P/L</span>
                {pl === null ? (
                  <span className="num font-mono text-xs text-mute">
                    <span aria-hidden>—</span>
                    <span className="sr-only">No position received, so there is no profit or loss to report.</span>
                  </span>
                ) : (
                  <Hype wei={pl} maxDecimals={4} signed className={`text-xs ${plClass(pl)}`} unit={false} />
                )}
              </div>

              <div className={CELL}>
                <span className={CELL_LABEL}>Outcome</span>
                <span className="flex min-w-0 items-center gap-2">
                  <Tag tone={outcome.tone}>{outcome.label}</Tag>
                  {r.txHash && <HashLink value={r.txHash} kind="tx" />}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function SortButton({
  active,
  direction,
  onClick,
  label,
}: {
  active: boolean;
  direction: Direction;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Sort by ${label}${active ? (direction === "desc" ? ", descending" : ", ascending") : ""}`}
      className={`inline-flex items-center gap-1 rounded-xs px-1 py-0.5 text-2xs uppercase tracking-wide transition-colors ${
        active ? "text-accent" : "text-mute hover:text-dim"
      }`}
    >
      {label}
      <span aria-hidden className={active ? "" : "opacity-0"}>
        {direction === "desc" ? "▾" : "▴"}
      </span>
    </button>
  );
}
