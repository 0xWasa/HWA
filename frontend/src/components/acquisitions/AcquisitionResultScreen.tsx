"use client";

import Link from "next/link";
import { useMemo, type ReactNode } from "react";
import { useAccountState } from "@/protocol/provider";
import { useListing, usePoolSnapshot, usePositions, usePurchaseStats } from "@/state/queries";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { PurchaseResultSurface } from "./PurchaseResultSurface";

export function AcquisitionResultScreen({ requestId }: { requestId: bigint }) {
  const account = useAccountState();
  const { data: stats, isLoading: statsLoading } = usePurchaseStats();
  const { data: positions } = usePositions();
  const { data: snapshot } = usePoolSnapshot();
  const record = stats?.history.find((item) => item.requestId === requestId);
  const { data: listing, isLoading: listingLoading } = useListing(record?.listingId ?? null);
  const ticket = useMemo(
    () => positions?.pendingAcquisitions.find((item) => item.requestId === requestId),
    [positions, requestId],
  );

  if (account.status !== "connected") {
    return (
      <Shell>
        <EmptyState
          title="Connect the purchasing wallet"
          detail="Acquisition results are scoped to the wallet that submitted the draw."
          action={<Button variant="primary" onClick={account.connect}>Connect wallet</Button>}
        />
      </Shell>
    );
  }

  if (statsLoading || (record?.listingId !== undefined && listingLoading)) {
    return (
      <Shell>
        <div className="grid gap-8 lg:grid-cols-[0.8fr_1.2fr]">
          <Skeleton className="mx-auto aspect-[0.78] w-full max-w-sm rounded-2xl" />
          <div className="space-y-4 py-10"><Skeleton className="h-12 w-3/4" /><Skeleton className="h-8 w-1/2" /><Skeleton className="h-72 w-full rounded-xl" /></div>
        </div>
      </Shell>
    );
  }

  if (!record) {
    return (
      <Shell>
        <EmptyState title="Acquisition not found" detail={`Request #${requestId.toString()} is not associated with this connected wallet.`} action={<Link href="/acquisitions"><Button variant="secondary">Back to acquisitions</Button></Link>} />
      </Shell>
    );
  }

  if (!listing) {
    return (
      <Shell>
        <div className="rounded-2xl border border-line bg-panel p-8 text-center">
          <div className="mlabel text-secondary-readable">REQUEST #{requestId.toString()}</div>
          <h1 className="mt-2 text-3xl font-semibold text-ink">{record.outcome === "refunded" ? "Acquisition refunded" : "Draw still in flight"}</h1>
          <p className="mt-2 text-sm text-mute">No NFT position has been allocated to this request yet.</p>
          <Link href="/acquisitions" className="mt-5 inline-block text-sm font-semibold text-accent">Back to acquisitions →</Link>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <PurchaseResultSurface listing={listing} ticket={ticket} snapshot={snapshot} batchLabel={`PURCHASE #${requestId.toString()}`} />
    </Shell>
  );
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-6xl px-3 py-5 sm:px-6 sm:py-8">
      <div className="mb-5 flex items-center justify-between gap-3">
        <Link href="/acquisitions" className="text-xs font-semibold text-mute hover:text-ink">← Acquisition ledger</Link>
        <Link href="/" className="text-xs font-semibold text-accent hover:text-accent-hover">Open pool →</Link>
      </div>
      {children}
    </div>
  );
}
