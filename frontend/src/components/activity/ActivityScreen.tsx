"use client";

import { useMemo, useState } from "react";
import { shortAddress, timeAgo } from "@/lib/format";
import { formatHwa } from "@/lib/units";
import { useAccountState } from "@/protocol/provider";
import type { ActivityItem, ActivityType } from "@/protocol/types";
import { useActivity, useCollections, useConnectionHealth } from "@/state/queries";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { HashLink } from "@/components/ui/HashLink";
import { Hype } from "@/components/ui/Hype";
import { Segmented } from "@/components/ui/Segmented";
import { PageHeader } from "@/components/ui/PageHeader";
import { SkeletonRow } from "@/components/ui/Skeleton";
import { Tag } from "@/components/ui/Tag";

const PAGE = 30;

/** Type groups for the filter — granular event types, grouped for humans. */
const TYPE_GROUPS: { id: string; label: string; types: ActivityType[] }[] = [
  { id: "deposits", label: "Deposits", types: ["deposit", "activation", "withdraw_listing", "backing_update"] },
  { id: "acquisitions", label: "Acquisitions", types: ["acquisition_request", "randomness_cached", "allocation"] },
  {
    id: "settlements",
    label: "Settlements",
    types: ["keep", "relist", "bid_accepted", "bid_accepted_tokens", "depositor_resolved", "finalized"],
  },
  { id: "claims", label: "Claims & refunds", types: ["acquisition_refund", "earnings_accrued", "earnings_withdraw", "reward_claim"] },
  { id: "crown", label: "Crown", types: ["crown_set", "crown_funded", "crown_settled"] },
  { id: "protocol", label: "Protocol", types: ["config_set", "collection_whitelist", "fees_paid_out", "protocol_fees_to_token"] },
  { id: "delivery", label: "Delivery", types: ["delivery_failed", "stuck_recovered"] },
];

const TYPE_PRESENTATION: Record<ActivityType, { label: string; tone: "accent" | "red" | "amber" | "blue" | "neutral" }> = {
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
  earnings_accrued: { label: "Earnings accrued", tone: "accent" },
  reward_claim: { label: "Reward claim", tone: "accent" },
  crown_set: { label: "New crown", tone: "amber" },
  crown_funded: { label: "Crown funded", tone: "amber" },
  crown_settled: { label: "Crown paid", tone: "amber" },
  config_set: { label: "Config changed", tone: "neutral" },
  collection_whitelist: { label: "Collection policy", tone: "neutral" },
  fees_paid_out: { label: "Protocol fees paid", tone: "blue" },
  protocol_fees_to_token: { label: "Buyback funded", tone: "blue" },
  delivery_failed: { label: "Delivery failed", tone: "red" },
  stuck_recovered: { label: "NFT recovered", tone: "accent" },
};

export function ActivityScreen() {
  const account = useAccountState();
  const [scope, setScope] = useState<"global" | "user">("global");
  const [groupId, setGroupId] = useState<string | null>(null);
  const [collection, setCollection] = useState<string | null>(null);
  const [limit, setLimit] = useState(PAGE);

  const types = useMemo(
    () => (groupId ? TYPE_GROUPS.find((g) => g.id === groupId)?.types : undefined),
    [groupId],
  );

  const { data: collections } = useCollections();
  const { data: health } = useConnectionHealth();
  const { data: page, isLoading } = useActivity({
    scope,
    account: scope === "user" ? account.address : undefined,
    types,
    collections: collection ? [collection as `0x${string}`] : undefined,
    limit,
  });

  return (
    <div className="mx-auto w-full max-w-[1280px] space-y-3 px-3 py-5 sm:px-6">
      <PageHeader
        eyebrow="ON-CHAIN TAPE"
        title="Activity"
        description="A readable event trail for deposits, draws, settlements and claims, separated from RPC and indexer health."
        action={
          <Segmented
            ariaLabel="Feed scope"
            value={scope}
            onChange={(v) => {
              setScope(v);
              setLimit(PAGE);
            }}
            options={[
              { value: "global", label: "Global" },
              { value: "user", label: "Mine" },
            ]}
          />
        }
      />

      <div className="flex flex-wrap items-center gap-1.5">
        <FilterChip active={groupId === null} onClick={() => setGroupId(null)}>
          All
        </FilterChip>
        {TYPE_GROUPS.map((g) => (
          <FilterChip key={g.id} active={groupId === g.id} onClick={() => setGroupId(groupId === g.id ? null : g.id)}>
            {g.label}
          </FilterChip>
        ))}
        <select
          aria-label="Filter by collection"
          value={collection ?? ""}
          onChange={(e) => setCollection(e.target.value || null)}
          className="ml-auto h-7 rounded-sm border border-line bg-control px-2 text-2xs text-dim outline-none focus:border-accent/60"
        >
          <option value="">All collections</option>
          {(collections ?? [])
            .filter((c) => c.whitelisted)
            .map((c) => (
              <option key={c.address} value={c.address}>
                {c.name}
              </option>
            ))}
        </select>
      </div>

      {scope === "user" && account.status !== "connected" ? (
        <div className="rounded-md border border-line bg-panel">
          <EmptyState
            compact
            title="Connect to see your activity"
            action={
              <Button variant="primary" onClick={account.connect}>
                Connect wallet
              </Button>
            }
          />
        </div>
      ) : isLoading && !page ? (
        <div className="rounded-md border border-line bg-panel">
          {Array.from({ length: 8 }).map((_, i) => (
            <SkeletonRow key={i} cols={3} />
          ))}
        </div>
      ) : !page || page.items.length === 0 ? (
        <div className="rounded-md border border-line bg-panel">
          <EmptyState
            compact
            title={health?.indexer.status === "down" ? "Activity indexer not connected" : "No activity"}
            detail={
              health?.indexer.status === "down"
                ? "Live contract reads and transactions still work, but complete event history needs the testnet indexer."
                : "Events matching the current filters will stream here."
            }
          />
        </div>
      ) : (
        <>
          <div className="overflow-x-auto rounded-md border border-line bg-panel" data-testid="activity-feed">
            <div className="min-w-[560px]">
              <div className="grid grid-cols-[110px_minmax(0,1fr)_110px_90px_90px_60px] gap-3 border-b border-line px-3 py-1.5 text-[10px] uppercase tracking-wide text-faint">
                <span>Event</span>
                <span>Detail</span>
                <span className="text-right">Amount</span>
                <span>Actor</span>
                <span>Tx</span>
                <span className="text-right">Age</span>
              </div>
              {page.items.map((item) => (
                <ActivityRow key={item.id} item={item} />
              ))}
            </div>
          </div>
          {page.nextCursor && (
            <div className="flex justify-center">
              <Button variant="secondary" onClick={() => setLimit((n) => n + PAGE)}>
                Show {PAGE} more
              </Button>
            </div>
          )}
          <p className="text-2xs leading-snug text-faint">
            <span className="text-mute">● indexed</span> — event seen by the indexer, may still reorganize ·{" "}
            <span className="text-mute">✓ confirmed</span> — cross-checked against the chain head. Indexed events are
            not final confirmations.
          </p>
        </>
      )}
    </div>
  );
}

function ActivityRow({ item }: { item: ActivityItem }) {
  const p = TYPE_PRESENTATION[item.type];
  return (
    <div
      className="grid grid-cols-[110px_minmax(0,1fr)_110px_90px_90px_60px] items-center gap-3 border-b border-line-subtle px-3 py-1.5 last:border-0"
      data-testid={`activity-${item.type}`}
    >
      <div>
        <Tag tone={p.tone}>{p.label}</Tag>
      </div>
      <div className="min-w-0 truncate text-2xs text-dim">
        {item.listingId !== undefined && (
          <a href={`/?listing=${item.listingId.toString()}`} className="num font-mono text-blue hover:underline">
            #{item.listingId.toString()}
          </a>
        )}
        {item.tokenId !== undefined && <span className="num ml-1 font-mono text-mute">token {item.tokenId.toString()}</span>}
        {item.tokenAmount !== undefined && (
          <span className="num ml-1 font-mono text-mute">{formatHwa(item.tokenAmount)} HWA</span>
        )}
      </div>
      <div className="text-right">
        {item.amount !== undefined ? <Hype wei={item.amount} maxDecimals={3} className="text-2xs" /> : <span className="text-faint">—</span>}
      </div>
      <div className="num truncate font-mono text-2xs text-mute">{item.address ? shortAddress(item.address) : "—"}</div>
      <div>
        <HashLink value={item.txHash} kind="tx" />
      </div>
      <div className="flex items-center justify-end gap-1 text-right text-2xs text-faint">
        <span title={item.finality === "indexed" ? "Indexed — not yet cross-checked on-chain" : "Confirmed on-chain"}>
          {item.finality === "indexed" ? "●" : "✓"}
        </span>
        {timeAgo(item.timestamp)}
      </div>
    </div>
  );
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`h-7 rounded-sm border px-2 text-2xs font-medium transition-colors ${
        active ? "border-accent/50 bg-accent/10 text-accent" : "border-line bg-control text-mute hover:text-dim"
      }`}
    >
      {children}
    </button>
  );
}
