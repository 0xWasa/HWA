"use client";

import { useProtocol } from "@/protocol/provider";
import { useTrackedTxs } from "@/state/queries";
import type { TrackedTransaction, TxPhase } from "@/protocol/types";
import { HashLink } from "@/components/ui/HashLink";

const STEPS: { phase: TxPhase; label: string }[] = [
  { phase: "wallet", label: "Wallet" },
  { phase: "submitted", label: "Submitted" },
  { phase: "confirming", label: "Confirming" },
  { phase: "completed", label: "On-chain" },
];

const ORDER: Record<string, number> = {
  review: -1,
  wallet: 0,
  submitted: 1,
  confirming: 2,
  indexed: 3,
  completed: 3,
};

function isTerminal(phase: TxPhase): boolean {
  return ["completed", "rejected", "reverted", "replaced", "timeout"].includes(phase);
}

function isFailure(phase: TxPhase): boolean {
  return ["rejected", "reverted", "replaced", "timeout"].includes(phase);
}

/**
 * Floating transaction tracker: every write follows the visible machine
 * review → wallet → submitted → confirming → indexed → completed, with
 * rejected / reverted / timeout branches. "Submitted" is never a success.
 */
export function TxDock() {
  const { client } = useProtocol();
  const { data: txs } = useTrackedTxs();
  if (!client || !txs || txs.length === 0) return null;

  const visible = txs.filter((t) => !isTerminal(t.phase) || Date.now() / 1000 - t.updatedAt < 45).slice(0, 4);
  if (visible.length === 0) return null;

  return (
    <div
      className="fixed bottom-3 right-3 z-50 flex w-[min(340px,calc(100vw-24px))] flex-col gap-2"
      aria-live="polite"
      aria-label="Transaction status"
    >
      {visible.map((tx) => (
        <TxCard key={tx.id} tx={tx} onDismiss={() => client.dismissTransaction(tx.id)} />
      ))}
    </div>
  );
}

function TxCard({ tx, onDismiss }: { tx: TrackedTransaction; onDismiss: () => void }) {
  const failed = isFailure(tx.phase);
  const done = tx.phase === "completed";
  const activeIdx = ORDER[tx.phase] ?? -1;

  return (
    <div
      data-testid={`tx-${tx.kind}`}
      data-phase={tx.phase}
      className={`anim-fade-up rounded-xl border bg-elevated p-3 ${
        failed ? "border-red/40" : done ? "border-green/35" : "border-line"
      }`}
      style={{ boxShadow: "var(--shadow-pop)" }}
    >
      <div className="mb-1.5 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-xs font-medium text-ink">{tx.label}</div>
          {tx.hash && (
            <div className="mt-0.5">
              <HashLink value={tx.hash} kind="tx" />
            </div>
          )}
        </div>
        {isTerminal(tx.phase) && (
          <button
            onClick={onDismiss}
            aria-label="Dismiss"
            className="grid size-5 shrink-0 place-items-center rounded-xs text-mute hover:bg-control hover:text-ink"
          >
            ✕
          </button>
        )}
      </div>

      {!failed ? (
        <div className="flex items-center gap-1" role="progressbar" aria-valuetext={tx.phase}>
          {STEPS.map((s, i) => {
            const reached = activeIdx >= i;
            const current = activeIdx === i && !done;
            return (
              <div key={s.phase} className="flex flex-1 flex-col gap-1">
                <div
                  className={`h-[3px] rounded-full ${
                    reached ? "bg-green" : "bg-control"
                  } ${current ? "anim-pulse" : ""}`}
                />
                <span className={`text-[9px] leading-none ${reached ? "text-green" : "text-faint"}`}>{s.label}</span>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="rounded-sm border border-red/25 bg-red/8 p-2">
          <div className="text-2xs font-semibold text-red">{tx.error?.title ?? "Failed"}</div>
          {tx.error?.detail && <div className="mt-0.5 text-2xs leading-snug text-dim">{tx.error.detail}</div>}
          {tx.error?.raw && (
            <details className="mt-1">
              <summary className="cursor-pointer text-2xs text-mute hover:text-dim">Technical details</summary>
              <code className="num mt-1 block break-all font-mono text-[10px] text-faint">{tx.error.raw}</code>
            </details>
          )}
          {(tx.phase === "timeout" || tx.phase === "rejected") && (
            <div className="mt-1 text-2xs text-mute">Safe to retry from where you were.</div>
          )}
        </div>
      )}
    </div>
  );
}
