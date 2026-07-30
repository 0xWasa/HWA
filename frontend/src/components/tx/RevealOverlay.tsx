"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useListing, usePoolSnapshot } from "@/state/queries";
import { PurchaseResultSurface } from "@/components/acquisitions/PurchaseResultSurface";
import { PressureMotif } from "@/components/ui/PressureMotif";
import { Skeleton } from "@/components/ui/Skeleton";
import { useRevealQueue } from "./useRevealQueue";

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/** Pack-opening stages. Tests poll [data-reveal-stage]; timings stay private. */
type RevealStage = "sealed" | "flipping" | "revealed";
const SEAL_HOLD_MS = 900;
const FLIP_MS = 580;

/** Persistent FWA-like purchase result with all settlement outcomes inline. */
export function RevealOverlay() {
  const { current, currentTicket, index, total, hasNext, next, dismiss } = useRevealQueue();
  if (current === null) return null;
  return (
    <RevealDialog
      listingId={current}
      ticket={currentTicket ?? undefined}
      index={index}
      total={total}
      hasNext={hasNext}
      onNext={next}
      onDismiss={dismiss}
    />
  );
}

function RevealDialog({
  listingId,
  ticket,
  index,
  total,
  hasNext,
  onNext,
  onDismiss,
}: {
  listingId: bigint;
  ticket?: NonNullable<ReturnType<typeof useRevealQueue>["currentTicket"]>;
  index: number;
  total: number;
  hasNext: boolean;
  onNext: () => void;
  onDismiss: () => void;
}) {
  const { data: listing, isLoading } = useListing(listingId);
  const { data: snapshot } = usePoolSnapshot();
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);
  const [stage, setStage] = useState<RevealStage>("sealed");

  // Pack-opening choreography: sealed card holds, then flips into the result.
  // Restarts for every card of a batch; reduced motion jumps straight to the
  // result; the metadata-failed fallback never stays sealed.
  const listingReady = listing !== undefined;
  useEffect(() => {
    if (!listingReady) {
      if (!isLoading) setStage("revealed");
      return;
    }
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setStage("revealed");
      return;
    }
    setStage("sealed");
  }, [listingId, listingReady, isLoading]);

  // Stage-driven timers: skipping can only ever advance, never regress.
  useEffect(() => {
    if (stage === "sealed") {
      const t = window.setTimeout(() => setStage("flipping"), SEAL_HOLD_MS);
      return () => window.clearTimeout(t);
    }
    if (stage === "flipping") {
      const t = window.setTimeout(() => setStage("revealed"), FLIP_MS);
      return () => window.clearTimeout(t);
    }
  }, [stage]);

  const skipSeal = useCallback(() => {
    setStage((current) => (current === "sealed" ? "flipping" : current));
  }, []);

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    restoreRef.current = document.activeElement as HTMLElement | null;
    panel.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onDismiss();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKey, true);
      restoreRef.current?.focus?.();
    };
  }, [onDismiss]);

  useEffect(() => {
    panelRef.current?.focus();
  }, [listingId]);

  return (
    <div
      className="fixed inset-0 z-[55] overflow-y-auto bg-bg/95 p-3 backdrop-blur-md sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label="Purchase successful"
      data-testid="reveal-overlay"
      data-listing-id={listingId.toString()}
      data-reveal-stage={stage}
    >
      <div aria-hidden className="grid-paper pointer-events-none fixed inset-0 opacity-50" />
      <div aria-hidden className="aurora pointer-events-none fixed inset-0 opacity-45" />
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Close purchase result"
        className="fixed right-4 top-4 z-[58] grid size-10 place-items-center rounded-full border border-line bg-bg/85 text-xl text-mute shadow-xl backdrop-blur hover:border-line-strong hover:text-ink sm:right-7 sm:top-7"
      >
        ×
      </button>

      <div
        ref={panelRef}
        tabIndex={-1}
        className="relative z-[56] mx-auto my-auto w-full max-w-6xl rounded-2xl border border-line bg-bg/76 p-5 outline-none shadow-[0_35px_120px_rgba(0,0,0,.7)] backdrop-blur-xl sm:p-8 lg:p-10"
      >
        {isLoading && !listing ? (
          <div className="grid min-h-[34rem] gap-8 lg:grid-cols-[0.8fr_1.2fr]">
            <Skeleton className="mx-auto aspect-[0.78] w-full max-w-sm rounded-2xl" />
            <div className="space-y-4 pt-8">
              <Skeleton className="h-12 w-3/4" />
              <Skeleton className="h-8 w-1/2" />
              <Skeleton className="mt-10 h-64 w-full rounded-xl" />
            </div>
          </div>
        ) : listing ? (
          <div className={`reveal-flip-scene relative ${stage !== "revealed" ? "min-h-[34rem]" : ""}`}>
            <div className="reveal-result-face" inert={stage === "sealed" ? true : undefined}>
              <PurchaseResultSurface
                listing={listing}
                ticket={ticket}
                snapshot={snapshot}
                onClose={onDismiss}
                onNext={hasNext ? onNext : undefined}
                batchLabel={total > 1 ? `DRAW ${index} OF ${total}` : "VERIFIABLE DRAW COMPLETE"}
                animated
              />
            </div>
            {stage !== "revealed" && (
              <div
                className="pointer-events-none absolute inset-0 z-10 grid place-items-center"
                aria-hidden={stage === "flipping" ? true : undefined}
              >
                <button
                  type="button"
                  onClick={skipSeal}
                  aria-label="Reveal result"
                  data-testid="reveal-seal"
                  className="reveal-seal-card randomness-card-back pointer-events-auto relative block aspect-[0.78] w-full max-w-[19rem] cursor-pointer rounded-2xl border border-secondary/45 outline-none focus-visible:border-accent"
                >
                  <PressureMotif
                    tone="violet"
                    wall={false}
                    className="pointer-events-none absolute inset-0 size-full opacity-60"
                  />
                  <span className="absolute inset-x-0 top-5 text-center font-display text-lg font-extrabold tracking-[0.3em] text-secondary-readable">
                    HWA
                  </span>
                  <span className="absolute inset-0 grid place-items-center font-display text-7xl font-extrabold text-ink/85">
                    ?
                  </span>
                  <span className="stamp stamp--violet absolute bottom-14 left-1/2 -translate-x-1/2">
                    Sealed
                  </span>
                  <span className="mlabel absolute inset-x-0 bottom-5 text-center text-faint">
                    TAP TO REVEAL
                  </span>
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="grid min-h-[28rem] place-items-center text-center">
            <div>
              <div className="mlabel text-amber">RESULT RECORDED</div>
              <h2 className="mt-2 text-2xl font-semibold text-ink">Position #{listingId.toString()} is yours</h2>
              <p className="mt-2 text-sm text-mute">Its NFT metadata could not be loaded. The on-chain allocation is unaffected.</p>
              <button type="button" className="mt-5 text-sm font-semibold text-accent" onClick={onDismiss}>Close</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
