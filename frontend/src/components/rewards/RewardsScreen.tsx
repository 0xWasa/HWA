"use client";

import { shortAddress, timeLeft } from "@/lib/format";
import { formatHwa } from "@/lib/units";
import { useAccountState, useProtocol } from "@/protocol/provider";
import { useProtocolAction } from "@/state/actions";
import { usePositions, useRewards } from "@/state/queries";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Hype } from "@/components/ui/Hype";
import { Panel, Stat } from "@/components/ui/Panel";
import { PageHeader } from "@/components/ui/PageHeader";
import { Skeleton } from "@/components/ui/Skeleton";
import { Tag } from "@/components/ui/Tag";
import type { RewardsSnapshot } from "@/protocol/types";
import { ProtocolPrelaunch } from "@/components/ui/ProtocolPrelaunch";
import {
  HWA_NFT_DEPOSITS_PAUSED,
  HWA_PROTOCOL_OPERATIONS_PAUSED,
  HWA_REWARD_CLAIMS_PAUSED,
} from "@/config/featureFlags";

const DISTRIBUTION_LOCKED =
  HWA_REWARD_CLAIMS_PAUSED || HWA_NFT_DEPOSITS_PAUSED || HWA_PROTOCOL_OPERATIONS_PAUSED;

export function RewardsScreen() {
  const account = useAccountState();
  const { prelaunch } = useProtocol();
  const { data: rewards, isLoading } = useRewards();
  const { data: positions } = usePositions();
  const action = useProtocolAction();

  if (prelaunch) {
    return (
      <Shell>
        <ProtocolPrelaunch
          title="HWA incentives are staged, not live."
          detail="The fixed reward reserve, claims and Project X market remain locked until the explicit public launch. No APR is simulated."
          compact
        />
      </Shell>
    );
  }
  if (isLoading || !rewards) {
    return <Shell><div className="grid gap-3 md:grid-cols-2"><Skeleton className="h-48 w-full" /><Skeleton className="h-48 w-full" /></div></Shell>;
  }
  if (!rewards.moduleActive) {
    return (
      <Shell>
        <div className="rounded-md border border-line bg-panel">
          <EmptyState title="Rewards V2 are not deployed" detail="15-day incentives and revenue-funded buybacks will appear here only after the verified contracts are configured." />
        </div>
        {rewards.holderRevenue && <HolderRevenuePanel holder={rewards.holderRevenue} />}
      </Shell>
    );
  }

  const emission = rewards.emission;
  const user = rewards.user;
  const started = Boolean(emission?.startedAt);
  const ended = Boolean(emission?.endsAt && Math.floor(Date.now() / 1000) >= emission.endsAt);

  return (
    <Shell>
      {DISTRIBUTION_LOCKED && (
        <div className="rounded-md border border-secondary/40 bg-secondary/10 px-4 py-3" role="status">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-secondary-readable">Launch lock active</div>
            <Tag tone="amber">all public actions disabled</Tag>
          </div>
          <p className="mt-1 max-w-3xl text-xs leading-relaxed text-dim">
            Deposits, draws, HWA claims and external Project X buys stay disabled until the owner performs the explicit launch sequence. Configuration is visible; nothing can be farmed yet.
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-line bg-line-subtle lg:grid-cols-4">
        <Metric label="Program" value={!started ? "STAGED" : ended ? "ENDED" : "LIVE"} detail={!started ? "clock has not started" : emission?.endsAt ? `hard stop ${timeLeft(emission.endsAt)}` : undefined} />
        <Metric label="Fixed reserve" value={emission ? `${formatHwa(emission.reserveRemaining, 0)} HWA` : ","} detail="300M total · 150M depositors + 150M purchasers" />
        <Metric label="Purchaser epochs" value={emission ? `${Math.min(emission.currentEpoch + 1, 15)} / 15` : ""} detail="10M HWA budget per day" />
        <Metric label="Claims" value={emission?.claimsEnabled && !HWA_REWARD_CLAIMS_PAUSED ? "OPEN" : "LOCKED"} detail="one-way explicit activation" />
      </div>

      {emission && (
        <section className="space-y-2" aria-labelledby="season-roadmap">
          <div className="flex items-end justify-between gap-3">
            <div>
              <div className="text-2xs font-semibold uppercase tracking-[0.16em] text-purple">HWA launch program</div>
              <h2 id="season-roadmap" className="mt-0.5 text-lg font-semibold text-ink">300M HWA over 15 days.</h2>
            </div>
            <span className="text-right text-2xs text-mute">Unused daily capacity is burned · no carry-over</span>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            {emission.seasons.map((season) => {
              const status = !started ? "UPCOMING" : emission.currentSeason === season.season ? "LIVE" : emission.currentSeason > season.season || ended ? "CLOSED" : "UPCOMING";
              return (
                <div key={season.season} className={`rounded-md border p-3 ${status === "LIVE" ? "border-secondary/50 bg-secondary/10" : "border-line bg-panel"}`}>
                  <div className="flex items-center justify-between gap-2"><span className="font-mono text-2xs text-purple">15D</span><Tag tone={status === "LIVE" ? "accent" : "neutral"}>{status}</Tag></div>
                  <div className="mt-3 num font-mono text-xl text-ink">{formatHwa(season.maxBudget, 0)} <span className="text-sm text-mute">HWA max</span></div>
                  <div className="mt-1 text-2xs text-mute">Days {(season.season - 1) * 15 + 1}–{season.season * 15} · volume-gated, never guaranteed</div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <div className="grid gap-3 lg:grid-cols-2">
        <Panel title="15-day incentives" actions={<Tag tone="accent">fixed 300M reserve</Tag>}>
          <div className="grid grid-cols-2 gap-2">
            <BigAmount label="Unlocked by volume" value={emission?.emitted ?? 0n} highlight />
            <BigAmount label="Burned / expired" value={emission?.burned ?? 0n} />
            <BigAmount label="Depositor side" value={emission?.depositorEmitted ?? 0n} />
            <BigAmount label="Purchaser side" value={emission?.purchaserEmitted ?? 0n} />
          </div>
          <p className="mt-2 text-2xs leading-relaxed text-mute">
            Each settled draw can unlock at most 5% of its HYPE value in HWA, priced with the lower of the 30-minute TWAP and launch price. Depositors split 50% by âbacking; purchasers split 50% by actual HYPE spent. Protocol-seeded Genesis positions are excluded.
          </p>
        </Panel>

        <Panel title="Revenue-funded buybacks" actions={<Tag tone="neutral">continues after day 45</Tag>}>
          <div className="grid grid-cols-2 gap-2">
            <BigAmount label="Routed to depositors" value={rewards.buyback?.depositorRouted ?? 0n} highlight />
            <BigAmount label="Routed to purchasers" value={rewards.buyback?.purchaserRouted ?? 0n} />
          </div>
          <div className="mt-2 rounded-sm border border-line-subtle bg-inset p-2.5 text-2xs leading-relaxed text-mute">
            Protocol revenue buys HWA on Project X and routes purchased tokens 40% to depositors, 40% to purchasers and 20% to permanent burn. This is separate from the fixed 15-day reserve and cannot mint new HWA.
          </div>
        </Panel>
      </div>

      {account.status !== "connected" ? (
        <div className="rounded-md border border-line bg-panel"><EmptyState compact title="Connect to inspect your balances" action={<Button variant="primary" onClick={account.connect}>Connect wallet</Button>} /></div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          <Panel title="Your depositor allocation" actions={<Tag tone="neutral">{positions?.deposited.length ?? 0} positions</Tag>}>
            <div className="space-y-2">
              <BigAmount label="Active-position balance" value={user?.depositorPending ?? 0n} highlight />
              <BigAmount label="Credited from closed positions" value={user?.depositorCredit ?? 0n} />
              <Button className="w-full" variant="primary" disabled={HWA_REWARD_CLAIMS_PAUSED || !emission?.claimsEnabled || (user?.depositorPending ?? 0n) <= 0n} loading={action.submitting} onClick={() => void action.run((client) => client.claimRewards({ listingIds: positions?.deposited.map((listing) => listing.id) ?? [] }))}>Claims locked</Button>
              <Button className="w-full" variant="secondary" disabled={HWA_REWARD_CLAIMS_PAUSED || !emission?.claimsEnabled || (user?.depositorCredit ?? 0n) <= 0n} loading={action.submitting} onClick={() => void action.run((client) => client.claimRewards({ withdrawCredit: true }))}>Withdrawals locked</Button>
            </div>
          </Panel>
          <Panel title="Your purchaser allocation" actions={<Tag tone="neutral">successful daily acquisitions</Tag>}>
            <div className="space-y-2">
              <BigAmount label="Closed epochs" value={user?.purchaserClaimable ?? 0n} highlight />
              <div className="rounded-sm border border-line-subtle bg-inset p-2.5"><div className="text-2xs text-mute">HYPE allowance for an HWA buy</div><Hype wei={user?.purchaserBuyAllowanceHype ?? 0n} className="text-lg text-ink" /></div>
              <Button className="w-full" variant="primary" disabled={HWA_REWARD_CLAIMS_PAUSED || !emission?.claimsEnabled || (user?.purchaserClaimable ?? 0n) <= 0n} loading={action.submitting} onClick={() => void action.run((client) => client.claimRewards({ epochs: user?.claimableEpochs ?? [] }))}>Claims locked</Button>
              <div className="text-2xs text-mute">The 60s→60m hot/cold gap only changes the HYPE allowance routed to the purchaser. It does not inflate the 15-day reserve.</div>
            </div>
          </Panel>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-line bg-panel px-3 py-2 text-2xs text-mute">
        <span>Fixed launch allocation , not APR, yield or guaranteed distribution.</span>
        <span>{rewards.tokenAddress && <>$HWA <span className="font-mono">{shortAddress(rewards.tokenAddress)}</span> · </>}{rewards.swapRoute?.dex} 1% wHYPE pool</span>
      </div>

      {rewards.holderRevenue && <HolderRevenuePanel holder={rewards.holderRevenue} />}
      {action.error && <div className="rounded-sm border border-red/30 bg-red/10 p-2 text-2xs" role="alert"><div className="font-semibold text-red">{action.error.title}</div>{action.error.detail && <div className="mt-0.5 text-dim">{action.error.detail}</div>}</div>}
    </Shell>
  );
}

function HolderRevenuePanel({ holder }: { holder: NonNullable<RewardsSnapshot["holderRevenue"]> }) {
  const account = useAccountState();
  const action = useProtocolAction();
  const pending = holder.user?.pendingHype ?? 0n;
  return (
    <Panel title="Genesis holder revenue" actions={<Tag tone={holder.claimsClosed ? "neutral" : "accent"}>{holder.claimsClosed ? "Claims closed" : `${holder.nftShareBps / 100}% of protocol revenue`}</Tag>}>
      <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto] md:items-end">
        <div className="rounded-sm border border-line-subtle bg-inset p-2.5"><div className="text-2xs uppercase tracking-wide text-mute">Claimable HYPE</div><Hype wei={pending} className="text-xl text-ink" /><div className="mt-1 text-2xs text-faint">{account.status === "connected" ? `${holder.user?.ownedTokenIds.length ?? 0} eligible Genesis NFTs` : "Connect to inspect ownership"}</div></div>
        <div className="rounded-sm border border-line-subtle bg-inset p-2.5 text-2xs text-mute">Cumulative per NFT: <Hype wei={holder.claimablePerToken} className="text-dim" /><div className="mt-1">Independent from 15-day HWA emissions.</div></div>
        {account.status !== "connected" ? <Button variant="primary" onClick={account.connect}>Connect wallet</Button> : <Button variant="primary" disabled={HWA_PROTOCOL_OPERATIONS_PAUSED || holder.claimsClosed || pending <= 0n} loading={action.submitting} onClick={() => void action.run((client) => client.claimSplitterRevenue({ tokenIds: holder.user?.ownedTokenIds ?? [] }))}>{HWA_PROTOCOL_OPERATIONS_PAUSED ? "Launch locked" : "Claim HYPE"}</Button>}
      </div>
    </Panel>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto w-full max-w-[1280px] space-y-4 px-3 py-5 sm:px-6"><PageHeader eyebrow="INCENTIVES" title="Rewards" description="300M HWA over 15 days, plus revenue-funded buybacks." meta="$HWA · fixed 1B supply" />{children}</div>;
}

function Metric({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return <div className="bg-panel p-3"><Stat label={label} value={value} sub={detail} /></div>;
}

function BigAmount({ label, value, highlight = false }: { label: string; value: bigint; highlight?: boolean }) {
  return <div className={`rounded-sm border p-2.5 ${highlight ? "border-secondary/35 bg-secondary-deep/55" : "border-line-subtle bg-inset"}`}><div className="text-2xs uppercase tracking-wide text-mute">{label}</div><div className={`num font-mono text-xl ${highlight && value > 0n ? "text-secondary-readable" : "text-ink"}`}>{formatHwa(value)} <span className="text-sm text-mute">HWA</span></div></div>;
}