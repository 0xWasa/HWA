"use client";

import { useEffect, useMemo, useState } from "react";
import { env } from "@/config/env";
import { chainLabel } from "@/config/chains";
import { conciseError } from "@/lib/errors";
import { formatHype } from "@/lib/units";
import { FWA_PARAMS } from "@/protocol/params";
import { ProtocolError } from "@/protocol/errors";
import { useAccountState, useProtocol } from "@/protocol/provider";
import type { AcquisitionTicket, ListingsQuery, PoolSnapshot, TrackedTransaction } from "@/protocol/types";
import { useProtocolAction } from "@/state/actions";
import { useAcquisitionQuote, useListings, useNativeBalance, usePositions, useTrackedTxs } from "@/state/queries";
import { Button } from "@/components/ui/Button";
import { Hype } from "@/components/ui/Hype";
import { InfoTip } from "@/components/ui/InfoTip";
import { Segmented } from "@/components/ui/Segmented";
import { SkeletonRow } from "@/components/ui/Skeleton";
import { TicketProgress } from "@/components/tx/TicketProgress";
import { AcquisitionFeedRow } from "./AcquisitionFeedRow";
import { FeedRow } from "./FeedRow";
import { QtySlider } from "./QtySlider";

type FeedView = ListingsQuery["view"];
type SortKey = "value" | "date" | "name";

/**
 * The fwa.fun purchase sidebar: feed segment → sort bar → feed rows →
 * sticky purchase box (quantity slider, guarded quote, pressable CTA).
 */
export function PurchaseSidebar({
  snapshot,
  onOpenListing,
  className = "",
}: {
  snapshot?: PoolSnapshot;
  onOpenListing: (id: bigint) => void;
  className?: string;
}) {
  const [view, setView] = useState<FeedView>("recent");
  const [sort, setSort] = useState<SortKey>("date");
  const [dir, setDir] = useState<"asc" | "desc">("desc");
  const { prelaunch } = useProtocol();

  // "Recent" is the acquisition feed (what was bought and how it settled);
  // the other tabs are listing feeds.
  const isAcquisitionFeed = view === "recent";
  const { data: feed, isLoading } = useListings({
    view: isAcquisitionFeed ? "recent" : view,
    sort,
    direction: dir,
    limit: 40,
    ...(isAcquisitionFeed ? { statuses: ["allocated", "settled"] as const } : {}),
  });
  const totalWeight = snapshot?.totalWeight ?? 0n;

  const toggleSort = (key: SortKey) => {
    if (sort === key) setDir((d) => (d === "desc" ? "asc" : "desc"));
    else {
      setSort(key);
      setDir("desc");
    }
  };

  return (
    <aside
      data-testid="purchase-sidebar"
      aria-label="Purchase feed"
      className={`flex min-h-0 flex-col border-line bg-bg ${className}`}
    >
      {/* Feed views */}
      <div className="hidden h-14 shrink-0 items-center border-b border-line px-3 sm:px-4 lg:flex">
        <Segmented
          ariaLabel="Choose purchase feed"
          fullWidth
          value={view}
          onChange={(v) => setView(v)}
          options={[
            { value: "recent", label: "Recent" },
            { value: "top", label: "Top" },
            { value: "pool", label: "Pool" },
            { value: "deposits", label: "Deposits" },
          ]}
        />
      </div>

      {/* Sort bar */}
      <div className="hidden h-9 shrink-0 items-center gap-1 border-b border-line bg-elevated/40 px-3 sm:px-4 lg:flex">
        <span className="mr-auto text-3xs text-mute">Sort</span>
        {(
          [
            ["value", "Value"],
            ["date", "Date"],
            ["name", "Name"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => toggleSort(key)}
            aria-pressed={sort === key}
            aria-label={
              sort === key
                ? `Sorted by ${label}, ${dir === "desc" ? "descending" : "ascending"} — activate to flip direction`
                : `Sort by ${label}`
            }
            className={`inline-flex h-6 min-w-12 items-center justify-center gap-1 rounded-xs px-1.5 text-3xs font-semibold transition-colors ${
              sort === key ? "bg-control text-ink" : "text-mute hover:text-dim"
            }`}
          >
            {label}
            {sort === key && <span aria-hidden>{dir === "desc" ? "↓" : "↑"}</span>}
          </button>
        ))}
      </div>

      {/* Feed */}
      <div
        className="hidden min-h-0 flex-1 overflow-y-auto lg:block"
        data-testid="sidebar-feed"
        // The purchase box overlaps the scroll end; fade the last rows so a
        // half-visible row reads as "more below" rather than a clipping bug.
        style={{
          maskImage: "linear-gradient(to bottom, black calc(100% - 2.5rem), transparent 100%)",
          WebkitMaskImage: "linear-gradient(to bottom, black calc(100% - 2.5rem), transparent 100%)",
        }}
      >
        {prelaunch ? (
          <div className="px-5 py-8 text-center">
            <div className="mlabel text-amber">PRE-LAUNCH TAPE</div>
            <p className="mt-2 text-xs leading-relaxed text-mute">
              Verified deposits and draws will stream here after the mainnet manifest is published.
            </p>
          </div>
        ) : isLoading && !feed ? (
          Array.from({ length: 7 }).map((_, i) => <SkeletonRow key={i} cols={2} />)
        ) : !feed || feed.items.length === 0 ? (
          <p className="px-4 py-6 text-center text-xs text-mute">Nothing in this feed yet.</p>
        ) : (
          feed.items.map((l) =>
            isAcquisitionFeed ? (
              <AcquisitionFeedRow key={l.id.toString()} listing={l} onOpen={onOpenListing} />
            ) : (
              <FeedRow key={l.id.toString()} listing={l} totalWeight={totalWeight} onOpen={onOpenListing} />
            ),
          )
        )}
      </div>

      {/* Sticky purchase box */}
      <PurchaseBox snapshot={snapshot} />
    </aside>
  );
}

// ------------------------------------------------------------------ box

const DRIFT_PRESETS = [500, 1_000, 2_000] as const;

export function PurchaseBox({ snapshot }: { snapshot?: PoolSnapshot }) {
  const { writesEnabled, prelaunch } = useProtocol();
  const account = useAccountState();
  const [quantity, setQuantity] = useState(1);
  const [driftBps, setDriftBps] = useState<number>(FWA_PARAMS.defaultDriftBps);
  const [reviewing, setReviewing] = useState(false);

  const quote = useAcquisitionQuote(quantity, driftBps);
  const { data: balance } = useNativeBalance();
  const { data: trackedTxs = [] } = useTrackedTxs();
  const recentAcquireTxs = useMemo(() => {
    const cutoff = Math.floor(Date.now() / 1000) - 15 * 60;
    return trackedTxs.filter(
      (tx) =>
        tx.kind === "acquire" &&
        tx.phase === "completed" &&
        tx.createdAt >= cutoff &&
        (tx.meta.purchaser
          ? tx.meta.purchaser.toLowerCase() === account.address?.toLowerCase()
          : !!tx.meta.requestIds),
    );
  }, [trackedTxs, account.address]);
  const { data: positions } = usePositions({
    refetchInterval: recentAcquireTxs.length > 0 ? 4_000 : false,
  });
  const action = useProtocolAction();

  const maxBatch = snapshot?.maxBatch ?? FWA_PARAMS.maxBatch;
  const acquisitionsOpen = snapshot?.acquisitionsEnabled ?? false;
  const connected = account.status === "connected";
  const insufficient = connected && quote.data !== undefined && balance !== undefined && balance < quote.data.total;

  const myTickets: AcquisitionTicket[] = useMemo(() => {
    if (!positions) return [];
    const nowS = Math.floor(Date.now() / 1000);
    return positions.pendingAcquisitions.filter((t) => {
      const inFlight = ["requested", "randomness_pending", "randomness_cached", "processing"].includes(t.phase);
      return inFlight || nowS - t.requestedAt < 300;
    });
  }, [positions]);
  const ticketRequestIds = useMemo(
    () => new Set((positions?.pendingAcquisitions ?? []).map((ticket) => ticket.requestId.toString())),
    [positions],
  );
  const discoveringTxs = useMemo(
    () =>
      recentAcquireTxs.filter((tx) => {
        if (tx.meta.ticketDiscoveredAt) return false;
        const requestIds = tx.meta.requestIds?.split(",").filter(Boolean) ?? [];
        return requestIds.length === 0 || requestIds.some((requestId) => !ticketRequestIds.has(requestId));
      }),
    [recentAcquireTxs, ticketRequestIds],
  );

  const blocker = ((): { label: string; sub?: string } | null => {
    if (prelaunch) return { label: "Launch pending", sub: "Mainnet contracts are not deployed." };
    if (!writesEnabled) return { label: "Protocol paused", sub: "Launch pending - all public operations are disabled." };
    if (!snapshot) return { label: "Loading pool…" };
    if (!acquisitionsOpen)
      return {
        label: "Acquisitions closed",
        sub: snapshot.activeListingCount === 0 ? "The pool is empty." : "Purchases are disabled by the protocol.",
      };
    return null;
  })();

  const ticketStatus = blocker
    ? {
        label: prelaunch ? "PRE-LAUNCH" : "MARKET CLOSED",
        shell: "border-amber/25 bg-amber/8",
        dot: "bg-amber",
        text: "text-amber",
      }
    : quote.isError
      ? { label: "QUOTE OFFLINE", shell: "border-red/25 bg-red/8", dot: "bg-red", text: "text-red" }
      : quote.freshness === "refreshing"
        ? { label: "SYNCING", shell: "border-chain/25 bg-chain/8", dot: "anim-pulse bg-chain", text: "text-chain" }
        : { label: "LIVE QUOTE", shell: "border-green/25 bg-green/8", dot: "bg-green", text: "text-green" };

  async function onAcquire() {
    if (!quote.data) return;
    const reviewedQuote = quote.data;
    const tx = await action.run(async (client) => {
      if (quote.freshness === "stale") {
        const fresh = await quote.refetch();
        if (!fresh.data) throw new ProtocolError("RPC_DOWN", "The stale quote could not be refreshed.");
        if (
          fresh.data.total !== reviewedQuote.total ||
          fresh.data.maxAcquisitionFeePerItem !== reviewedQuote.maxAcquisitionFeePerItem ||
          fresh.data.minWeightedValue !== reviewedQuote.minWeightedValue
        ) {
          setReviewing(false);
          throw new ProtocolError("QUOTE_STALE", "The quote changed. Review the refreshed values before signing.");
        }
      }
      return client.acquire({ quote: reviewedQuote });
    });
    if (tx) setReviewing(false);
  }

  return (
    <div
      className="shrink-0 border-t border-line bg-bg px-4 py-3"
      data-testid="acquire-panel"
      aria-label="Acquire from pool"
    >
      <div className="mx-auto flex w-full max-w-[28rem] flex-col gap-2.5">
        <div className="order-ticket-head flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <span
              aria-hidden
              className="order-ticket-mark grid size-8 shrink-0 place-items-center rounded-md border border-accent/25 bg-accent/8 font-mono text-xs font-bold text-accent"
            >
              ↗
            </span>
            <div className="min-w-0">
              <div className="mlabel text-accent">DRAW TICKET</div>
              <div className="mt-1 truncate text-3xs text-mute">Pay HYPE · receive one random NFT position</div>
            </div>
          </div>
          <span className={`flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-1 ${ticketStatus.shell}`}>
            <span aria-hidden className={`relative size-1.5 rounded-full ${ticketStatus.dot}`} />
            <span className={`mlabel text-3xs ${ticketStatus.text}`}>{ticketStatus.label}</span>
          </span>
        </div>

        <div className="order-ticket-metrics grid grid-cols-3 overflow-hidden rounded-md border border-line/70 bg-inset/55">
          <TicketMetric
            label="ENTRY"
            value={quote.data ? formatHype(quote.data.total / BigInt(quantity)) : "—"}
            suffix="HYPE"
            accent
          />
          <TicketMetric label="POOL DEPTH" value={snapshot ? formatHype(snapshot.totalBacking) : "—"} suffix="HYPE" />
          <TicketMetric label="DRAW ODDS" value="INVERSE" suffix="BACKING" />
        </div>

        {/* Ticket stub tear line */}
        <div aria-hidden className="ticket-perfo my-0.5" />

        {/* Quantity + freshness */}
        <div className="flex items-end justify-between gap-4">
          <span className="text-2xs leading-none text-mute">Order size</span>
          <div className="flex items-center gap-2">
            <span className="num font-mono text-2xs text-mute" data-testid="qty-value">
              {quantity} NFT{quantity > 1 ? "s" : ""}
            </span>
            <QuoteFreshnessBadge freshness={quote.freshness} onRefresh={quote.refresh} quotedAt={quote.data?.quotedAt} />
          </div>
        </div>
        <QtySlider value={quantity} max={maxBatch} onChange={setQuantity} />

        {/* Drift tolerance */}
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-1 text-2xs text-mute">
            Max settlement drift
            <InfoTip>
              The pool can move while randomness is in flight. Your entry is refunded if its settlement value moves
              against you by more than this limit. Protocol default: 10%.
            </InfoTip>
          </span>
          <div className="flex gap-1">
            {DRIFT_PRESETS.map((bps) => (
              <button
                key={bps}
                data-testid={`drift-${bps}`}
                onClick={() => setDriftBps(bps)}
                aria-pressed={driftBps === bps}
                className={`h-6 rounded-xs px-1.5 text-3xs font-semibold transition-colors ${
                  driftBps === bps ? "bg-control text-accent" : "text-mute hover:text-dim"
                }`}
              >
                {bps / 100}%
              </button>
            ))}
          </div>
        </div>

        {/* Errors */}
        {action.error && (
          <div className="rounded-sm border border-red/30 bg-red/10 p-2 text-2xs" role="alert">
            <div className="font-semibold text-red">{action.error.title}</div>
            {action.error.detail && <div className="mt-0.5 text-dim">{action.error.detail}</div>}
          </div>
        )}
        {quote.isError && (
          <div className="rounded-sm border border-red/30 bg-red/10 p-2 text-2xs text-red">
            Quote unavailable — {conciseError(quote.error)}.
            <button className="ml-1 underline" onClick={quote.refresh}>
              Retry
            </button>
          </div>
        )}

        {/* CTA / review */}
        {blocker ? (
          <div className="rounded-lg border border-line bg-control/50 p-3 text-center">
            <div className="text-sm font-medium text-dim">{blocker.label}</div>
            {blocker.sub && <div className="mt-0.5 text-2xs text-mute">{blocker.sub}</div>}
          </div>
        ) : !connected ? (
          <Button variant="primary" size="lg" className="w-full" onClick={account.connect} data-testid="acquire-connect">
            Connect wallet to acquire
          </Button>
        ) : account.isWrongNetwork ? (
          <Button
            variant="primary"
            size="lg"
            className="w-full"
            data-testid="acquire-switch"
            onClick={() => void account.switchToAppNetwork()}
          >
            Switch to {chainLabel(env.chainId)}
          </Button>
        ) : discoveringTxs.length > 0 ? (
          <AcquisitionDiscovery tx={discoveringTxs[0]!} />
        ) : !reviewing ? (
          <Button
            variant="primary"
            size="lg"
            className="w-full"
            disabled={!quote.data || insufficient}
            data-testid="acquire-review"
            onClick={() => {
              action.clearError();
              setReviewing(true);
            }}
          >
            <span className="block min-w-0 truncate" data-testid="quote-total">
              {insufficient
                ? "Insufficient HYPE balance"
                : quote.data
                  ? `Review draw · ${quantity} NFT${quantity > 1 ? "s" : ""} · ${formatHype(quote.data.total)} HYPE`
                  : "Loading quote…"}
            </span>
          </Button>
        ) : (
          <ReviewBlock
            quantity={quantity}
            total={quote.data?.total ?? 0n}
            poolFee={quote.data?.poolFeePerItem ?? 0n}
            serviceFee={quote.data?.serviceFeePerItem ?? 0n}
            maxFeePerItem={quote.data?.maxAcquisitionFeePerItem ?? 0n}
            driftBps={driftBps}
            stale={quote.freshness === "stale"}
            submitting={action.submitting}
            onCancel={() => setReviewing(false)}
            onConfirm={() => void onAcquire()}
          />
        )}

        {/* Caption — price anatomy + honesty, fwa.fun style */}
        <p className="w-full text-center text-2xs leading-tight text-mute" data-testid="quote-caption">
          {quote.data ? (
            <>
              {formatHype(quote.data.poolFeePerItem)} pool + {formatHype(quote.data.serviceFeePerItem)} randomness per
              NFT ·{" "}
            </>
          ) : null}
          one <span className="font-medium text-dim">verifiably random</span> position per entry · lower-backed NFTs
          have higher draw odds.
          {connected && balance !== undefined && (
            <span className={insufficient ? "text-red" : ""}>
              {" "}
              Balance <Hype wei={balance} maxDecimals={3} unit={false} /> HYPE.
            </span>
          )}
        </p>

        {/* In-flight requests + reveal */}
        {myTickets.length > 0 && (
          <div className="max-h-56 space-y-2 overflow-y-auto border-t border-line-subtle pt-2">
            {myTickets.map((t) => (
              <TicketProgress key={t.requestId.toString()} ticket={t} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function AcquisitionDiscovery({ tx }: { tx: TrackedTransaction }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => tick((value) => value + 1), 1_000);
    return () => clearInterval(timer);
  }, []);
  const elapsed = Math.max(0, Math.floor(Date.now() / 1000) - tx.updatedAt);
  const requestIds = tx.meta.requestIds?.split(",").filter(Boolean) ?? [];
  const delayed = elapsed >= 90;

  return (
    <div
      className="anim-fade-up rounded-lg border border-chain/35 bg-chain/8 p-3"
      data-testid="acquire-discovery"
      role="status"
      aria-live="polite"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="mlabel text-chain">DRAW CONFIRMED</div>
          <div className="mt-1 text-sm font-semibold text-ink">Your ticket is waiting for the random draw.</div>
        </div>
        <span className="num shrink-0 font-mono text-2xs text-chain">{elapsed}s</span>
      </div>
      <div className="mt-2 grid grid-cols-3 gap-1 text-3xs">
        <DiscoveryStep label="Payment" state="done" />
        <DiscoveryStep label="Ticket" state={requestIds.length > 0 ? "done" : "active"} />
        <DiscoveryStep label="Random draw" state="active" />
      </div>
      <p className={`mt-2 text-2xs leading-relaxed ${delayed ? "text-amber" : "text-dim"}`}>
        {delayed
          ? "RPC/indexer sync is slower than usual. Your confirmed ticket remains on-chain; this screen retries automatically and the result will appear without another payment."
          : "The protocol waits for a future authenticated randomness round before selecting the NFT. This normally takes about 30–90 seconds; no action is required."}
      </p>
      {tx.hash && (
        <a
          className="mt-2 inline-flex text-3xs font-medium text-chain hover:underline"
          href={`${env.explorerUrl}/tx/${tx.hash}`}
          target="_blank"
          rel="noreferrer"
        >
          View confirmed transaction ↗
        </a>
      )}
    </div>
  );
}

function DiscoveryStep({ label, state }: { label: string; state: "done" | "active" }) {
  return (
    <div className="flex flex-col gap-1">
      <div className={`h-[3px] rounded-full ${state === "done" ? "bg-green" : "anim-pulse bg-chain"}`} />
      <span className={state === "done" ? "text-green" : "text-chain"}>{label}</span>
    </div>
  );
}
function TicketMetric({
  label,
  value,
  suffix,
  accent = false,
}: {
  label: string;
  value: string;
  suffix: string;
  accent?: boolean;
}) {
  return (
    <div className="min-w-0 border-r border-line/60 px-2 py-2 last:border-r-0">
      <div className="mlabel truncate text-3xs text-faint">{label}</div>
      <div
        className={`num mt-1 flex min-w-0 items-baseline gap-1 font-mono text-2xs font-bold ${accent ? "text-accent" : "text-ink"}`}
      >
        <span className="truncate">{value}</span>
        <span className="shrink-0 text-3xs font-medium text-mute">{suffix}</span>
      </div>
    </div>
  );
}

function QuoteFreshnessBadge({
  freshness,
  quotedAt,
  onRefresh,
}: {
  freshness: "fresh" | "stale" | "refreshing";
  quotedAt?: number;
  onRefresh: () => void;
}) {
  const age = quotedAt ? Math.max(0, Math.floor(Date.now() / 1000 - quotedAt)) : null;
  return (
    <button
      onClick={onRefresh}
      data-testid="quote-freshness"
      data-freshness={freshness}
      title="Refresh quote"
      className={`flex h-5 items-center gap-1 rounded-xs border px-1.5 text-3xs transition-colors ${
        freshness === "stale"
          ? "border-amber/50 text-amber hover:bg-amber/10"
          : freshness === "refreshing"
            ? "border-line text-mute"
            : "border-line text-mute hover:text-dim"
      }`}
    >
      <span
        aria-hidden
        className={`size-1.5 rounded-full ${
          freshness === "stale" ? "bg-amber" : freshness === "refreshing" ? "anim-pulse bg-blue" : "bg-green"
        }`}
      />
      {freshness === "refreshing" ? "refreshing" : freshness === "stale" ? "stale" : age !== null ? `${age}s` : "live"}
    </button>
  );
}

function ReviewBlock({
  quantity,
  total,
  poolFee,
  serviceFee,
  maxFeePerItem,
  driftBps,
  stale,
  submitting,
  onCancel,
  onConfirm,
}: {
  quantity: number;
  total: bigint;
  poolFee: bigint;
  serviceFee: bigint;
  maxFeePerItem: bigint;
  driftBps: number;
  stale: boolean;
  submitting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      className="anim-fade-up space-y-2 rounded-lg border border-secondary/45 bg-secondary-deep/55 p-3"
      data-testid="acquire-review-block"
    >
      <div className="mlabel text-secondary-readable">Review before signing</div>
      <dl className="space-y-1 text-2xs text-dim">
        <div className="flex justify-between">
          <dt>Network</dt>
          <dd className="text-ink">{chainLabel(env.chainId)} · HyperEVM</dd>
        </div>
        <div className="flex justify-between">
          <dt>Action</dt>
          <dd className="text-ink">
            Acquire {quantity} random position{quantity > 1 ? "s" : ""}
          </dd>
        </div>
        <div className="flex justify-between">
          <dt>Pool price / NFT</dt>
          <dd>
            <Hype wei={poolFee} />
          </dd>
        </div>
        <div className="flex justify-between">
          <dt>Randomness service / NFT</dt>
          <dd>
            <Hype wei={serviceFee} />
          </dd>
        </div>
        <div className="flex justify-between border-t border-line-subtle pt-1 text-sm font-semibold text-ink">
          <dt>You send</dt>
          <dd>
            <Hype wei={total} className="text-accent" />
          </dd>
        </div>
        <div className="flex justify-between">
          <dt>Guarded max fee / NFT</dt>
          <dd>
            <Hype wei={maxFeePerItem} />
          </dd>
        </div>
        <div className="flex justify-between">
          <dt>Drift tolerance</dt>
          <dd>{driftBps / 100}%</dd>
        </div>
      </dl>
      {stale && (
        <div className="rounded-xs border border-amber/40 bg-amber/10 p-1.5 text-2xs text-amber">
          Quote is stale — it will be re-checked on-chain before the wallet prompt.
        </div>
      )}
      <div className="grid grid-cols-2 gap-1.5">
        <Button variant="ghost" onClick={onCancel} disabled={submitting}>
          Back
        </Button>
        <Button variant="primary" loading={submitting} onClick={onConfirm} data-testid="acquire-confirm">
          Confirm in wallet
        </Button>
      </div>
    </div>
  );
}
