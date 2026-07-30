"use client";

import { useCallback, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { env } from "@/config/env";
import { formatHype } from "@/lib/units";
import { RARITY_COLOR, RARITY_LABEL, rarityFromOdds } from "@/protocol/rarity";
import { FWA_PARAMS } from "@/protocol/params";
import { useProtocol } from "@/protocol/provider";
import type { Listing, ListingsQuery, PoolSnapshot, RarityTier } from "@/protocol/types";
import { useCollections, useListings, usePoolSnapshot, usePositions } from "@/state/queries";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/Button";
import { SkeletonCard, SkeletonRow } from "@/components/ui/Skeleton";
import { FiltersBar, type ViewMode } from "./FiltersBar";
import { HeroPrizeStack } from "./HeroPrizeStack";
import { ListingCard, ListingRow } from "./ListingCard";
import { ListingDetailDrawer } from "./ListingDetailDrawer";
import { PoolStatCards } from "./PoolStatCards";
import { PoolMissionHud } from "./PoolMissionHud";
import { PurchaseSidebar } from "./PurchaseSidebar";
import { RandomnessFlightDeck } from "@/components/tx/RandomnessFlightDeck";
import { ProtocolPrelaunch } from "@/components/ui/ProtocolPrelaunch";

const PAGE_SIZE = 24;
const MAX_POOL_POSITIONS = 1_000;

export function PoolScreen() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { prelaunch, writesEnabled } = useProtocol();

  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [visibleLimit, setVisibleLimit] = useState(PAGE_SIZE);
  const [filters, setFilters] = useState<
    Pick<ListingsQuery, "search" | "collections" | "rarities" | "sort" | "direction">
  >({ sort: "value", direction: "desc" });

  // One authoritative active/staged inventory feeds both the hero deck and the
  // explorer. The explorer reveals it in 24-card slices without refetching.
  const query: ListingsQuery = useMemo(
    () => ({ view: "deposits", limit: MAX_POOL_POSITIONS, ...filters }),
    [filters],
  );

  const { data: snapshot } = usePoolSnapshot();
  const { data: page, isLoading, isError, refetch } = useListings(query);
  const { data: collections } = useCollections();
  const { data: positions } = usePositions();

  const inFlightTickets = useMemo(
    () =>
      (positions?.pendingAcquisitions ?? []).filter((ticket) =>
        ["requested", "randomness_pending", "randomness_cached", "processing"].includes(ticket.phase),
      ),
    [positions],
  );

  // Deep-linkable detail drawer (?listing=<id>)
  const listingParam = searchParams.get("listing");
  const openListingId = listingParam && /^\d+$/.test(listingParam) ? BigInt(listingParam) : null;
  const openListing = useCallback(
    (id: bigint) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("listing", id.toString());
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [router, pathname, searchParams],
  );
  const closeListing = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("listing");
    router.replace(params.size > 0 ? `${pathname}?${params.toString()}` : pathname, { scroll: false });
  }, [router, pathname, searchParams]);

  const totalWeight = snapshot?.totalWeight ?? 0n;
  const visibleListings = useMemo(() => page?.items.slice(0, visibleLimit) ?? [], [page?.items, visibleLimit]);
  const poolIsConfirmedEmpty = !prelaunch && snapshot !== undefined && snapshot.activeListingCount === 0;

  return (
    <div className="flex w-full flex-col">
      {/* ------------------------------------------------------------ hero */}
      <section
        className={`relative isolate w-full overflow-x-clip border-b border-line ${
          poolIsConfirmedEmpty
            ? "lg:h-[640px] lg:min-h-[600px]"
            : "lg:h-[calc(100dvh-9.5rem)] lg:min-h-[560px] lg:max-h-[860px]"
        }`}
      >
        <h1 className="sr-only">HWA NFT pool</h1>
        <div aria-hidden className="grid-paper pointer-events-none absolute inset-0 select-none" />
        <div aria-hidden className="aurora pointer-events-none absolute inset-0 select-none" />
        <div aria-hidden className="dot-grid pointer-events-none absolute inset-0 select-none opacity-60" />
        <div className="relative z-10 grid h-full w-full lg:grid-cols-[minmax(0,1fr)_432px]">
          {/* left: stats bar + prize stack */}
          <div className="flex min-h-0 min-w-0 flex-col">
            <HeroStatsBar snapshot={snapshot} listings={page?.items} prelaunch={prelaunch} />
            <PoolMissionHud snapshot={snapshot} inFlightCount={inFlightTickets.length} prelaunch={prelaunch} paused={!writesEnabled} />
            <div className="relative flex min-h-0 flex-1 flex-col items-center justify-center gap-3 overflow-hidden px-4 py-6 lg:py-2">
              {prelaunch ? (
                <ProtocolPrelaunch
                  compact
                  title="The mainnet book is being prepared."
                  detail="No pool, NFT position or $HWA market is live yet. This page will switch to verified on-chain data only after the deployment manifest is published."
                />
              ) : inFlightTickets.length > 0 ? (
                <RandomnessFlightDeck tickets={inFlightTickets} snapshot={snapshot} />
              ) : (
                <HeroPrizeStack listings={page?.items ?? []} snapshot={snapshot} onOpen={openListing} />
              )}
            </div>
          </div>
          {/* One purchase surface, repositioned by CSS so SSR and hydration
              cannot disagree about which responsive variant is mounted. */}
          <PurchaseSidebar
            snapshot={snapshot}
            onOpenListing={openListing}
            className="mx-3 mb-4 overflow-hidden rounded-lg border border-line lg:m-0 lg:h-full lg:rounded-none lg:border-y-0 lg:border-r-0 lg:border-l"
          />
        </div>
      </section>

      {/* ------------------------------------------------------ info strip */}
      <section id="mechanics" className="mx-auto flex w-full max-w-5xl scroll-mt-24 flex-col gap-8 px-6 py-14">
        {/* The loop, one line: a newcomer must get it without reading a page. */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-2">
          {[
            ["Back", "Deposit an NFT with HYPE behind it."],
            ["Draw", "Pay the pool price, get a random NFT."],
            ["Exit", "Keep it, relist it, or take the bid."],
          ].map(([title, detail], i) => (
            <div key={title} className="flex flex-1 items-baseline gap-2">
              <span className="num shrink-0 font-mono text-2xs text-accent">0{i + 1}</span>
              <span className="min-w-0">
                <span className="text-sm font-semibold text-ink">{title}</span>{" "}
                <span className="text-sm text-mute">{detail}</span>
              </span>
            </div>
          ))}
        </div>

        <div className="rounded-xl border border-secondary/30 bg-secondary/8 p-4 sm:p-5">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h3 className="text-lg font-semibold text-ink">$HWA · 1B supply, no minting after launch</h3>
            </div>
            <a href="/rewards" className="text-xs font-medium text-accent hover:underline">Inspect reward accounting →</a>
          </div>
          <div className="mt-4 grid gap-2 sm:grid-cols-3">
            {[
              ["500M", "Liquidity, locked forever"],
              ["300M", "Earned by playing"],
              ["100M", "Ecosystem"],
            ].map(([cap, label]) => (
              <div key={label} className="rounded-lg border border-line/70 bg-inset/60 px-3 py-2.5">
                <div className="font-mono text-base font-semibold text-ink">{cap}</div>
                <div className="text-2xs text-mute">{label}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-3 rounded-xl border border-amber/25 bg-amber/6 p-4 sm:flex-row sm:items-center sm:gap-5">
          <span className="mlabel shrink-0 rounded-full border border-amber/25 px-2.5 py-1 text-amber">RISK</span>
          <p className="text-sm leading-relaxed text-dim">
            Your NFT can be drawn at any time.{" "}
            <span className="font-medium text-ink">No outcome is known before settlement</span>, and HWA rewards have no
            guaranteed value.
          </p>
        </div>

        <div className="flex items-end justify-between border-t border-line/60 pt-8">
          <h2 className="text-xl font-semibold text-ink">Live protocol state</h2>
          <span className="hidden text-2xs text-faint sm:block">
            {env.dataMode === "mock" ? "Deterministic demo telemetry" : "Read from the contracts"}
          </span>
        </div>

        <PoolStatCards prelaunch={prelaunch} />

        <div className="grid w-full gap-3 md:grid-cols-3" data-testid="param-pills">
          {(
            [
              ["Surcharge", `${(snapshot?.surchargeBps ?? FWA_PARAMS.surchargeBps) / 100}%`],
              ["Default drift", `${(snapshot?.defaultDriftBps ?? FWA_PARAMS.defaultDriftBps) / 100}%`],
              ["Min backing", `${formatHype(snapshot?.minBacking ?? FWA_PARAMS.minBacking)} HYPE`],
              ["Purchaser window", "24h"],
              ["Finalize window", "7d"],
              ["Max batch", String(snapshot?.maxBatch ?? FWA_PARAMS.maxBatch)],
            ] as const
          ).map(([label, value]) => (
            <div
              key={label}
              className="flex items-center justify-between gap-3 rounded-xl border border-line/60 bg-elevated/40 px-4 py-3"
            >
              <span className="text-sm text-mute">{label}</span>
              <span className="num font-mono text-sm font-semibold text-ink">{value}</span>
            </div>
          ))}
        </div>
      </section>

      {/* --------------------------------------------------- pool explorer */}
      <section id="pool" className="mx-auto w-full max-w-[1600px] scroll-mt-20 px-3 pb-20 sm:px-6">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
          <div>
            <div className="mlabel mb-1 text-secondary-readable">MARKET DEPTH</div>
            <h2 className="text-2xl font-semibold text-ink">Pool positions</h2>
            <p className="mt-1 text-xs text-mute">
              Every active position, plus staged deposits waiting for the sequencer.
            </p>
          </div>
          {page && (
            <span className="mlabel text-mute">
              {visibleListings.length} of {page.total}
            </span>
          )}
        </div>

        <FiltersBar
          query={query}
          onChange={(patch) => {
            setFilters((f) => ({ ...f, ...patch }));
            setVisibleLimit(PAGE_SIZE);
          }}
          collections={collections ?? []}
          viewMode={viewMode}
          onViewMode={setViewMode}
        />

        <div className="mt-3">
          {prelaunch ? (
            <div className="card">
              <EmptyState
                title="No live positions before deployment"
                detail="The pool explorer will populate from the mainnet contracts and indexer after launch. No simulated listings are mixed into this view."
              />
            </div>
          ) : isLoading && !page ? (
            viewMode === "grid" ? (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
                {Array.from({ length: 8 }).map((_, i) => (
                  <SkeletonCard key={i} />
                ))}
              </div>
            ) : (
              <div className="rounded-lg border border-line bg-panel">
                {Array.from({ length: 8 }).map((_, i) => (
                  <SkeletonRow key={i} />
                ))}
              </div>
            )
          ) : isError ? (
            <div className="card border-red/30">
              <EmptyState
                title="Couldn't load listings"
                detail="The data source did not respond. This is a connection problem, not an empty pool."
                action={
                  <Button variant="outline" onClick={() => void refetch()}>
                    Retry
                  </Button>
                }
              />
            </div>
          ) : !page || page.items.length === 0 ? (
            <div className="card">
              <EmptyState
                title="The pool is empty"
                detail="No active NFT positions. Deposit an NFT with HYPE backing to open the pool."
                action={
                  <Button variant="primary" onClick={() => router.push("/deposit")}>
                    Deposit an NFT
                  </Button>
                }
              />
            </div>
          ) : viewMode === "grid" ? (
            <div className="deck-tilt grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6" data-testid="listing-grid">
              {visibleListings.map((l) => (
                <ListingCard key={l.id.toString()} listing={l} totalWeight={totalWeight} onOpen={openListing} />
              ))}
            </div>
          ) : (
            <div className="card overflow-x-auto" data-testid="listing-list">
              <div className="grid grid-cols-[36px_minmax(0,1.6fr)_repeat(3,minmax(0,1fr))_70px] gap-3 border-b border-line px-3 py-1.5 text-2xs uppercase tracking-wide text-faint sm:grid-cols-[36px_minmax(0,1.6fr)_repeat(4,minmax(0,1fr))_70px]">
                <span />
                <span>Position</span>
                <span className="text-right">Backing</span>
                <span className="hidden text-right sm:block">1-in-N</span>
                <span className="text-right">Odds</span>
                <span className="text-right">Rarity</span>
                <span className="text-right">Age</span>
              </div>
              {visibleListings.map((l) => (
                <ListingRow key={l.id.toString()} listing={l} totalWeight={totalWeight} onOpen={openListing} />
              ))}
            </div>
          )}
        </div>

        {page && visibleListings.length < page.items.length && (
          <div className="mt-4 flex justify-center">
            <Button variant="secondary" onClick={() => setVisibleLimit((n) => n + PAGE_SIZE)}>
              Show more ({page.items.length - visibleListings.length} left)
            </Button>
          </div>
        )}
      </section>

      <ListingDetailDrawer listingId={openListingId} snapshot={snapshot} onClose={closeListing} />
    </div>
  );
}

// ---------------------------------------------------------------- pieces

function HeroStatsBar({
  snapshot,
  listings,
  prelaunch = false,
}: {
  snapshot?: PoolSnapshot;
  listings?: Listing[];
  prelaunch?: boolean;
}) {
  // Probability mass per rarity band: the chance an acquisition lands in it.
  const distribution = useMemo(() => {
    if (!listings || listings.length === 0 || !snapshot || snapshot.totalWeight <= 0n) return null;
    if (listings.length !== snapshot.activeListingCount) return null;
    const byTier = new Map<RarityTier, bigint>();
    for (const l of listings) {
      if (l.status !== "active") continue;
      const tier = rarityFromOdds(l.weight, snapshot.totalWeight);
      byTier.set(tier, (byTier.get(tier) ?? 0n) + l.weight);
    }
    return (["common", "uncommon", "rare", "epic", "grail"] as RarityTier[])
      .map((tier) => ({ tier, pct: Number(((byTier.get(tier) ?? 0n) * 10_000n) / snapshot.totalWeight) / 100 }))
      .filter((d) => d.pct > 0);
  }, [listings, snapshot]);

  const confirmedEmpty = snapshot !== undefined && snapshot.activeListingCount === 0;
  const distributionIncomplete =
    snapshot !== undefined && listings !== undefined && listings.length !== snapshot.activeListingCount;

  return (
    <div className="flex h-14 shrink-0 items-center border-b border-line bg-bg/90 pl-4" data-testid="pool-stats">
      <div className="flex w-full min-w-0 items-center gap-3 overflow-x-auto pr-4">
        <span className="mlabel shrink-0 text-mute">Draw odds</span>
        {prelaunch ? (
          <>
            <span className="flex shrink-0 items-center gap-2 rounded-full border border-amber/30 bg-amber/8 px-2.5 py-1">
              <span aria-hidden className="size-1.5 rounded-full bg-amber" />
              <span className="mlabel text-amber">Pre-launch</span>
            </span>
            <span className="num shrink-0 font-mono text-2xs text-mute">no live odds</span>
            <span className="num shrink-0 font-mono text-2xs text-mute">chain 999</span>
          </>
        ) : distribution ? (
          distribution.map((d) => (
            <span
              key={d.tier}
              className="flex shrink-0 items-center gap-1.5 rounded-md border border-line px-2 py-1"
              title={`Chance an acquisition lands on a ${RARITY_LABEL[d.tier]} position`}
            >
              <span aria-hidden className="size-2 rounded-[3px]" style={{ background: RARITY_COLOR[d.tier] }} />
              <span className="mlabel text-dim">{RARITY_LABEL[d.tier]}</span>
              <span className="num font-mono text-2xs font-semibold text-ink">{d.pct.toFixed(1)}%</span>
            </span>
          ))
        ) : confirmedEmpty ? (
          <>
            <span className="flex shrink-0 items-center gap-2 rounded-full border border-accent/25 bg-accent/7 px-2.5 py-1">
              <span aria-hidden className="relative size-1.5 rounded-full bg-accent" />
              <span className="mlabel text-accent">Ready for genesis</span>
            </span>
            <span className="num shrink-0 font-mono text-2xs text-mute">0 active</span>
            <span className="num shrink-0 font-mono text-2xs text-mute">{snapshot.stagedListingCount} staged</span>
          </>
        ) : distributionIncomplete ? (
          <span className="text-2xs text-mute">Rarity distribution unavailable: indexed pool exceeds the 1,000-row display bound.</span>
        ) : (
          Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex shrink-0 items-center gap-1.5">
              <div className="skeleton size-2 rounded-[3px]" />
              <div className="skeleton h-3 w-20" />
            </div>
          ))
        )}
      </div>
      <a
        href="#pool"
        className="mlabel hidden h-14 shrink-0 items-center justify-center border-l border-line px-6 text-mute transition-colors hover:text-accent lg:flex"
      >
        View Pool ↓
      </a>
    </div>
  );
}
