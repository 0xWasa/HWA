"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { sanitizeLabel, timeAgo } from "@/lib/format";
import { formatHwa, formatHype } from "@/lib/units";
import type { ActivityItem, ActivityType } from "@/protocol/types";
import { useActivity, useCollections } from "@/state/queries";
import { Hype } from "@/components/ui/Hype";
import { Tag } from "@/components/ui/Tag";

/**
 * Bottom activity strip — the calm, always-there pulse of the protocol.
 *
 * Real indexer events only: it renders nothing while loading and nothing when
 * the feed is empty, so it can never flash placeholder motion at the bottom of
 * the viewport. Hidden below `lg` (the mobile purchase CTA owns that space) and
 * kept under z-50 so drawers, the tx dock and the terms gate stay above it.
 *
 * Accessibility contract: the moving track is ambient — clickable, but neither
 * focusable nor announced. Keyboard and screen-reader users get the same events
 * as a real table one static link away (/activity), plus a Hide control that
 * satisfies "pause, stop, hide". Under `prefers-reduced-motion` the track stops
 * moving and its rows become ordinary focusable links.
 */

const KEY = "hwa.ticker.hidden";
const LIMIT = 24;
/** Enough items to fill a wide viewport before the loop repeats. */
const MIN_TRACK_ITEMS = 8;

type Tone = "neutral" | "accent" | "red" | "amber" | "blue";

/** Same vocabulary as the Activity page — the ticker never renames events. */
const PRESENTATION: Record<ActivityType, { label: string; tone: Tone }> = {
  deposit: { label: "Deposit", tone: "accent" },
  activation: { label: "Activated", tone: "neutral" },
  withdraw_listing: { label: "Withdrawn", tone: "neutral" },
  backing_update: { label: "Backing updated", tone: "neutral" },
  acquisition_request: { label: "Acquisition", tone: "blue" },
  randomness_cached: { label: "Randomness", tone: "neutral" },
  allocation: { label: "Allocated", tone: "accent" },
  keep: { label: "NFT kept", tone: "accent" },
  relist: { label: "Relisted", tone: "blue" },
  bid_accepted: { label: "Bid accepted", tone: "amber" },
  bid_accepted_tokens: { label: "Bid → HWA", tone: "amber" },
  depositor_resolved: { label: "Depositor resolved", tone: "neutral" },
  finalized: { label: "Finalized", tone: "neutral" },
  acquisition_refund: { label: "Refund", tone: "amber" },
  earnings_withdraw: { label: "Earnings", tone: "neutral" },
  earnings_accrued: { label: "Earnings accrued", tone: "neutral" },
  reward_claim: { label: "Reward claim", tone: "accent" },
  crown_set: { label: "New crown", tone: "amber" },
  crown_funded: { label: "Crown funded", tone: "amber" },
  crown_settled: { label: "Crown paid", tone: "amber" },
  config_set: { label: "Config changed", tone: "neutral" },
  collection_whitelist: { label: "Collection updated", tone: "neutral" },
  fees_paid_out: { label: "Fees paid", tone: "neutral" },
  protocol_fees_to_token: { label: "Fees to HWA", tone: "blue" },
  delivery_failed: { label: "Delivery failed", tone: "red" },
  stuck_recovered: { label: "NFT recovered", tone: "accent" },
};

export function ActivityTicker() {
  // Assume hidden until the session flag has actually been read: avoids both a
  // hydration mismatch and a strip that pops in and out on every navigation.
  const [hidden, setHidden] = useState(true);
  const reducedMotion = usePrefersReducedMotion();

  useEffect(() => {
    try {
      setHidden(window.sessionStorage.getItem(KEY) === "1");
    } catch {
      setHidden(false);
    }
  }, []);

  const { data: page } = useActivity({ scope: "global", limit: LIMIT });
  const { data: collections } = useCollections();

  const names = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of collections ?? []) map.set(c.address.toLowerCase(), c.name);
    return map;
  }, [collections]);

  const items = useMemo(() => page?.items ?? [], [page]);

  // The marquee translates by -50%, so the track must be two identical halves.
  // Short feeds repeat inside each half instead of leaving a gap mid-loop.
  const half = useMemo(() => {
    if (items.length === 0) return [];
    const reps = Math.max(1, Math.ceil(MIN_TRACK_ITEMS / items.length));
    return Array.from({ length: reps }, () => items).flat();
  }, [items]);

  if (hidden || items.length === 0) return null;

  const dismiss = () => {
    setHidden(true);
    try {
      window.sessionStorage.setItem(KEY, "1");
    } catch {
      // Private-mode storage failure only costs the preference, not the action.
    }
  };

  return (
    <aside
      aria-label="Recent protocol activity"
      data-testid="activity-ticker"
      className="fixed inset-x-0 bottom-0 z-30 hidden h-9 border-t border-line bg-bg/92 backdrop-blur-md lg:block"
    >
      <div className="flex h-9 items-stretch">
        <span className="mlabel flex shrink-0 items-center gap-1.5 pl-4 pr-3 text-mute">
          <span aria-hidden className="anim-ping relative size-1.5 rounded-full bg-chain text-chain" />
          ACTIVITY
        </span>

        {/* `clip`, not `hidden`: a hidden box is still programmatically scrollable, so
            any scroll-into-view would offset the loop and tear a gap in the track. */}
        <div className="relative min-w-0 flex-1 overflow-clip">
          {reducedMotion ? (
            <div className="flex h-full items-stretch overflow-x-auto">
              {items.map((item) => (
                <TickerItem key={item.id} item={item} names={names} />
              ))}
            </div>
          ) : (
            <div className="anim-marquee flex h-full w-max items-stretch">
              {half.map((item, i) => (
                <TickerItem key={`a${i}-${item.id}`} item={item} names={names} decorative />
              ))}
              {half.map((item, i) => (
                <TickerItem key={`b${i}-${item.id}`} item={item} names={names} decorative />
              ))}
            </div>
          )}
          <span
            aria-hidden
            className="pointer-events-none absolute inset-y-0 left-0 w-10 bg-gradient-to-r from-bg to-transparent"
          />
          <span
            aria-hidden
            className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-bg to-transparent"
          />
        </div>

        {/* Static, outside the animated track: keyboard users never chase a moving
            target, and this is their route to the same events as a real table. */}
        <Link
          href="/activity"
          aria-label="See all protocol activity"
          className="mlabel flex shrink-0 items-center border-l border-line-subtle px-3 text-mute transition-colors hover:bg-control hover:text-ink"
        >
          Activity <span aria-hidden>↗</span>
        </Link>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Hide the activity ticker for this session"
          className="flex w-9 shrink-0 items-center justify-center border-l border-line-subtle text-sm text-mute transition-colors hover:bg-control hover:text-ink"
        >
          <span aria-hidden>×</span>
        </button>
      </div>
    </aside>
  );
}

function TickerItem({
  item,
  names,
  decorative = false,
}: {
  item: ActivityItem;
  names: Map<string, string>;
  /**
   * Inside the marquee: still clickable, but never a tab stop and never
   * announced — focus must not land on something that is sliding away, and a
   * loop that repeats itself would read as duplicate events.
   */
  decorative?: boolean;
}) {
  const p = PRESENTATION[item.type];
  const subject = subjectOf(item, names);
  const amount = amountOf(item);
  const age = timeAgo(item.timestamp);
  const indexed = item.finality === "indexed";

  const href = item.listingId !== undefined ? `/?listing=${item.listingId.toString()}` : "/activity";
  const label = [p.label, subject, amountText(amount), age, indexed ? "indexed, not yet confirmed" : "confirmed"]
    .filter(Boolean)
    .join(" · ");

  return (
    <Link
      href={href}
      aria-label={decorative ? undefined : label}
      aria-hidden={decorative || undefined}
      tabIndex={decorative ? -1 : undefined}
      className="flex shrink-0 items-center gap-2 border-l border-line-subtle px-3.5 transition-colors hover:bg-control/60"
    >
      <Tag tone={p.tone}>{p.label}</Tag>
      {subject && <span className="max-w-[16rem] truncate text-2xs text-dim">{subject}</span>}
      {amount.hype !== undefined && <Hype wei={amount.hype} maxDecimals={2} className="text-2xs text-ink" />}
      {amount.hwa !== undefined && (
        <span className="num font-mono text-2xs text-ink">
          {formatHwa(amount.hwa)}
          <span className="ml-1 text-[0.85em] text-mute">HWA</span>
        </span>
      )}
      <span className="num font-mono text-2xs text-mute">{age}</span>
      {/* Colour carries the state too — the tooltip only expands on it. */}
      <span
        aria-hidden
        title={indexed ? "Indexed — not yet cross-checked on-chain" : "Confirmed on-chain"}
        className={`text-2xs ${indexed ? "text-amber" : "text-mute"}`}
      >
        {indexed ? "●" : "✓"}
      </span>
    </Link>
  );
}

/** What the event was about: collection + token, else the listing, else nothing. */
function subjectOf(item: ActivityItem, names: Map<string, string>): string {
  const name = item.collection ? names.get(item.collection.toLowerCase()) : undefined;
  const token = item.tokenId !== undefined ? `#${item.tokenId.toString()}` : "";
  if (name) return `${sanitizeLabel(name, "Collection")}${token ? ` ${token}` : ""}`;
  if (item.listingId !== undefined) return `Listing #${item.listingId.toString()}`;
  return token;
}

/**
 * The one amount a row shows: the HYPE leg when it carries value, else the HWA
 * leg. Both the visible cell and the accessible label read from this, so they
 * can never disagree (an event can carry a zero `amount` *and* a token amount).
 */
function amountOf(item: ActivityItem): { hype?: bigint; hwa?: bigint } {
  if (item.amount !== undefined && item.amount > 0n) return { hype: item.amount };
  if (item.tokenAmount !== undefined && item.tokenAmount > 0n) return { hwa: item.tokenAmount };
  return {};
}

function amountText(amount: { hype?: bigint; hwa?: bigint }): string {
  if (amount.hype !== undefined) return `${formatHype(amount.hype, { maxDecimals: 2 })} HYPE`;
  if (amount.hwa !== undefined) return `${formatHwa(amount.hwa)} HWA`;
  return "";
}

/**
 * Reduced motion is read at runtime rather than left to the global CSS override:
 * that override freezes animations at their end state, which would park the
 * marquee mid-loop. The strip becomes a static scrollable row instead.
 */
function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduced(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  return reduced;
}
