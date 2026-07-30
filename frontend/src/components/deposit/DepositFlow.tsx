"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { env } from "@/config/env";
import { chainLabel } from "@/config/chains";
import { sanitizeLabel } from "@/lib/format";
import { formatHype, formatOddsPercent, parseHype, weightFromBacking } from "@/lib/units";
import {
  collectionFloorApiPath,
  marketValueAtRisk,
  type CollectionFloorQuote,
} from "@/lib/collectionFloors";
import { FWA_PARAMS } from "@/protocol/params";
import { useAccountState, useProtocol } from "@/protocol/provider";
import type { Address, NFTMetadata, OwnedNFT, TrackedTransaction } from "@/protocol/types";
import { useProtocolAction } from "@/state/actions";
import { useNativeBalance, useOwnedNfts, usePoolSnapshot, usePositions, useTrackedTxs } from "@/state/queries";
import { AmountInput } from "@/components/ui/AmountInput";
import { Button } from "@/components/ui/Button";
import { Hype } from "@/components/ui/Hype";
import { InfoTip } from "@/components/ui/InfoTip";
import { Panel } from "@/components/ui/Panel";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { NFTImage } from "@/components/nft/NFTImage";
import { DepositLaunchSequence } from "@/components/deposit/DepositLaunchSequence";
import { ProtocolPrelaunch } from "@/components/ui/ProtocolPrelaunch";
import { HWA_NFT_DEPOSITS_PAUSED } from "@/config/featureFlags";

type DepositIntent = {
  collection: Address;
  tokenId: bigint;
  backing: bigint;
  nft?: NFTMetadata;
};

/**
 * Guided deposit: connect → inventory → eligibility → select → backing →
 * preview → approve → list → staged/active. Approval and listing are separate,
 * visible transactions; progress is derived from live state so the flow
 * survives a page reload.
 */
export function DepositFlow() {
  const account = useAccountState();
  const { writesEnabled, prelaunch } = useProtocol();
  const { data: snapshot } = usePoolSnapshot();
  const { data: owned, isLoading: loadingNfts } = useOwnedNfts();
  const { data: balance } = useNativeBalance();
  const { data: positions, refetch: refetchPositions } = usePositions();
  const { data: txs } = useTrackedTxs();
  const action = useProtocolAction();

  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [backing, setBacking] = useState<bigint | null>(null);
  const [submittedDeposit, setSubmittedDeposit] = useState<DepositIntent | null>(null);
  const [dismissedTxId, setDismissedTxId] = useState<string | null>(null);

  const selected: OwnedNFT | undefined = useMemo(
    () => owned?.find((n) => `${n.collection}:${n.tokenId}` === selectedKey),
    [owned, selectedKey],
  );

  const floorQuery = useQuery({
    queryKey: ["collection-floor", selected?.collection],
    enabled: Boolean(selected),
    staleTime: 60_000,
    queryFn: async () => {
      if (!selected) throw new Error("No NFT selected");
      const result = await fetch(collectionFloorApiPath(selected.collection));
      const payload = (await result.json()) as CollectionFloorQuote | { error?: string };
      if ("source" in payload) return payload;
      throw new Error(payload.error ?? "Collection floor unavailable");
    },
  });
  const floorWei = floorQuery.data?.floorHype ? parseHype(floorQuery.data.floorHype) : null;
  const marketRisk = marketValueAtRisk(backing, floorWei);

  useEffect(() => {
    if (floorWei !== null) setBacking((current) => current ?? floorWei);
  }, [floorWei]);

  const recentListTx = useMemo(
    () =>
      txs?.find(
        (tx) =>
          tx.kind === "list_nft" &&
          tx.id !== dismissedTxId &&
          Date.now() / 1000 - tx.updatedAt < 10 * 60 &&
          !["rejected", "reverted", "replaced", "timeout"].includes(tx.phase),
      ),
    [dismissedTxId, txs],
  );
  const recoveredDeposit = useMemo<DepositIntent | null>(() => {
    if (!recentListTx?.meta.collection || !recentListTx.meta.tokenId || !recentListTx.meta.backing) return null;
    return {
      collection: recentListTx.meta.collection as Address,
      tokenId: BigInt(recentListTx.meta.tokenId),
      backing: BigInt(recentListTx.meta.backing),
    };
  }, [recentListTx]);
  const depositIntent = submittedDeposit ?? recoveredDeposit;

  const approveTx = findLatest(txs, "approve_nft", selected && { collection: selected.collection, tokenId: selected.tokenId.toString() });
  const listTx = findLatest(
    txs,
    "list_nft",
    depositIntent
      ? { collection: depositIntent.collection, tokenId: depositIntent.tokenId.toString() }
      : selected && { collection: selected.collection, tokenId: selected.tokenId.toString() },
  );

  const approvalPending = approveTx !== undefined && !["completed", "rejected", "reverted", "timeout"].includes(approveTx.phase);
  const listingPending = listTx !== undefined && !["completed", "rejected", "reverted", "timeout"].includes(listTx.phase);

  const listedListing = useMemo(() => {
    if (!depositIntent) return undefined;
    return [...(positions?.deposited ?? []), ...(positions?.settled ?? [])].find(
      (listing) =>
        listing.collection.toLowerCase() === depositIntent.collection.toLowerCase() &&
        listing.tokenId === depositIntent.tokenId,
    );
  }, [depositIntent, positions]);

  useEffect(() => {
    if (!depositIntent || listTx?.phase !== "completed" || listedListing) return;
    void refetchPositions();
    const timer = window.setInterval(() => void refetchPositions(), 2_000);
    return () => window.clearInterval(timer);
  }, [depositIntent, listTx?.phase, listedListing, refetchPositions]);

  // Odds preview against the live pool
  const preview = useMemo(() => {
    if (backing === null || !snapshot || backing < snapshot.minBacking) return null;
    const w = weightFromBacking(backing);
    const newTotal = snapshot.totalWeight + w;
    return { weight: w, odds: formatOddsPercent(w, newTotal) };
  }, [backing, snapshot]);

  const backingError =
    backing === null
      ? null
      : backing < (snapshot?.minBacking ?? FWA_PARAMS.minBacking)
        ? "Backing is below the live on-chain minimum."
        : balance !== undefined && backing > balance
          ? "Backing exceeds your HYPE balance."
          : null;

  // ------------------------------------------------------------ gates
  if (prelaunch) {
    return (
      <Shell>
        <ProtocolPrelaunch
          title="Deposits are locked until launch."
          detail="The allowlist, pool custody and settlement contracts are not deployed on HyperEVM mainnet yet. Deposit controls will unlock only after the public manifest passes the final canary."
          compact
        />
      </Shell>
    );
  }
  if (HWA_NFT_DEPOSITS_PAUSED) {
    return (
      <Shell>
        <EmptyState
          title="NFT deposits are paused"
          detail="No new NFT or backing can enter the pool while the launch inventory and backing parameters are being reviewed. Existing positions remain visible and withdrawable from Manage."
        />
      </Shell>
    );
  }
  if (account.status !== "connected") {
    return (
      <Shell>
        <EmptyState
          title="Connect a wallet to deposit"
          detail={`Depositing pairs one ERC-721 with committed HYPE backing on ${chainLabel(env.chainId)}.`}
          action={
            <Button variant="primary" onClick={account.connect} loading={account.status === "connecting"}>
              Connect wallet
            </Button>
          }
        />
      </Shell>
    );
  }
  if (account.isWrongNetwork) {
    return (
      <Shell>
        <EmptyState
          title="Wrong network"
          detail={`Your wallet is on ${chainLabel(account.chainId)}. Deposits run on ${chainLabel(env.chainId)} (HyperEVM — not HyperCore).`}
          action={
            <Button variant="primary" onClick={() => void account.switchToAppNetwork()}>
              Switch network
            </Button>
          }
        />
      </Shell>
    );
  }
  if (!writesEnabled) {
    return (
      <Shell>
        <EmptyState
          title="Read-only mode"
          detail="The deployment manifest deliberately disables new deposits. Existing positions and claims remain accessible."
        />
      </Shell>
    );
  }

  // ----------------------------------------------------- submission / success
  if (depositIntent && (submittedDeposit || recentListTx)) {
    return (
      <Shell>
        <DepositLaunchSequence
          intent={depositIntent}
          phase={listTx?.phase ?? "wallet"}
          listing={listedListing}
          error={action.error ?? undefined}
          onReset={() => {
            if (listTx) setDismissedTxId(listTx.id);
            setSubmittedDeposit(null);
            setSelectedKey(null);
            setBacking(null);
            action.clearError();
          }}
        />
      </Shell>
    );
  }

  // ------------------------------------------------------------- flow
  return (
    <Shell>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_330px]">
        {/* Step 1-2: inventory & selection */}
        <Panel
          title={
            <span>
              1 · Select an NFT{" "}
              <span className="normal-case text-faint">— allowlisted collections only</span>
            </span>
          }
        >
          {loadingNfts ? (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-5">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="aspect-square w-full" />
              ))}
            </div>
          ) : !owned || owned.length === 0 ? (
            <EmptyState
              compact
              title="No ERC-721s found in this wallet"
              detail="Only NFTs from allowlisted HyperEVM collections can be deposited."
            />
          ) : (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-5" data-testid="nft-picker">
              {owned.map((n) => {
                const key = `${n.collection}:${n.tokenId}`;
                const active = key === selectedKey;
                return (
                  <button
                    key={key}
                    disabled={!n.whitelisted}
                    data-testid={n.whitelisted ? "nft-eligible" : "nft-ineligible"}
                    onClick={() => {
                      setSelectedKey(key);
                      setBacking(null);
                      action.clearError();
                    }}
                    title={
                      n.whitelisted
                        ? sanitizeLabel(n.nft.name, `#${n.tokenId}`)
                        : "Collection not on the allowlist"
                    }
                    className={`group relative overflow-hidden rounded-sm border text-left transition-colors ${
                      active
                        ? "border-accent"
                        : n.whitelisted
                          ? "border-line hover:border-line-strong"
                          : "cursor-not-allowed border-line opacity-45"
                    }`}
                  >
                    <NFTImage src={n.nft.imageUrl} alt={sanitizeLabel(n.nft.name, `#${n.tokenId}`)} rounded={false} />
                    <div className="space-y-0.5 p-1.5">
                      <div className="truncate text-2xs font-medium text-ink">
                        {sanitizeLabel(n.nft.name, `#${n.tokenId}`)}
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="truncate text-3xs text-mute">
                          {sanitizeLabel(n.nft.collectionSymbol, "?")}
                        </span>
                        {!n.whitelisted && <span className="text-3xs text-red">not allowed</span>}
                        {n.whitelisted && n.approved && <span className="text-3xs text-green">approved ✓</span>}
                      </div>
                    </div>
                    {active && <span aria-hidden className="absolute inset-0 rounded-sm ring-2 ring-inset ring-accent" />}
                  </button>
                );
              })}
            </div>
          )}
        </Panel>

        {/* Step 3-6: backing, preview, approve, list */}
        <div className="space-y-3">
          <Panel title="2 · Commit HYPE backing">
            {!selected ? (
              <p className="py-2 text-2xs text-mute">Select an eligible NFT first.</p>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center gap-2.5 rounded-sm border border-line-subtle bg-inset p-2">
                  <div className="size-10 shrink-0 overflow-hidden rounded-xs">
                    <NFTImage src={selected.nft.imageUrl} alt="" rounded={false} />
                  </div>
                  <div className="min-w-0">
                    <div className="truncate text-xs font-medium text-ink">
                      {sanitizeLabel(selected.nft.name, `#${selected.tokenId}`)}
                    </div>
                    <div className="truncate text-2xs text-mute">
                      {sanitizeLabel(selected.nft.collectionName, "Unknown collection")}
                    </div>
                  </div>
                </div>

                <div>
                  <div className="mb-1 flex items-center justify-between text-2xs">
                    <label htmlFor="backing" className="uppercase tracking-wide text-mute">
                      Backing
                    </label>
                    <span className="text-faint">
                      Protocol minimum{" "}
                      <Hype wei={snapshot?.minBacking ?? FWA_PARAMS.minBacking} maxDecimals={2} unit={false} /> · bal{" "}
                      {balance !== undefined ? <Hype wei={balance} maxDecimals={2} unit={false} /> : "—"}
                    </span>
                  </div>
                  <AmountInput id="backing" label="HYPE backing" value={backing} onChange={setBacking} max={balance} />
                  <p className="mt-1 text-2xs text-faint">The protocol minimum is not the NFT floor.</p>
                  {backingError && (
                    <p className="mt-1 text-2xs text-red" data-testid="backing-error">
                      {backingError}
                    </p>
                  )}
                </div>

                <div className="rounded-sm border border-line-subtle bg-inset p-2 text-2xs">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-mute">Indicative collection floor</span>
                    <span className="font-mono text-ink">
                      {floorQuery.isLoading
                        ? "Loading…"
                        : floorWei !== null
                          ? `~${formatHype(floorWei, { maxDecimals: 3 })} HYPE`
                          : "Unavailable"}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center justify-between gap-3 text-faint">
                    <span>{floorQuery.data?.sourceLabel ?? "No verified live quote"}</span>
                    {floorQuery.data?.marketplaceUrl && (
                      <a
                        className="text-link hover:underline"
                        href={floorQuery.data.marketplaceUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        View market ↗
                      </a>
                    )}
                  </div>
                </div>

                {backing !== null && floorWei !== null && marketRisk !== null && (
                  <div
                    className={`rounded-sm border p-2 text-2xs leading-relaxed ${
                      marketRisk > 0n
                        ? "border-secondary/35 bg-secondary/10 text-secondary-readable"
                        : "border-line-subtle bg-inset text-dim"
                    }`}
                  >
                    Backing {formatHype(backing, { maxDecimals: 3 })} HYPE · Floor ~
                    {formatHype(floorWei, { maxDecimals: 3 })} HYPE ·{" "}
                    {marketRisk > 0n
                      ? `You may lose ~${formatHype(marketRisk, { maxDecimals: 3 })} HYPE of market value.`
                      : "Backing is at or above the indicative floor."}
                  </div>
                )}

                {preview && !backingError && (
                  <dl className="space-y-1 rounded-sm border border-line-subtle bg-inset p-2 text-2xs text-dim">
                    <div className="flex justify-between">
                      <dt className="flex items-center gap-1">
                        Selection odds after deposit
                        <InfoTip>
                          weight = 1e36 / backing. Selection chance is weight / total pool weight — more backing means
                          selected less often.
                        </InfoTip>
                      </dt>
                      <dd className="num font-mono text-ink">{preview.odds}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt>Funds your standing bid</dt>
                      <dd>
                        <Hype wei={backing ?? 0n} maxDecimals={3} />
                      </dd>
                    </div>
                    <div className="flex justify-between">
                      <dt>Earns share of acquisition fees</dt>
                      <dd className="text-accent">yes, while active</dd>
                    </div>
                  </dl>
                )}

                <p className="text-2xs leading-snug text-mute">
                  Backing is your capital, escrowed with the NFT: it funds your irrevocable standing bid and returns to
                  you when the position settles or you withdraw. Depositing is liquidity provision and carries risk of
                  loss.
                </p>
              </div>
            )}
          </Panel>

          <Panel title="3 · Approve & list">
            {!selected ? (
              <p className="py-2 text-2xs text-mute">Waiting for selection…</p>
            ) : (
              <div className="space-y-2">
                {/* Approval step — explicitly separate from listing */}
                <StepRow
                  index="a"
                  label={`Approve ${sanitizeLabel(selected.nft.collectionSymbol, "NFT")} #${selected.tokenId.toString()} for custody`}
                  state={selected.approved ? "done" : approvalPending ? "pending" : "todo"}
                  action={
                    !selected.approved && (
                      <Button
                        size="xs"
                        variant={approvalPending ? "secondary" : "primary"}
                        loading={approvalPending || action.submitting}
                        data-testid="approve-btn"
                        onClick={() =>
                          void action.run((c) =>
                            c.approveNFT({ collection: selected.collection, tokenId: selected.tokenId }),
                          )
                        }
                      >
                        Approve
                      </Button>
                    )
                  }
                />
                <StepRow
                  index="b"
                  label="List NFT + backing (one transaction)"
                  state={listingPending ? "pending" : "todo"}
                  action={
                    <Button
                      size="xs"
                      variant="primary"
                      disabled={!selected.approved || backing === null || !!backingError || listingPending}
                      loading={listingPending}
                      data-testid="list-btn"
                      onClick={async () => {
                        if (backing === null) return;
                        const intent: DepositIntent = {
                          collection: selected.collection,
                          tokenId: selected.tokenId,
                          backing,
                          nft: selected.nft,
                        };
                        setSubmittedDeposit(intent);
                        setDismissedTxId(null);
                        const tx = await action.run((c) =>
                          c.listNFT({ collection: selected.collection, tokenId: selected.tokenId, backing }),
                        );
                        if (!tx) setSubmittedDeposit(null);
                      }}
                    >
                      List
                    </Button>
                  }
                />

                {action.error && (
                  <div className="rounded-sm border border-red/30 bg-red/10 p-2 text-2xs" role="alert">
                    <div className="font-semibold text-red">{action.error.title}</div>
                    {action.error.detail && <div className="mt-0.5 text-dim">{action.error.detail}</div>}
                  </div>
                )}

                <p className="text-2xs leading-snug text-faint">
                  Two on-chain steps: the ERC-721 approval, then the listing transaction escrowing NFT + backing. Track
                  both in the transaction dock — if the page reloads, approval state is re-read on-chain and you resume
                  where you left off.
                </p>
              </div>
            )}
          </Panel>
        </div>
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-[1280px] space-y-3 px-3 py-5 sm:px-6">
      <PageHeader
        eyebrow="SUPPLY THE POOL"
        title="Deposit an NFT"
        description="Pair an allowlisted ERC-721 with HYPE backing, preview its weight, then approve and list through explicit transactions."
        action={
          <Link href="/" className="text-xs font-semibold text-mute hover:text-ink">
            ← Back to pool
          </Link>
        }
      />
      {children}
    </div>
  );
}

function StepRow({
  index,
  label,
  state,
  action,
}: {
  index: string;
  label: string;
  state: "todo" | "pending" | "done";
  action?: React.ReactNode;
}) {
  return (
    <div
      className={`flex items-center justify-between gap-2 rounded-sm border p-2 ${
        state === "done" ? "border-green/30 bg-green/6" : state === "pending" ? "border-amber/30 bg-amber/6" : "border-line bg-inset"
      }`}
    >
      <div className="flex min-w-0 items-center gap-2">
        <span
          className={`grid size-5 shrink-0 place-items-center rounded-full border text-3xs font-bold ${
            state === "done"
              ? "border-green bg-green text-bg"
              : state === "pending"
                ? "anim-pulse border-amber text-amber"
                : "border-line-strong text-mute"
          }`}
        >
          {state === "done" ? "✓" : index}
        </span>
        <span className={`min-w-0 truncate text-2xs ${state === "done" ? "text-green" : "text-dim"}`}>{label}</span>
      </div>
      {state !== "done" && action}
    </div>
  );
}

function findLatest(
  txs: TrackedTransaction[] | undefined,
  kind: TrackedTransaction["kind"],
  match?: { collection: string; tokenId: string } | undefined,
): TrackedTransaction | undefined {
  if (!txs || !match) return undefined;
  return txs.find(
    (t) => t.kind === kind && t.meta.collection === match.collection && t.meta.tokenId === match.tokenId,
  );
}
