"use client";

import { useEffect, useRef, useState } from "react";
import { env } from "@/config/env";
import { chainLabel } from "@/config/chains";
import { shortAddress } from "@/lib/format";
import { useAccountState } from "@/protocol/provider";
import { useNativeBalance } from "@/state/queries";
import { Button } from "@/components/ui/Button";
import { Hype } from "@/components/ui/Hype";

export function WalletButton() {
  const account = useAccountState();
  const { data: balance } = useNativeBalance();
  const [open, setOpen] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [refusedOnce, setRefusedOnce] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  if (account.status === "disconnected") {
    // One wallet stays one click. Several means the browser announced several,
    // and picking for the user is how a Rabby holder ended up staring at a
    // Phantom prompt with no way out.
    if (account.wallets.length < 2) {
      return (
        <Button variant="secondary" onClick={account.connect} data-testid="connect-wallet">
          Connect wallet
        </Button>
      );
    }
    return (
      <div ref={rootRef} className="relative">
        <Button variant="secondary" onClick={() => setOpen((v) => !v)} data-testid="connect-wallet">
          Connect wallet
        </Button>
        {open && (
          <div
            className="absolute right-0 z-50 mt-1.5 w-56 overflow-hidden rounded-lg border border-line bg-panel shadow-xl"
            data-testid="wallet-picker"
          >
            {account.wallets.map((wallet) => (
              <button
                key={wallet.id}
                type="button"
                onClick={() => {
                  setOpen(false);
                  account.connectWallet(wallet.id);
                }}
                className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-sm text-ink transition-colors hover:bg-elevated"
              >
                {wallet.icon ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={wallet.icon} alt="" className="size-5 shrink-0 rounded" />
                ) : (
                  <span className="size-5 shrink-0 rounded bg-control" />
                )}
                <span className="truncate">{wallet.name}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }
  if (account.status === "connecting") {
    return (
      <Button variant="secondary" loading disabled>
        Connecting…
      </Button>
    );
  }

  const wrong = account.isWrongNetwork;

  return (
    <div ref={rootRef} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        data-testid="wallet-menu-button"
        className={`flex h-ctl items-center gap-2 rounded-sm border px-2.5 text-xs transition-colors ${
          wrong
            ? "border-red/50 bg-red/10 text-red hover:bg-red/20"
            : "border-line bg-control text-ink hover:bg-hover"
        }`}
      >
        <span aria-hidden className={`size-1.5 rounded-full ${wrong ? "bg-red" : "bg-chain"}`} />
        {wrong ? "Wrong network" : shortAddress(account.address ?? "")}
        {!wrong && balance !== undefined && (
          <span className="num hidden font-mono text-2xs text-dim sm:inline">
            <Hype wei={balance} maxDecimals={2} />
          </span>
        )}
      </button>

      {open && (
        <div
          className="anim-fade-up absolute right-0 top-10 z-50 w-64 rounded-md border border-line bg-elevated p-3"
          style={{ boxShadow: "var(--shadow-pop)" }}
        >
          <div className="mb-2 flex items-center justify-between">
            <span className="text-2xs uppercase tracking-wide text-mute">Account</span>
            <button
              className="num font-mono text-2xs text-dim hover:text-ink"
              title="Copy address"
              onClick={() => void navigator.clipboard?.writeText(account.address ?? "")}
            >
              {shortAddress(account.address ?? "", 6)} ⧉
            </button>
          </div>

          <div className="mb-2 rounded-sm border border-line-subtle bg-inset p-2">
            <div className="text-2xs text-mute">Balance</div>
            <div className="text-sm">
              {balance !== undefined ? <Hype wei={balance} /> : <span className="text-faint">—</span>}
            </div>
          </div>

          <div className="mb-3 flex items-center justify-between text-2xs">
            <span className="text-mute">Network</span>
            <span className={wrong ? "text-red" : "text-dim"}>{chainLabel(account.chainId)}</span>
          </div>

          {wrong && (
            <div className="mb-2 space-y-2">
              <p className="text-2xs leading-snug text-dim">
                This app runs on <strong className="text-ink">{chainLabel(env.chainId)}</strong> (HyperEVM, not
                HyperCore). Switch to continue.
              </p>
              {refusedOnce && (
                <p className="rounded-xs border border-amber/30 bg-amber/10 p-1.5 text-2xs text-amber">
                  The switch request was refused. Approve it in your wallet, or switch networks manually.
                </p>
              )}
              <Button
                variant="primary"
                className="w-full"
                loading={switching}
                data-testid="switch-network"
                onClick={async () => {
                  setSwitching(true);
                  const ok = await account.switchToAppNetwork();
                  setSwitching(false);
                  if (!ok) setRefusedOnce(true);
                }}
              >
                Switch to {chainLabel(env.chainId)}
              </Button>
            </div>
          )}

          <Button variant="ghost" className="w-full" onClick={account.disconnect} data-testid="disconnect">
            Disconnect
          </Button>
        </div>
      )}
    </div>
  );
}
