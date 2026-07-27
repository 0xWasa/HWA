"use client";

import { useId, useState, type ReactNode } from "react";
import Link from "next/link";
import { useAccountState } from "@/protocol/provider";
import type { AcquisitionPhase } from "@/protocol/types";
import { usePositions, usePurchaseStats } from "@/state/queries";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Hype } from "@/components/ui/Hype";
import { StatCard } from "@/components/ui/StatCard";
import { Panel } from "@/components/ui/Panel";
import { PageHeader } from "@/components/ui/PageHeader";
import { Skeleton, SkeletonRow } from "@/components/ui/Skeleton";
import { PurchaseHistoryTable } from "./PurchaseHistoryTable";

const IN_FLIGHT_PHASES: readonly AcquisitionPhase[] = [
  "requested",
  "randomness_pending",
  "randomness_cached",
  "processing",
];

/**
 * Purchase history is indexer-only: on a chain where the indexer is not
 * deployed the query rejects with INDEXER_DOWN, which is a "not available yet"
 * state and must not be dressed up as a transient connection failure.
 */
function isIndexerMissing(err: unknown): boolean {
  return err instanceof Error && "code" in err && err.code === "INDEXER_DOWN";
}

export function AcquisitionsScreen() {
  const account = useAccountState();
  const { data: stats, isLoading, isError, error, refetch } = usePurchaseStats();
  const { data: positions } = usePositions();
  const [open, setOpen] = useState(true);
  const historyId = useId();

  if (account.status !== "connected") {
    return (
      <Shell>
        <EmptyState
          title="Connect a wallet to see your acquisitions"
          detail="Every purchase you make from the pool is summarised here: what you paid, what backing you received, and how the two compare."
          action={
            <Button variant="primary" onClick={account.connect} loading={account.status === "connecting"}>
              Connect wallet
            </Button>
          }
        />
      </Shell>
    );
  }

  if (isError) {
    if (isIndexerMissing(error)) {
      return (
        <Shell>
          <div className="rounded-md border border-line bg-panel" data-testid="acquisitions-unavailable">
            <EmptyState
              title="Purchase history is not available yet"
              detail="This page reads from the event indexer, which is not deployed on this network. Positions you hold are read straight from the chain and remain visible in My Positions."
              action={
                <Link href="/positions">
                  <Button variant="outline">Open My Positions</Button>
                </Link>
              }
            />
          </div>
        </Shell>
      );
    }
    return (
      <Shell>
        <div className="rounded-md border border-red/30 bg-panel" role="alert">
          <EmptyState
            title="Couldn't load your purchase history"
            detail={
              error instanceof Error
                ? `${error.message} Your purchases are unaffected — this is a read failure only.`
                : "The data source did not respond. Your purchases are unaffected — this is a read failure only."
            }
            action={
              <Button variant="outline" onClick={() => void refetch()}>
                Retry
              </Button>
            }
          />
        </div>
      </Shell>
    );
  }

  if (isLoading || !stats) {
    return (
      <Shell>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-center justify-between gap-3 rounded-lg border border-line/50 bg-elevated/30 px-4 py-3">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-3 w-16" />
            </div>
          ))}
        </div>
        <div className="rounded-md border border-line bg-panel">
          {Array.from({ length: 4 }).map((_, i) => (
            <SkeletonRow key={i} cols={4} />
          ))}
        </div>
      </Shell>
    );
  }

  const inFlight = (positions?.pendingAcquisitions ?? []).filter((t) => IN_FLIGHT_PHASES.includes(t.phase)).length;
  const pl = stats.netListingPL;
  const count = stats.history.length;

  return (
    <Shell>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="acquisition-stats">
        <StatCard
          label="Purchases"
          value={stats.purchases}
          tip="Counts acquisitions that resolved into a position. Requests still in flight and refunded requests are not counted."
        />
        <StatCard
          label="Avg all-in price"
          value={<Hype wei={stats.avgAllInPrice} maxDecimals={4} />}
          tip="Mean of the all-in price paid per resolved purchase — pool acquisition fee plus the randomness service fee."
        />
        <StatCard
          label="All-in spend"
          value={<Hype wei={stats.allInSpend} maxDecimals={4} />}
        />
        <StatCard
          label="Net listing P/L"
          value={<Hype wei={pl} maxDecimals={4} signed />}
          tone={pl > 0n ? "green" : pl < 0n ? "red" : "ink"}
          tip="Backing received across resolved purchases minus the all-in price paid for them. It is not a realised cash result: keeping an NFT leaves its value unrealised."
        />
      </div>

      {inFlight > 0 && (
        <p className="text-2xs text-mute" data-testid="acquisitions-in-flight">
          {inFlight} request{inFlight > 1 ? "s" : ""} in flight — not yet counted above.{" "}
          <Link href="/positions" className="text-accent hover:underline">
            Track in My Positions
          </Link>
        </p>
      )}

      <Panel
        title={`Purchase history (${count})`}
        padded={false}
        actions={
          count > 0 ? (
            <Button
              size="xs"
              variant="ghost"
              aria-expanded={open}
              aria-controls={historyId}
              onClick={() => setOpen((o) => !o)}
              data-testid="toggle-purchase-history"
            >
              {open ? "Hide" : "Show"}
            </Button>
          ) : undefined
        }
      >
        <div id={historyId}>
          {count === 0 ? (
            <EmptyState
              compact
              title="No purchases yet"
              detail="Pay the pool price to receive one randomly selected position. Every request you make shows up here with its outcome."
              action={
                <Link href="/">
                  <Button variant="primary">Go to pool</Button>
                </Link>
              }
            />
          ) : open ? (
            <PurchaseHistoryTable records={stats.history} />
          ) : (
            <p className="px-3 py-2.5 text-2xs text-mute">
              {count} purchase{count > 1 ? "s" : ""} hidden.
            </p>
          )}
        </div>
      </Panel>

      <p className="max-w-3xl text-2xs leading-relaxed text-mute">
        P/L compares the <span className="text-dim">backing received</span> on each position against the{" "}
        <span className="text-dim">all-in price paid</span> (pool acquisition fee + randomness service fee). Positions
        awaiting settlement are shown at their backing, which is not yet realised — selling back to the depositor pays a
        share of the backing, not all of it. Requests still in flight and refunded requests carry no position, so they
        are excluded from the averages and from Net listing P/L.
      </p>
    </Shell>
  );
}

// ------------------------------------------------------------------ pieces

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-[1280px] space-y-3 px-3 py-5 sm:px-6">
      <PageHeader
        eyebrow="PURCHASE LEDGER"
        title="Acquisitions"
        description="Follow paid price, received backing and settlement state across every pool draw made by this wallet."
        action={
          <Link href="/" className="text-xs font-semibold text-accent hover:text-accent-hover">
            Open pool →
          </Link>
        }
      />
      {children}
    </div>
  );
}
