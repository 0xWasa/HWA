"use client";

import { useEffect, useState } from "react";
import { usePublicClient, useWriteContract } from "wagmi";
import { Button } from "@/components/ui/Button";
import { Panel } from "@/components/ui/Panel";
import { Tag } from "@/components/ui/Tag";
import { formatHwa } from "@/lib/units";
import { useAccountState, useProtocol } from "@/protocol/provider";
import type { Address, Hex } from "@/protocol/types";

const migrationAbi = [
  { type: "function", name: "claimed", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "claim", stateMutability: "nonpayable", inputs: [{ name: "amount", type: "uint256" }, { name: "proof", type: "bytes32[]" }], outputs: [] },
] as const;

type MigrationRow = { account: Address; amountWei: string; proof: Hex[] };
type MigrationSnapshot = { snapshotBlock: number; claims: MigrationRow[] };

export function MigrationClaimPanel() {
  const account = useAccountState();
  const { manifestState } = useProtocol();
  const distributor = manifestState.status === "ready" ? manifestState.manifest.contracts.migrationDistributor : undefined;
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const [row, setRow] = useState<MigrationRow | null | undefined>();
  const [snapshotBlock, setSnapshotBlock] = useState<number>();
  const [claimed, setClaimed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    setRow(undefined);
    setClaimed(false);
    setError(undefined);
    if (!distributor || account.status !== "connected" || !account.address || !publicClient) return;
    void (async () => {
      try {
        const response = await fetch("/migration/hwa-v2-claims.json", { cache: "force-cache" });
        if (!response.ok) throw new Error(`snapshot HTTP ${response.status}`);
        const snapshot = (await response.json()) as MigrationSnapshot;
        const match = snapshot.claims.find((claim) => claim.account.toLowerCase() === account.address!.toLowerCase()) ?? null;
        const alreadyClaimed = await publicClient.readContract({
          address: distributor,
          abi: migrationAbi,
          functionName: "claimed",
          args: [account.address!],
        });
        if (!cancelled) {
          setSnapshotBlock(snapshot.snapshotBlock);
          setRow(match);
          setClaimed(alreadyClaimed);
        }
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Migration lookup failed");
      }
    })();
    return () => { cancelled = true; };
  }, [account.address, account.status, distributor, publicClient]);

  if (!distributor) return null;
  const amount = row ? BigInt(row.amountWei) : 0n;

  async function claimMigration() {
    if (!row || !account.address || !publicClient) return;
    setLoading(true);
    setError(undefined);
    try {
      if (account.isWrongNetwork && !(await account.switchToAppNetwork())) return;
      const hash = await writeContractAsync({
        account: account.address,
        address: distributor!,
        abi: migrationAbi,
        functionName: "claim",
        args: [BigInt(row.amountWei), row.proof],
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("Migration transaction reverted");
      setClaimed(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Migration claim failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Panel title="HWA v1 â†’ v2 migration" actions={<Tag tone={claimed ? "accent" : "neutral"}>1:1 Â· no expiry</Tag>}>
      <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
        <div>
          <div className="text-2xs uppercase tracking-wide text-mute">Your snapshot allocation</div>
          <div className="num mt-1 font-mono text-xl text-ink">
            {account.status === "connected" && row !== undefined ? `${formatHwa(amount)} HWA` : "â€”"}
          </div>
          <p className="mt-1 text-2xs leading-relaxed text-mute">
            Old liquid HWA plus accrued v1 rewards were captured at block {snapshotBlock ?? "41,850,854"}. The Merkle root and allocation are immutable; claims stay open permanently.
          </p>
        </div>
        {account.status !== "connected" ? (
          <Button variant="primary" onClick={account.connect}>Connect wallet</Button>
        ) : claimed ? (
          <Button disabled>Migration claimed</Button>
        ) : row === undefined ? (
          <Button loading disabled>Checking snapshot</Button>
        ) : row === null ? (
          <Button disabled>No allocation for this wallet</Button>
        ) : (
          <Button variant="primary" loading={loading} onClick={() => void claimMigration()}>Claim v2 HWA</Button>
        )}
      </div>
      {error && <div className="mt-2 rounded-sm border border-red/30 bg-red/10 p-2 text-2xs text-red" role="alert">{error}</div>}
    </Panel>
  );
}