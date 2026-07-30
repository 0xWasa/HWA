"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { sanitizeLabel, timeAgo } from "@/lib/format";
import { formatOddsPercent } from "@/lib/units";
import { FWA_PARAMS } from "@/protocol/params";
import { useAccountState, useProtocol } from "@/protocol/provider";
import type { ProtocolClient } from "@/protocol/client";
import type { Listing, TrackedTransaction, UserPositions } from "@/protocol/types";
import { useProtocolAction } from "@/state/actions";
import { usePoolSnapshot, usePositions } from "@/state/queries";
import { Button } from "@/components/ui/Button";
import { Countdown } from "@/components/ui/Countdown";
import { EmptyState } from "@/components/ui/EmptyState";
import { Hype } from "@/components/ui/Hype";
import { Panel } from "@/components/ui/Panel";
import { PageHeader } from "@/components/ui/PageHeader";
import { SkeletonRow } from "@/components/ui/Skeleton";
import { NFTImage } from "@/components/nft/NFTImage";
import { TicketProgress } from "@/components/tx/TicketProgress";
import { SettlementDrawer } from "./SettlementDrawer";
import { ProtocolPrelaunch } from "@/components/ui/ProtocolPrelaunch";

type TabId = "deposited" | "allocated" | "pending" | "settled" | "claims";

const OUTCOME_LABEL: Record<NonNullable<Listing["settlement"]>, string> = {
  kept: "Kept NFT",
  relisted: "Kept & relisted",
  bid_accepted: "Bid accepted (HYPE)",
  bid_accepted_tokens: "Bid accepted (HWA)",
  depositor_reclaim_nft: "Depositor reclaimed NFT",
  depositor_reclaim_backing: "Depositor reclaimed backing",
  finalized: "Finalized (default)",
};

export function PositionsScreen() {
  const account = useAccountState();
  const { exitWritesEnabled, prelaunch } = useProtocol();
  const { data: snapshot } = usePoolSnapshot();
  const { data: positions, isLoading } = usePositions();
  const action = useProtocolAction();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<TabId>("deposited");
  const [settling, setSettling] = useState<Listing | null>(null);
  const runClaim = async (
    claim: "earnings" | "acquisitionRefund" | "listingFees",
    submit: (client: ProtocolClient) => Promise<TrackedTransaction>,
  ) => {
    const tx = await action.run(submit);
    if (tx?.phase !== "completed" || !account.address) return;

    const positionsKey = ["positions", account.address] as const;
    // The read-RPC coalesces identical calls for one second. A receipt can
    // therefore confirm while an immediate invalidation still returns the
    // pre-claim value. Cancel that refetch, zero the confirmed claim
    // optimistically, then revalidate once the coalescing window has elapsed.
    await queryClient.cancelQueries({ queryKey: positionsKey });
    queryClient.setQueryData<UserPositions>(positionsKey, (current) => {
      if (!current) return current;
      return {
        ...current,
        claimable: {
          ...current.claimable,
          ...(claim === "earnings" ? { earnings: 0n } : {}),
          ...(claim === "acquisitionRefund" ? { acquisitionRefund: 0n } : {}),
          ...(claim === "listingFees" ? { listingFees: [] } : {}),
        },
      };
    });
    action.clearError();
    window.setTimeout(() => {
      void queryClient.invalidateQueries({ queryKey: positionsKey });
      void queryClient.invalidateQueries({ queryKey: ["balance", account.address] });
    }, 1_500);
  };


  const nowSec = Math.floor(Date.now() / 1000);
  const totalWeight = snapshot?.totalWeight ?? 0n;

  const counts = useMemo(() => {
    if (!positions) return { deposited: 0, allocated: 0, pending: 0, settled: 0, claims: 0 };
    const claimsCount =
      (positions.claimable.earnings > 0n ? 1 : 0) +
      (positions.claimable.acquisitionRefund > 0n ? 1 : 0) +
      positions.claimable.listingFees.length +
      positions.stuck.length;
    return {
      deposited: positions.deposited.length,
      allocated: positions.allocated.length + positions.depositedAllocated.length,
      pending: positions.pendingAcquisitions.filter((t) =>
        ["requested", "randomness_pending", "randomness_cached", "processing"].includes(t.phase),
      ).length,
      settled: positions.settled.length,
      claims: claimsCount,
    };
  }, [positions]);

  if (prelaunch) {
    return (
      <Shell>
        <ProtocolPrelaunch
          title="No mainnet positions exist yet."
          detail="Deposits, allocations, settlements and claims will be read directly from the deployed HWA contracts. The pre-launch interface does not invent wallet positions."
          compact
        />
      </Shell>
    );
  }

  if (account.status !== "connected") {
    return (
      <Shell>
        <EmptyState
          title="Connect a wallet to see your positions"
          detail="Deposits, allocations, pending acquisitions, refunds and earnings live here."
          action={
            <Button variant="primary" onClick={account.connect} loading={account.status === "connecting"}>
              Connect wallet
            </Button>
          }
        />
      </Shell>
    );
  }

  const depositorAllocated = positions?.depositedAllocated ?? [];

  const TABS: { id: TabId; label: string; count: number }[] = [
    { id: "deposited", label: "Deposited", count: counts.deposited },
    { id: "allocated", label: "Allocated", count: counts.allocated },
    { id: "pending", label: "Pending", count: counts.pending },
    { id: "settled", label: "Settled", count: counts.settled },
    { id: "claims", label: "Refunds & Earnings", count: counts.claims },
  ];

  return (
    <Shell>
      <div role="tablist" aria-label="Position categories" className="flex flex-wrap items-center gap-1 border-b border-line">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            data-testid={`tab-${t.id}`}
            onClick={() => setTab(t.id)}
            className={`relative flex items-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors ${
              tab === t.id ? "text-accent" : "text-mute hover:text-dim"
            }`}
          >
            {t.label}
            {t.count > 0 && (
              <span
                className={`rounded-full px-1.5 text-2xs font-semibold ${
                  tab === t.id ? "bg-accent/15 text-accent" : "bg-control text-mute"
                }`}
              >
                {t.count}
              </span>
            )}
            {tab === t.id && <span aria-hidden className="absolute inset-x-2 bottom-0 h-px bg-accent" />}
          </button>
        ))}
      </div>

      {isLoading || !positions ? (
        <div className="rounded-md border border-line bg-panel">
          {Array.from({ length: 4 }).map((_, i) => (
            <SkeletonRow key={i} />
          ))}
        </div>
      ) : (
        <>
          {/* ------------------------------------------------ deposited */}
          {tab === "deposited" &&
            (positions.deposited.length === 0 ? (
              <PanelEmpty
                title="No deposits"
                detail="Deposit an NFT with HYPE backing to earn a share of every acquisition fee."
                action={
                  <Link href="/deposit">
                    <Button variant="primary">Deposit an NFT</Button>
                  </Link>
                }
              />
            ) : (
              <div className="space-y-2" data-testid="deposited-list">
                {positions.deposited.map((l) => {
                  const inFlightLock = (snapshot?.pendingAcquisitions ?? 0) > 0;
                  return (
                    <PositionRow key={l.id.toString()} listing={l}>
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-2xs text-mute">
                        <span>
                          Backing <Hype wei={l.backing} maxDecimals={3} className="text-dim" />
                        </span>
                        {l.status === "active" && (
                          <span>
                            Odds <span className="num font-mono text-dim">{formatOddsPercent(l.weight, totalWeight)}</span>
                          </span>
                        )}
                        {l.pendingFees > 0n && (
                          <span>
                            Fees accrued <Hype wei={l.pendingFees} maxDecimals={4} className="text-accent" />
                          </span>
                        )}
                        {l.isCrown && <span className="text-amber">♛ crown — pot accrues to this position</span>}
                        {l.status === "staged" && (
                          <span className="text-amber">staged — activates when the sequencer is idle</span>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        {l.pendingFees > 0n && (
                          <Button
                            size="xs"
                            variant="outline"
                            onClick={() => void action.run((c) => c.claimListingFees({ listingIds: [l.id] }))}
                          >
                            Claim fees
                          </Button>
                        )}
                        <Button
                          size="xs"
                          variant="secondary"
                          disabled={!exitWritesEnabled || inFlightLock}
                          title={
                            inFlightLock
                              ? "Exits are locked while an acquisition request is in flight — retry once it settles."
                              : undefined
                          }
                          data-testid={`withdraw-${l.id}`}
                          onClick={() => void action.run((c) => c.withdrawListing({ listingId: l.id }))}
                        >
                          Withdraw
                        </Button>
                      </div>
                      {inFlightLock && (
                        <p className="w-full text-2xs text-faint">
                          Withdrawals are briefly locked: {snapshot?.pendingAcquisitions} acquisition
                          {(snapshot?.pendingAcquisitions ?? 0) > 1 ? "s" : ""} in flight.
                        </p>
                      )}
                    </PositionRow>
                  );
                })}
              </div>
            ))}

          {/* ------------------------------------------------ allocated */}
          {tab === "allocated" && (
            <div className="space-y-3">
              {positions.allocated.length === 0 && depositorAllocated.length === 0 && (
                <PanelEmpty
                  title="Nothing awaiting settlement"
                  detail="When an acquisition allocates a position to you — or one of your deposits is acquired — the settlement choices appear here."
                />
              )}

              {positions.allocated.map((l) => {
                const winEnd = (l.allocatedAt ?? nowSec) + (snapshot?.settlementWindowSec ?? FWA_PARAMS.settlementWindowSec);
                const finalizeAt = (l.allocatedAt ?? nowSec) + (snapshot?.finalizeWindowSec ?? FWA_PARAMS.finalizeWindowSec);
                const exclusive = nowSec < winEnd;
                return (
                  <PositionRow key={l.id.toString()} listing={l} highlight>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-2xs">
                      <span className="stamp stamp--blue">allocated to you</span>
                      <span className="text-mute">
                        Standing bid{" "}
                        <Hype
                          wei={(l.backing * BigInt(snapshot?.bidPayoutBps ?? FWA_PARAMS.bidPayoutBps)) / 10_000n}
                          maxDecimals={3}
                          className="text-dim"
                        />
                      </span>
                      {exclusive ? (
                        <span className="text-accent">
                          exclusive window <Countdown until={winEnd} />
                        </span>
                      ) : nowSec < finalizeAt ? (
                        <span className="text-amber">depositor may resolve · finalize <Countdown until={finalizeAt} /></span>
                      ) : (
                        <span className="text-amber">anyone can finalize now</span>
                      )}
                    </div>
                    <Button size="xs" variant="primary" data-testid={`settle-open-${l.id}`} onClick={() => setSettling(l)}>
                      Settle
                    </Button>
                  </PositionRow>
                );
              })}

              {depositorAllocated.map((l) => {
                const winEnd = (l.allocatedAt ?? nowSec) + (snapshot?.settlementWindowSec ?? FWA_PARAMS.settlementWindowSec);
                const finalizeAt = (l.allocatedAt ?? nowSec) + (snapshot?.finalizeWindowSec ?? FWA_PARAMS.finalizeWindowSec);
                const purchaserExclusive = nowSec < winEnd;
                const canFinalize = nowSec >= finalizeAt;
                return (
                  <PositionRow key={`dep-${l.id.toString()}`} listing={l}>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-2xs">
                      <span className="stamp stamp--amber stamp--tilt-r">your deposit — acquired</span>
                      {purchaserExclusive ? (
                        <span className="text-mute">
                          purchaser deciding · your options open in <Countdown until={winEnd} />
                        </span>
                      ) : canFinalize ? (
                        <span className="text-amber">unresolved for 7d — anyone can finalize</span>
                      ) : (
                        <span className="text-accent">purchaser window elapsed — you may resolve</span>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      {!purchaserExclusive && !canFinalize && (
                        <>
                          <Button
                            size="xs"
                            variant="secondary"
                            title="Economic equivalent of the purchaser keeping the NFT: you receive the standing-bid payout."
                            onClick={() =>
                              void action.run((c) =>
                                c.settle({ listingId: l.id, choice: { kind: "depositorReclaimBacking" } }),
                              )
                            }
                          >
                            Reclaim backing
                          </Button>
                          <Button
                            size="xs"
                            variant="secondary"
                            title="Economic equivalent of accept-bid: the NFT returns to you."
                            onClick={() =>
                              void action.run((c) => c.settle({ listingId: l.id, choice: { kind: "depositorReclaimNft" } }))
                            }
                          >
                            Reclaim NFT
                          </Button>
                        </>
                      )}
                      {canFinalize && (
                        <Button
                          size="xs"
                          variant="outline"
                          onClick={() => void action.run((c) => c.settle({ listingId: l.id, choice: { kind: "finalize" } }))}
                        >
                          Finalize
                        </Button>
                      )}
                      {purchaserExclusive && (
                        <Button size="xs" variant="secondary" disabled title="The purchaser's 24h exclusive window is still open.">
                          Waiting…
                        </Button>
                      )}
                    </div>
                  </PositionRow>
                );
              })}

              {action.error && <ActionError error={action.error} />}
            </div>
          )}

          {/* -------------------------------------------------- pending */}
          {tab === "pending" &&
            (positions.pendingAcquisitions.length === 0 ? (
              <PanelEmpty
                title="No acquisition requests"
                detail="Buy a chance from the pool and your randomness requests will be tracked here, in strict settlement order."
                action={
                  <Link href="/">
                    <Button variant="primary">Go to pool</Button>
                  </Link>
                }
              />
            ) : (
              <div className="space-y-2" data-testid="pending-list">
                {positions.pendingAcquisitions.map((t) => (
                  <TicketProgress key={t.requestId.toString()} ticket={t} />
                ))}
              </div>
            ))}

          {/* -------------------------------------------------- settled */}
          {tab === "settled" &&
            (positions.settled.length === 0 ? (
              <PanelEmpty title="No settled positions yet" detail="Completed settlements and their outcomes land here." />
            ) : (
              <div className="space-y-2">
                {positions.settled.map((l) => (
                  <PositionRow key={l.id.toString()} listing={l} muted>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-2xs text-mute">
                      <span className="stamp stamp--flat">{l.settlement ? OUTCOME_LABEL[l.settlement] : "Settled"}</span>
                      <span>
                        Backing was <Hype wei={l.backing} maxDecimals={3} />
                      </span>
                      {l.allocatedAt && <span>{timeAgo(l.allocatedAt)}</span>}
                    </div>
                  </PositionRow>
                ))}
              </div>
            ))}

          {/* --------------------------------------------------- claims */}
          {tab === "claims" && (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <Panel title="Withdrawable HYPE">
                <div className="space-y-2">
                  <ClaimRow
                    label="Earnings (fees + settled backing)"
                    amount={positions.claimable.earnings}
                    cta="Withdraw"
                    testid="claim-earnings"
                    busy={action.submitting}
                    onClick={() =>
                      void runClaim("earnings", (client) => client.withdrawEarnings())
                    }
                  />
                  <ClaimRow
                    label="Acquisition refunds"
                    amount={positions.claimable.acquisitionRefund}
                    cta="Withdraw"
                    testid="claim-refund"
                    busy={action.submitting}
                    onClick={() =>
                      void runClaim("acquisitionRefund", (client) => client.withdrawAcquisitionRefund())
                    }
                  />
                  {positions.claimable.listingFees.length > 0 && (
                    <ClaimRow
                      label={`Listing fees (${positions.claimable.listingFees.length} listing${
                        positions.claimable.listingFees.length > 1 ? "s" : ""
                      })`}
                      amount={positions.claimable.listingFees.reduce((a, f) => a + f.amount, 0n)}
                      cta="Claim all"
                      testid="claim-listing-fees"
                      busy={action.submitting}
                      onClick={() =>
                        void runClaim("listingFees", (client) =>
                          client.claimListingFees({ listingIds: positions.claimable.listingFees.map((f) => f.listingId) }),
                        )
                      }
                    />
                  )}
                  {positions.claimable.crownPot > 0n && (
                    <ClaimRow label="Crown pot (paid on crown exit)" amount={positions.claimable.crownPot} />
                  )}
                  {action.error && <ActionError error={action.error} />}
                </div>
              </Panel>

              <Panel title="Stuck NFT deliveries">
                {positions.stuck.length === 0 ? (
                  <p className="py-2 text-2xs text-mute">
                    None. If an NFT transfer fails at settlement, the HYPE still settles and the NFT becomes claimable
                    here.
                  </p>
                ) : (
                  <div className="space-y-2" data-testid="stuck-list">
                    {positions.stuck.map((l) => (
                      <div key={l.id.toString()} className="flex items-center gap-2.5 rounded-sm border border-amber/30 bg-amber/6 p-2">
                        <div className="size-10 shrink-0 overflow-hidden rounded-xs">
                          <NFTImage src={l.nft.imageUrl} alt="" rounded={false} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-xs font-medium text-ink">
                            {sanitizeLabel(l.nft.name, `#${l.tokenId}`)}
                          </div>
                          <div className="text-2xs text-amber">
                            Delivery failed at settlement — the HYPE side settled fine. Retry anytime.
                          </div>
                        </div>
                        <Button
                          size="xs"
                          variant="primary"
                          data-testid={`retry-stuck-${l.id}`}
                          onClick={() => void action.run((c) => c.recoverStuckNFT({ listingId: l.id }))}
                        >
                          Retry delivery
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </Panel>
            </div>
          )}
        </>
      )}

      <SettlementDrawer listing={settling} onClose={() => setSettling(null)} onSettled={() => setTab("settled")} />
    </Shell>
  );
}

// ------------------------------------------------------------------ pieces

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-[1280px] space-y-3 px-3 py-5 sm:px-6">
      <PageHeader
        eyebrow="POSITION CONTROL"
        title="My Positions"
        description="Manage active deposits, acquired NFTs and every settlement window from one on-chain workspace."
        action={
          <Link href="/deposit" className="text-xs font-semibold text-accent hover:text-accent-hover">
            + Deposit NFT
          </Link>
        }
      />
      {children}
    </div>
  );
}

function PositionRow({
  listing,
  children,
  highlight = false,
  muted = false,
}: {
  listing: Listing;
  children: React.ReactNode;
  highlight?: boolean;
  muted?: boolean;
}) {
  return (
    <div
      className={`flex flex-wrap items-center gap-2.5 rounded-md border p-2.5 ${
        highlight ? "border-blue/35 bg-blue/4" : "border-line bg-panel"
      } ${muted ? "opacity-80" : ""}`}
    >
      <div className="size-11 shrink-0 overflow-hidden rounded-sm">
        <NFTImage src={listing.nft.imageUrl} alt="" rounded={false} />
      </div>
      <div className="min-w-0 flex-1 basis-40">
        <div className="truncate text-xs font-medium text-ink">
          {sanitizeLabel(listing.nft.name, `#${listing.tokenId}`)}
        </div>
        <div className="truncate text-2xs text-mute">
          {sanitizeLabel(listing.nft.collectionName, "Unknown collection")} ·{" "}
          <span className="num font-mono">#{listing.id.toString()}</span>
        </div>
      </div>
      {children}
    </div>
  );
}

function ClaimRow({
  label,
  amount,
  cta,
  onClick,
  testid,
  busy = false,
}: {
  label: string;
  amount: bigint;
  cta?: string;
  onClick?: () => void;
  testid?: string;
  busy?: boolean;
}) {
  const empty = amount <= 0n;
  return (
    <div className={`flex items-center justify-between gap-2 rounded-sm border border-line-subtle bg-inset p-2 ${empty ? "opacity-55" : ""}`}>
      <div className="min-w-0">
        <div className="truncate text-2xs text-mute">{label}</div>
        <Hype wei={amount} className="text-sm text-ink" />
      </div>
      {cta && (
        <Button size="xs" variant={empty ? "secondary" : "primary"} disabled={empty || busy} onClick={onClick} data-testid={testid}>
          {cta}
        </Button>
      )}
    </div>
  );
}

function ActionError({ error }: { error: { title: string; detail?: string } }) {
  return (
    <div className="rounded-sm border border-red/30 bg-red/10 p-2 text-2xs" role="alert">
      <div className="font-semibold text-red">{error.title}</div>
      {error.detail && <div className="mt-0.5 text-dim">{error.detail}</div>}
    </div>
  );
}

function PanelEmpty({ title, detail, action }: { title: string; detail?: string; action?: React.ReactNode }) {
  return (
    <div className="rounded-md border border-line bg-panel">
      <EmptyState compact title={title} detail={detail} action={action} />
    </div>
  );
}
