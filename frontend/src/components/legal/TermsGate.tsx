"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { shortAddress } from "@/lib/format";
import { useAccountState } from "@/protocol/provider";
import { Button } from "@/components/ui/Button";

const ACCEPTED = "accepted";
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** One record per address, so switching accounts asks again. */
function storageKey(address: string): string {
  return `hwa.tos.${address.toLowerCase()}`;
}

function readAccepted(address: string): boolean {
  try {
    return window.localStorage.getItem(storageKey(address)) === ACCEPTED;
  } catch {
    // Storage blocked (private mode, hardened browser): re-ask every session
    // rather than assume consent.
    return false;
  }
}

/**
 * Terms acknowledgement gate. Mounted globally; opens only for a connected
 * address that has not acknowledged in this browser. It is a gate, not a
 * dismissible dialog: Escape and backdrop clicks do nothing, and the only exits
 * are Disconnect or Continue.
 */
export function TermsGate() {
  const account = useAccountState();
  const address = account.address;
  const connected = account.status === "connected" && !!address;

  const [open, setOpen] = useState(false);
  const [checked, setChecked] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descId = useId();
  const acceptId = useId();

  // localStorage is read here, never during render, so SSR and the first client
  // render agree and the gate can only appear after hydration.
  useEffect(() => {
    if (!connected || !address) {
      setOpen(false);
      return;
    }
    setChecked(false);
    setOpen(!readAccepted(address));
  }, [connected, address]);

  useEffect(() => {
    if (!open) return;
    restoreRef.current = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    document.body.style.overflow = "hidden";

    const onKey = (e: KeyboardEvent) => {
      const panel = panelRef.current;
      if (!panel) return;
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      if (e.key !== "Tab") return;
      const nodes = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (!first || !last) {
        e.preventDefault();
        panel.focus();
        return;
      }
      const active = document.activeElement;
      if (!panel.contains(active)) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      } else if (e.shiftKey && (active === first || active === panel)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };

    // Capture phase: Escape must be swallowed before any dialog below reacts.
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.body.style.overflow = "";
      restoreRef.current?.focus?.();
    };
  }, [open]);

  const accept = useCallback(() => {
    if (!address) return;
    try {
      window.localStorage.setItem(storageKey(address), ACCEPTED);
    } catch {
      // Acknowledgement still applies to this session; it just won't persist.
    }
    setOpen(false);
  }, [address]);

  const decline = useCallback(() => {
    setOpen(false);
    account.disconnect();
  }, [account]);

  if (!open || !address) return null;

  return (
    <div className="fixed inset-0 z-[60] grid place-items-end sm:place-items-center">
      <div aria-hidden className="absolute inset-0 bg-black/70" />
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        data-testid="tos-gate"
        className="anim-fade-up relative m-0 flex w-full max-h-[92dvh] flex-col overflow-y-auto rounded-t-lg border border-line bg-elevated outline-none sm:m-4 sm:max-w-[440px] sm:rounded-lg"
        style={{ boxShadow: "var(--shadow-drawer)" }}
      >
        <header className="shrink-0 border-b border-line-subtle px-4 py-3">
          <h2 id={titleId} className="text-sm font-semibold">
            Agree to the Terms of Service
          </h2>
          <p className="mt-0.5 text-2xs text-mute">
            for <span className="num font-mono text-dim">{shortAddress(address)}</span>
          </p>
        </header>

        <div className="space-y-3 p-4">
          <p id={descId} className="text-xs leading-relaxed text-dim">
            HWA is an interface to public smart contracts on HyperEVM. Before you continue, confirm you
            have read the terms.
          </p>

          <ul className="space-y-1.5">
            <Fact label="No transaction">
              Continuing authorizes nothing on-chain and moves no funds. Every transfer still needs a transaction you
              approve in your wallet.
            </Fact>
            <Fact label="Nothing to sign here">
              Your acknowledgement is recorded locally in this browser and sent nowhere. A free, off-chain signature
              request is planned for a later build — this build does not ask your wallet to sign anything.
            </Fact>
            <Fact label="Per address">
              The record is kept for this address only. Connecting a different account asks again; clearing browser data
              clears it.
            </Fact>
          </ul>

          <div className="flex items-start gap-2 rounded-sm border border-line-subtle bg-inset p-2.5">
            <input
              id={acceptId}
              type="checkbox"
              checked={checked}
              onChange={(e) => setChecked(e.target.checked)}
              data-testid="tos-checkbox"
              // The visible <label> only wraps the opening clause so the link
              // stays clickable; spell the full sentence out for screen readers.
              aria-label="I have read and agree to the Terms of Service, including the risk of total loss."
              className="mt-0.5 size-3.5 shrink-0 accent-(--color-accent)"
            />
            <div className="text-xs leading-relaxed text-dim">
              <label htmlFor={acceptId} className="cursor-pointer select-none">
                I have read and agree to the
              </label>{" "}
              <Link
                href="/terms"
                target="_blank"
                rel="noreferrer"
                className="text-accent underline underline-offset-2 hover:no-underline"
              >
                Terms of Service
              </Link>
              <span className="text-mute">, including the risk of total loss.</span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" data-testid="tos-disconnect" onClick={decline}>
              Disconnect
            </Button>
            <Button variant="primary" disabled={!checked} data-testid="tos-continue" onClick={accept}>
              Continue
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <li className="rounded-sm border border-line-subtle bg-inset px-2.5 py-2">
      <span className="mlabel text-accent">{label}</span>
      <p className="mt-1 text-2xs leading-relaxed text-mute">{children}</p>
    </li>
  );
}
