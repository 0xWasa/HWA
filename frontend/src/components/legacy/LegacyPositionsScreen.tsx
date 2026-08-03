"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePublicClient, useWriteContract } from "wagmi";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { MigrationClaimPanel } from "@/components/rewards/MigrationClaimPanel";
import { Panel, Stat } from "@/components/ui/Panel";
import { Skeleton } from "@/components/ui/Skeleton";
import { Tag } from "@/components/ui/Tag";
import { shortAddress } from "@/lib/format";
import { formatHype } from "@/lib/units";
import { useAccountState, useProtocol } from "@/protocol/provider";
import type { Address } from "@/protocol/types";
import { fwaCoreAbi } from "@/protocol/viem/abi";

type SnapshotPosition = {
  listingId: number;
  collection: Address;
  depositor: Address;
  purchaser: Address;
  tokenId: string;
  backingWei: string;
  status: number;
};

type LegacySnapshot = {
  core: Address;
  state: { activeListingCount: string; activeBackingTotal: string };
  positions: SnapshotPosition[];
};

type LivePosition = SnapshotPosition & { currentStatus: number; currentBacking: bigint };
type LegacyAction = "withdrawListing" | "keepNFT" | "acceptDepositorBid";

export function LegacyPositionsScreen() {
  const account = useAccountState();
  const { manifestState } = useProtocol();
  const publicClient = usePublicClient({ chainId: 999 });
  const { writeContractAsync } = useWriteContract();
  const legacyFwa = manifestState.status === "ready" ? manifestState.manifest.contracts.legacyFwa : undefined;
  const [snapshot, setSnapshot] = useState<LegacySnapshot>();
  const [positions, setPositions] = useState<LivePosition[]>();
  const [loadingId, setLoadingId] = useState<number>();
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [feeCredit, setFeeCredit] = useState(0n);
  const [refundCredit, setRefundCredit] = useState(0n);

  useEffect(() => {
    let cancelled = false;
    void fetch("/legacy/hwa-v1-positions.json", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Legacy inventory HTTP ${response.status}`);
        const value = await response.json() as LegacySnapshot;
        if (!cancelled) setSnapshot(value);
      })
      .catch((cause) => { if (!cancelled) setError(messageFrom(cause, "Legacy inventory unavailable")); });
    return () => { cancelled = true; };
  }, []);

  const refresh = useCallback(async () => {
    if (!snapshot || !legacyFwa || !account.address || !publicClient) {
      setPositions(undefined);
      return;
    }
    if (snapshot.core.toLowerCase() !== legacyFwa.toLowerCase()) {
      setError("Legacy inventory does not match the configured v1 contract.");
      return;
    }
    const wallet = account.address.toLowerCase();
    const owned = snapshot.positions.filter((position) =>
      (position.status === 1 && position.depositor.toLowerCase() === wallet)
      || (position.status === 2 && position.purchaser.toLowerCase() === wallet),
    );
    try {
      const [nextFeeCredit, nextRefundCredit] = await Promise.all([
        publicClient.readContract({ address: legacyFwa, abi: fwaCoreAbi, functionName: "feeCredit", args: [account.address] }),
        publicClient.readContract({ address: legacyFwa, abi: fwaCoreAbi, functionName: "acquisitionRefundCredit", args: [account.address] }),
      ]);
      setFeeCredit(nextFeeCredit);
      setRefundCredit(nextRefundCredit);
      if (owned.length === 0) {
        setPositions([]);
        setError(undefined);
        return;
      }
      const live = await Promise.all(owned.map(async (position) => {
        const result = await publicClient.readContract({
          address: legacyFwa,
          abi: fwaCoreAbi,
          functionName: "listings",
          args: [BigInt(position.listingId)],
        });
        return { ...position, currentBacking: result[5], currentStatus: Number(result[10]) };
      }));
      setPositions(live.filter((position) => position.currentStatus === 1 || position.currentStatus === 2));
      setError(undefined);
    } catch (cause) {
      setError(messageFrom(cause, "Could not refresh v1 positions"));
    }
  }, [account.address, legacyFwa, publicClient, snapshot]);
  useEffect(() => { void refresh(); }, [refresh]);

  const wallet = account.address?.toLowerCase();
  const active = useMemo(
    () => positions?.filter((position) => position.currentStatus === 1 && position.depositor.toLowerCase() === wallet) ?? [],
    [positions, wallet],
  );
  const allocated = useMemo(
    () => positions?.filter((position) => position.currentStatus === 2 && position.purchaser.toLowerCase() === wallet) ?? [],
    [positions, wallet],
  );
  const recoverableBacking = active.reduce((sum, position) => sum + position.currentBacking, 0n);

  async function execute(position: LivePosition, functionName: LegacyAction) {
    if (!account.address || !legacyFwa || !publicClient) return;
    setLoadingId(position.listingId);
    setError(undefined);
    setNotice(undefined);
    try {
      if (account.isWrongNetwork && !(await account.switchToAppNetwork())) return;
      const hash = await writeContractAsync({
        account: account.address,
        address: legacyFwa,
        abi: fwaCoreAbi,
        functionName,
        args: [BigInt(position.listingId)],
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("Legacy recovery transaction reverted");
      setNotice(functionName === "withdrawListing"
        ? `NFT #${position.tokenId} and ${formatHype(position.currentBacking)} HYPE recovered.`
        : `Legacy acquisition #${position.listingId} resolved.`);
      await refresh();
    } catch (cause) {
      setError(messageFrom(cause, "Legacy recovery failed"));
    } finally {
      setLoadingId(undefined);
    }
  }

  async function claimCredit(functionName: "withdrawEarnings" | "withdrawAcquisitionRefund", amount: bigint) {
    if (!account.address || !legacyFwa || !publicClient || amount <= 0n) return;
    setLoadingId(0);
    setError(undefined);
    setNotice(undefined);
    try {
      if (account.isWrongNetwork && !(await account.switchToAppNetwork())) return;
      const hash = await writeContractAsync({ account: account.address, address: legacyFwa, abi: fwaCoreAbi, functionName });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("Legacy credit withdrawal reverted");
      setNotice(`${formatHype(amount)} HYPE recovered from v1 credits.`);
      await refresh();
    } catch (cause) {
      setError(messageFrom(cause, "Legacy credit withdrawal failed"));
    } finally {
      setLoadingId(undefined);
    }
  }

  return (
    <main className="mx-auto w-full max-w-[1180px] space-y-4 px-3 py-5 sm:px-6">
      <PageHeader
        eyebrow="HWA V1"
        title="Legacy recovery"
        description="The v1 market is frozen. Recover each deposited NFT together with its escrowed HYPE backing directly from the original contract."
        meta={legacyFwa ? `v1 core ${shortAddress(legacyFwa, 6)} · HyperEVM mainnet` : "v1 recovery is available on mainnet"}
      />

      {/* v1 holders land here, not on /rewards: the token migration claim
          belongs next to the NFT and backing recovery. */}
      <MigrationClaimPanel />

      <div className="grid gap-px overflow-hidden rounded-md border border-line bg-line-subtle sm:grid-cols-4">
        <div className="bg-panel p-3"><Stat label="V1 pool" value="WITHDRAW ONLY" sub="deposits and acquisitions disabled" tone="amber" /></div>
        <div className="bg-panel p-3"><Stat label="Active at inventory" value={snapshot?.state.activeListingCount ?? "—"} sub="rechecked before every transaction" /></div>
        <div className="bg-panel p-3"><Stat label="Your recoverable backing" value={account.status === "connected" ? `${formatHype(recoverableBacking)} HYPE` : "—"} sub={`${active.length} active position${active.length === 1 ? "" : "s"}`} tone="accent" /></div>
        <div className="bg-panel p-3"><Stat label="Your v1 credits" value={account.status === "connected" ? `${formatHype(feeCredit + refundCredit)} HYPE` : "—"} sub="fees and acquisition refunds" /></div>
      </div>

      <div className="rounded-md border border-amber/30 bg-amber/10 px-4 py-3 text-xs leading-relaxed text-dim">
        v1 NFT custody was not moved to v2. Only the depositor wallet can withdraw an active listing, so every NFT requires one wallet confirmation. The contract returns the NFT and its full escrowed backing in the same transaction.
      </div>

      {account.status === "connected" && (feeCredit > 0n || refundCredit > 0n) && (
        <Panel title="Legacy HYPE credits" actions={<Tag tone="accent">withdrawable</Tag>}>
          <div className="grid gap-3 sm:grid-cols-2">
            <CreditRow label="Listing fees" amount={feeCredit} loading={loadingId === 0} disabled={loadingId !== undefined} onClaim={() => void claimCredit("withdrawEarnings", feeCredit)} />
            <CreditRow label="Acquisition refunds" amount={refundCredit} loading={loadingId === 0} disabled={loadingId !== undefined} onClaim={() => void claimCredit("withdrawAcquisitionRefund", refundCredit)} />
          </div>
        </Panel>
      )}

      {account.status !== "connected" ? (
        <Panel><EmptyState compact title="Connect the wallet used on HWA v1" detail="The page will only display positions where this wallet is the depositor or purchaser." action={<Button variant="primary" onClick={account.connect}>Connect wallet</Button>} /></Panel>
      ) : !snapshot || positions === undefined ? (
        <div className="grid gap-3 md:grid-cols-2"><Skeleton className="h-40 w-full" /><Skeleton className="h-40 w-full" /></div>
      ) : active.length === 0 && allocated.length === 0 ? (
        <Panel><EmptyState compact title="No unresolved v1 position for this wallet" detail="Already withdrawn or settled positions disappear after the on-chain refresh." /></Panel>
      ) : (
        <>
          {active.length > 0 && (
            <Panel title="Deposited positions" actions={<Tag tone="accent">NFT + backing</Tag>}>
              <div className="grid gap-3 md:grid-cols-2">
                {active.map((position) => (
                  <PositionCard key={position.listingId} position={position}>
                    <Button className="w-full" variant="primary" loading={loadingId === position.listingId} disabled={loadingId !== undefined} onClick={() => void execute(position, "withdrawListing")}>Withdraw NFT + backing</Button>
                  </PositionCard>
                ))}
              </div>
            </Panel>
          )}

          {allocated.length > 0 && (
            <Panel title="Allocated acquisitions" actions={<Tag tone="amber">choice required</Tag>}>
              <p className="mb-3 text-2xs leading-relaxed text-mute">These NFTs were already drawn on v1. Choose either the NFT (the backing returns to its depositor) or the depositor&apos;s HYPE bid (the NFT returns to the depositor), exactly as defined by the v1 contract.</p>
              <div className="grid gap-3 md:grid-cols-2">
                {allocated.map((position) => (
                  <PositionCard key={position.listingId} position={position}>
                    <div className="grid grid-cols-2 gap-2">
                      <Button variant="primary" loading={loadingId === position.listingId} disabled={loadingId !== undefined} onClick={() => void execute(position, "keepNFT")}>Keep NFT</Button>
                      <Button variant="secondary" loading={loadingId === position.listingId} disabled={loadingId !== undefined} onClick={() => void execute(position, "acceptDepositorBid")}>Take HYPE bid</Button>
                    </div>
                  </PositionCard>
                ))}
              </div>
            </Panel>
          )}
        </>
      )}

      {notice && <div className="rounded-sm border border-accent/30 bg-accent/10 p-3 text-xs text-accent" role="status">{notice}</div>}
      {error && <div className="rounded-sm border border-red/30 bg-red/10 p-3 text-xs text-red" role="alert">{error}</div>}
    </main>
  );
}

function PositionCard({ position, children }: { position: LivePosition; children: React.ReactNode }) {
  return (
    <article className="rounded-md border border-line-subtle bg-inset p-3">
      <div className="flex items-start justify-between gap-3">
        <div><div className="text-2xs uppercase tracking-wide text-mute">Listing #{position.listingId}</div><div className="mt-1 font-semibold text-ink">NFT #{position.tokenId}</div><div className="mt-0.5 font-mono text-2xs text-faint">{shortAddress(position.collection, 6)}</div></div>
        <Tag tone={position.currentStatus === 1 ? "accent" : "amber"}>{position.currentStatus === 1 ? "ACTIVE" : "ALLOCATED"}</Tag>
      </div>
      <div className="my-3 rounded-sm border border-line-subtle bg-panel p-2.5"><div className="text-2xs uppercase tracking-wide text-mute">Escrowed backing</div><div className="num mt-0.5 font-mono text-lg text-ink">{formatHype(position.currentBacking)} <span className="text-xs text-mute">HYPE</span></div></div>
      {children}
    </article>
  );
}

function CreditRow({ label, amount, loading, disabled, onClaim }: { label: string; amount: bigint; loading: boolean; disabled: boolean; onClaim: () => void }) {
  return (
    <div className="rounded-sm border border-line-subtle bg-inset p-3">
      <div className="text-2xs uppercase tracking-wide text-mute">{label}</div>
      <div className="num my-2 font-mono text-lg text-ink">{formatHype(amount)} <span className="text-xs text-mute">HYPE</span></div>
      <Button className="w-full" variant="secondary" loading={loading} disabled={disabled || amount <= 0n} onClick={onClaim}>Withdraw credit</Button>
    </div>
  );
}

function messageFrom(cause: unknown, fallback: string): string {
  if (!(cause instanceof Error)) return fallback;
  const message = cause.message.split("\n")[0]?.trim();
  return message || fallback;
}
