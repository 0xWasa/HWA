"use client";

import { NNBSP, WEI, formatHwa } from "@/lib/units";
import { useTokenMarket } from "@/state/queries";
import { EmptyState } from "@/components/ui/EmptyState";
import { HashLink } from "@/components/ui/HashLink";
import { Hype } from "@/components/ui/Hype";
import { Panel, Stat } from "@/components/ui/Panel";
import { PageHeader } from "@/components/ui/PageHeader";
import { Skeleton } from "@/components/ui/Skeleton";
import { Tag } from "@/components/ui/Tag";
import { PriceChart } from "./PriceChart";
import { SwapPanel } from "./SwapPanel";

/**
 * The $HWA token screen: price chart + Project X trade panel + pool stats.
 * The token and its pool deploy after the core protocol, so the default state
 * of this screen is an honest "not live yet" — never a placeholder market.
 */
export function TokenScreen() {
  const { data: market, isLoading, isError, error, refetch } = useTokenMarket();

  if (isLoading || (!market && !isError)) {
    return (
      <Shell>
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <Skeleton className="h-80 w-full" />
          <Skeleton className="h-80 w-full" />
        </div>
        <Skeleton className="h-20 w-full" />
      </Shell>
    );
  }

  if (isError || !market) {
    return (
      <Shell>
        <div className="rounded-md border border-red/30 bg-red/10 p-4 text-xs" role="alert">
          <div className="font-semibold text-red">Market data unavailable</div>
          <div className="mt-0.5 text-dim">
            {error instanceof Error ? error.message : "The indexer or RPC did not answer."}
          </div>
          <button type="button" className="mt-2 text-2xs text-accent underline" onClick={() => void refetch()}>
            Retry
          </button>
        </div>
      </Shell>
    );
  }

  // ------------------------------------------------------ module not live
  if (!market.moduleActive) {
    return (
      <Shell>
        <div className="rounded-md border border-line bg-panel" data-testid="token-not-live">
          <EmptyState
            title="The $HWA market is not live yet"
            detail="$HWA and its Project X pool deploy as a separate module after the core acquisition protocol. Until the pool exists there is no price, no chart and no trade route — this screen shows nothing rather than a placeholder market."
          />
          <div className="mx-auto max-w-md space-y-2 px-4 pb-6">
            <PreviewRow label="Token" detail="$HWA, 18 decimals, HyperEVM" />
            <PreviewRow label="Market" detail="Project X, wHYPE pair, 1% fee tier" />
            <PreviewRow label="Distribution" detail="depositor emissions + purchaser epoch pots (see Rewards)" />
            <PreviewRow label="Buy pressure" detail="protocol revenue routes into buybacks (40/40/20 with burn)" />
          </div>
          <p className="border-t border-line-subtle px-4 py-3 text-center text-2xs text-mute">
            No price, market cap or APR is shown before the pool is deployed and indexed.
          </p>
        </div>
      </Shell>
    );
  }

  // ------------------------------------------------------------ live market
  const changeBps = market.change24hBps;
  // HWA obtainable for 1 HYPE — the readable direction for a sub-cent price.
  const perHype = market.price && market.price > 0n ? (WEI * WEI) / market.price : null;

  return (
    <Shell>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <Panel title="HWA / HYPE" className="min-w-0">
          <PriceChart candles={market.candles} />
        </Panel>
        <SwapPanel market={market} />
      </div>

      {/* Stats strip */}
      <div
        className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-line bg-line-subtle sm:grid-cols-3 lg:grid-cols-6"
        data-testid="token-stats"
      >
        <div className="bg-panel p-2.5">
          <Stat
            label="Price"
            value={market.price ? <Hype wei={market.price} maxDecimals={9} /> : "—"}
            sub={perHype ? `${formatHwa(perHype, 0)} HWA per HYPE` : undefined}
          />
        </div>
        <div className="bg-panel p-2.5">
          <Stat
            label="24h change"
            value={
              changeBps === undefined ? (
                "—"
              ) : (
                <span className={changeBps >= 0 ? "text-green" : "text-red"} data-testid="token-change">
                  {changeBps >= 0 ? "+" : "−"}
                  {(Math.abs(changeBps) / 100).toFixed(2)}%
                </span>
              )
            }
          />
        </div>
        <div className="bg-panel p-2.5">
          <Stat
            label="Market cap"
            value={market.marketCapHype !== undefined ? <Hype wei={market.marketCapHype} maxDecimals={0} /> : "—"}
            sub="fully diluted"
          />
        </div>
        <div className="bg-panel p-2.5">
          <Stat
            label="HYPE volume 24h"
            value={market.volume24hHype !== undefined ? <Hype wei={market.volume24hHype} maxDecimals={0} /> : "—"}
          />
        </div>
        <div className="bg-panel p-2.5">
          <Stat
            label="HWA volume 24h"
            value={market.volume24hToken !== undefined ? `${formatHwa(market.volume24hToken, 0)} HWA` : "—"}
          />
        </div>
        <div className="bg-panel p-2.5">
          <Stat
            label="Pool swaps"
            value={market.poolSwaps !== undefined ? market.poolSwaps.toLocaleString("en-US").replace(/,/g, NNBSP) : "—"}
          />
        </div>
      </div>

      {/* Contract / route strip */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-md border border-line bg-panel px-3 py-2 text-2xs text-mute">
        <span className="flex items-center gap-1.5">
          Token
          {market.tokenAddress ? <HashLink value={market.tokenAddress} kind="address" /> : <span>—</span>}
        </span>
        <span className="flex items-center gap-1.5">
          Pool
          {market.poolAddress ? <HashLink value={market.poolAddress} kind="address" /> : <span>—</span>}
        </span>
        <span className="flex items-center gap-1.5">
          Route
          <span className="text-dim">{market.dex ?? "—"}</span>
          {market.feeTierBps !== undefined && <Tag tone="accent">{market.feeTierBps / 100}% fee tier</Tag>}
        </span>
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-[1280px] space-y-3 px-3 py-5 sm:px-6" data-testid="token-screen">
      <PageHeader
        eyebrow="PROTOCOL TOKEN"
        title="$HWA"
        description="The reward and settlement token for Hyper World Assets, routed through the configured Project X liquidity market."
        meta="No guaranteed value · market data stays hidden until it is verifiable"
      />
      {children}
    </div>
  );
}

function PreviewRow({ label, detail }: { label: string; detail: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-sm border border-line-subtle bg-inset px-2.5 py-2">
      <span className="shrink-0 text-2xs font-medium text-dim">{label}</span>
      <span className="text-right text-2xs text-mute">{detail}</span>
    </div>
  );
}
