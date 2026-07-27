"use client";

import { useEffect, useState } from "react";
import { shortAddress, timeLeft } from "@/lib/format";
import { formatHwa } from "@/lib/units";
import { useAccountState } from "@/protocol/provider";
import { useProtocolAction } from "@/state/actions";
import { usePositions, useRewards } from "@/state/queries";
import { Button } from "@/components/ui/Button";
import { AmountInput } from "@/components/ui/AmountInput";
import { EmptyState } from "@/components/ui/EmptyState";
import { Hype } from "@/components/ui/Hype";
import { Panel, Stat } from "@/components/ui/Panel";
import { PageHeader } from "@/components/ui/PageHeader";
import { Skeleton } from "@/components/ui/Skeleton";
import { Tag } from "@/components/ui/Tag";
import type { RewardsSnapshot } from "@/protocol/types";

export function RewardsScreen() {
  const account = useAccountState();
  const { data: rewards, isLoading } = useRewards();
  const { data: positions } = usePositions();
  const action = useProtocolAction();
  const [minAccruedFwaOut, setMinAccruedFwaOut] = useState<bigint | null>(null);

  // 1s clock for the epoch mode countdown
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1_000);
    return () => clearInterval(t);
  }, []);

  if (isLoading || !rewards) {
    return (
      <Shell>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Skeleton className="h-44 w-full" />
          <Skeleton className="h-44 w-full" />
        </div>
      </Shell>
    );
  }

  // ------------------------------------------------- module not activated
  if (!rewards.moduleActive) {
    return (
      <Shell>
        <div className="rounded-md border border-line bg-panel">
          <EmptyState
            title="HWA rewards are not activated yet"
            detail="The $HWA token, depositor emissions and purchaser epoch pots deploy as a separate module after the core protocol. This screen goes live with it — nothing accrues in the meantime, and no yield figure is invented."
          />
          <div className="mx-auto max-w-md space-y-2 px-4 pb-6">
            <PreviewRow label="Depositor emissions" detail="continuous HWA stream over 15 days, weighted by √backing" />
            <PreviewRow label="Purchaser epochs" detail="fixed daily HWA pot; one equal unit per settled acquisition" />
            <PreviewRow label="Buy pressure" detail="protocol revenue routes into HWA buybacks (40/40/20 with burn)" />
            <PreviewRow label="Market" detail="HWA trades on Project X, wHYPE pair, 1% tier" />
          </div>
        </div>
        {rewards.holderRevenue && <HolderRevenuePanel holder={rewards.holderRevenue} />}
      </Shell>
    );
  }

  // ----------------------------------------------------------- activated
  const em = rewards.emission;
  const ep = rewards.epoch;
  const user = rewards.user;
  const nowS = Math.floor(Date.now() / 1000);
  const emissionPct =
    em && em.endsAt > em.startedAt
      ? Math.min(100, Math.max(0, Math.round(((nowS - em.startedAt) / (em.endsAt - em.startedAt)) * 100)))
      : 0;

  const isHot = ep ? nowS - ep.lastAcquisitionAt < ep.hotGapSec : false;

  return (
    <Shell>
      {/* Emission + epoch header */}
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-line bg-line-subtle sm:grid-cols-4">
        <div className="bg-panel p-2.5">
          <Stat
            label="Emission"
            value={em ? `${emissionPct}%` : "—"}
            sub={em ? `ends in ${timeLeft(em.endsAt)}` : undefined}
          />
        </div>
        <div className="bg-panel p-2.5">
          <Stat
            label="Depositor rate"
            value={em ? `${formatHwa(em.depositorRatePerSec)} HWA/s` : "—"}
            sub="weighted by √backing"
          />
        </div>
        <div className="bg-panel p-2.5">
          <Stat label="Epoch pot" value={em ? `${formatHwa(em.purchaserDailyPot, 0)} HWA` : "—"} sub={`epoch #${ep?.current ?? "—"}`} />
        </div>
        <div className="bg-panel p-2.5">
          <div className="flex items-start justify-between">
          <Stat
              label="Next buy allowance"
              value={
                <span className={isHot ? "text-secondary-readable" : "text-blue"}>
                  {isHot ? "HOT" : "COLD"}
                </span>
              }
              sub={
                ep
                  ? isHot
                    ? `starts ramping ${timeLeft(ep.lastAcquisitionAt + ep.hotGapSec)} after the last request`
                    : `cold gap reached; the next request receives the full surcharge slice`
                  : undefined
              }
            />
            <span aria-hidden className={`mt-1 size-1.5 rounded-full ${isHot ? "anim-pulse bg-secondary" : "bg-blue"}`} />
          </div>
        </div>
      </div>

      {em && (
        <div className="h-1 overflow-hidden rounded-full bg-control" role="progressbar" aria-valuenow={emissionPct} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full rounded-full bg-secondary transition-[width] duration-1000" style={{ width: `${emissionPct}%` }} />
        </div>
      )}

      {account.status !== "connected" ? (
        <div className="rounded-md border border-line bg-panel">
          <EmptyState
            compact
            title="Connect to see your rewards"
            action={
              <Button variant="primary" onClick={account.connect}>
                Connect wallet
              </Button>
            }
          />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {/* Depositor side */}
          <Panel
            title="Depositor rewards"
            actions={<Tag tone="accent">{positions?.deposited.length ?? 0} active deposits</Tag>}
          >
            <div className="flex h-full flex-col gap-2">
              <BigAmount label="Accruing (claimable)" value={user?.depositorPending ?? 0n} highlight />
              <BigAmount label="Credited from closed positions" value={user?.depositorCredit ?? 0n} />
              <p className="text-2xs leading-snug text-mute">
                Streams continuously to active deposits, weighted by √backing, for the 15-day emission. Claiming does
                not touch your listings.
              </p>
              <Button
                variant="primary"
                className="w-full"
                disabled={(user?.depositorPending ?? 0n) <= 0n}
                loading={action.submitting}
                data-testid="claim-depositor"
                style={{ marginTop: "auto" }}
                onClick={() =>
                  void action.run((c) =>
                    c.claimRewards({ listingIds: positions?.deposited.map((l) => l.id) ?? [] }),
                  )
                }
              >
                Claim depositor HWA
              </Button>
              <Button
                variant="secondary"
                className="w-full"
                disabled={(user?.depositorCredit ?? 0n) <= 0n}
                loading={action.submitting}
                data-testid="withdraw-reward-credit"
                onClick={() => void action.run((c) => c.claimRewards({ withdrawCredit: true }))}
              >
                Withdraw credited HWA
              </Button>
            </div>
          </Panel>

          {/* Purchaser side */}
          <Panel
            title="Purchaser rewards"
            actions={user && user.claimableEpochs.length > 0 ? <Tag tone="accent">{user.claimableEpochs.length} epochs ready</Tag> : undefined}
          >
            <div className="flex h-full flex-col gap-2">
              <BigAmount label="Closed epochs (claimable)" value={user?.purchaserClaimable ?? 0n} highlight />
              <div className="rounded-sm border border-line-subtle bg-inset p-2">
                <div className="text-2xs text-mute">HYPE committed to an HWA purchase</div>
                <Hype wei={user?.purchaserBuyAllowanceHype ?? 0n} className="text-sm text-ink" />
              </div>
              <p className="text-2xs leading-snug text-mute">
                Epochs are fixed 24-hour windows from emission start. Every successfully settled acquisition counts
                as one equal unit of that day&apos;s HWA pot. The {ep ? `${Math.round(ep.coldGapSec / 60)}m` : "cold"}
                gap only controls how much acquisition surcharge becomes that purchaser&apos;s HYPE allowance to buy HWA.
              </p>
              <Button
                variant="primary"
                className="w-full"
                disabled={(user?.purchaserClaimable ?? 0n) <= 0n}
                loading={action.submitting}
                data-testid="claim-purchaser"
                style={{ marginTop: "auto" }}
                onClick={() => void action.run((c) => c.claimRewards({ epochs: user?.claimableEpochs ?? [] }))}
              >
                Claim epoch HWA
              </Button>
              <AmountInput
                id="accrued-fwa-min-out"
                label="Minimum HWA received"
                value={minAccruedFwaOut}
                onChange={setMinAccruedFwaOut}
              />
              <Button
                variant="secondary"
                className="w-full"
                disabled={(user?.purchaserBuyAllowanceHype ?? 0n) <= 0n || !minAccruedFwaOut || minAccruedFwaOut <= 0n}
                loading={action.submitting}
                data-testid="claim-accrued-fwa"
                onClick={() =>
                  minAccruedFwaOut !== null &&
                  void action.run((c) => c.claimRewards({ claimAccruedMinOut: minAccruedFwaOut }))
                }
              >
                Buy accrued HWA
              </Button>
            </div>
          </Panel>
        </div>
      )}

      {account.status === "connected" && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-line bg-panel px-3 py-2 text-2xs text-mute">
          <span>
            Lifetime claimed:{" "}
            <span className="num font-mono text-dim">
              {user?.claimed === undefined ? "Not exposed on-chain" : `${formatHwa(user.claimed)} HWA`}
            </span>
          </span>
          <span className="flex items-center gap-2">
            {rewards.tokenAddress && (
              <>
                $HWA <span className="num font-mono">{shortAddress(rewards.tokenAddress)}</span> ·
              </>
            )}
            {rewards.swapRoute && (
              <span>
                trades on {rewards.swapRoute.dex} ({rewards.swapRoute.feeTierBps / 100}% tier, wHYPE pair)
              </span>
            )}
          </span>
        </div>
      )}

      {rewards.holderRevenue && <HolderRevenuePanel holder={rewards.holderRevenue} />}

      {action.error && (
        <div className="rounded-sm border border-red/30 bg-red/10 p-2 text-2xs" role="alert">
          <div className="font-semibold text-red">{action.error.title}</div>
          {action.error.detail && <div className="mt-0.5 text-dim">{action.error.detail}</div>}
        </div>
      )}
    </Shell>
  );
}

function HolderRevenuePanel({ holder }: { holder: NonNullable<RewardsSnapshot["holderRevenue"]> }) {
  const account = useAccountState();
  const action = useProtocolAction();
  const pending = holder.user?.pendingHype ?? 0n;
  const deadline = holder.sweepAvailableAt;

  return (
    <Panel
      title="Snapshot-holder revenue"
      actions={
        <Tag tone={holder.claimsClosed ? "neutral" : holder.splitFrozen ? "accent" : "amber"}>
          {holder.claimsClosed ? "Claims closed" : `${holder.nftShareBps / 100}% of protocol revenue`}
        </Tag>
      }
    >
      <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto] md:items-end">
        <div className="rounded-sm border border-line-subtle bg-inset p-2.5">
          <div className="text-2xs uppercase tracking-wide text-mute">Claimable HYPE</div>
          <Hype wei={pending} className={pending > 0n ? "text-xl text-secondary-readable" : "text-xl text-ink"} />
          <div className="mt-1 text-2xs text-faint">
            {account.status === "connected"
              ? `${holder.user?.ownedTokenIds.length ?? 0} eligible snapshot NFT${(holder.user?.ownedTokenIds.length ?? 0) === 1 ? "" : "s"}`
              : "Connect to verify current snapshot-NFT ownership"}
          </div>
        </div>
        <div className="rounded-sm border border-line-subtle bg-inset p-2.5 text-2xs text-mute">
          <div>
            Cumulative per NFT: <Hype wei={holder.claimablePerToken} className="text-dim" />
          </div>
          <div className="mt-1">
            Claim deadline: {deadline ? `${new Date(deadline * 1_000).toLocaleDateString()} (${timeLeft(deadline)})` : "starts at launch"}
          </div>
          <div className="mt-1 text-faint">
            After the on-chain deadline, the owner may sweep and permanently close remaining holder claims.
          </div>
        </div>
        {account.status !== "connected" ? (
          <Button variant="primary" onClick={account.connect}>Connect wallet</Button>
        ) : (
          <Button
            variant="primary"
            disabled={holder.claimsClosed || pending <= 0n || (holder.user?.ownedTokenIds.length ?? 0) === 0}
            loading={action.submitting}
            data-testid="claim-splitter-revenue"
            onClick={() =>
              void action.run((client) =>
                client.claimSplitterRevenue({ tokenIds: holder.user?.ownedTokenIds ?? [] }),
              )
            }
          >
            Claim HYPE revenue
          </Button>
        )}
      </div>
      {action.error && (
        <div className="mt-2 rounded-sm border border-red/30 bg-red/10 p-2 text-2xs" role="alert">
          <div className="font-semibold text-red">{action.error.title}</div>
          {action.error.detail && <div className="mt-0.5 text-dim">{action.error.detail}</div>}
        </div>
      )}
    </Panel>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-[1280px] space-y-3 px-3 py-5 sm:px-6">
      <PageHeader
        eyebrow="INCENTIVES"
        title="Rewards"
        description="Track depositor emissions and purchaser epochs from the contracts, with every unavailable value left visibly unavailable."
        meta="$HWA · no guaranteed value"
      />
      {children}
    </div>
  );
}

function BigAmount({ label, value, highlight = false }: { label: string; value: bigint; highlight?: boolean }) {
  return (
    <div className={`rounded-sm border p-2.5 ${highlight ? "border-secondary/35 bg-secondary-deep/55" : "border-line-subtle bg-inset"}`}>
      <div className="text-2xs uppercase tracking-wide text-mute">{label}</div>
      <div className={`num font-mono text-xl ${highlight && value > 0n ? "text-secondary-readable" : "text-ink"}`}>
        {formatHwa(value)} <span className="text-sm text-mute">HWA</span>
      </div>
    </div>
  );
}

function PreviewRow({ label, detail }: { label: string; detail: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-sm border border-line-subtle bg-inset px-2.5 py-2">
      <span className="shrink-0 text-2xs font-medium text-dim">{label}</span>
      <span className="text-right text-2xs text-faint">{detail}</span>
    </div>
  );
}
