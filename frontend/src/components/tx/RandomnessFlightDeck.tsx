"use client";

import { useEffect, useMemo, useState } from "react";
import { env } from "@/config/env";
import { randomnessSecurityBufferSec } from "@/protocol/params";
import type { AcquisitionTicket, PoolSnapshot } from "@/protocol/types";
import { PressureMotif } from "@/components/ui/PressureMotif";

const PHASES: { phases: AcquisitionTicket["phase"][]; label: string }[] = [
  { phases: ["requested", "randomness_pending"], label: "Round locked" },
  { phases: ["randomness_cached"], label: "Word received" },
  { phases: ["processing"], label: "Selecting" },
  { phases: ["allocated"], label: "Revealed" },
];

/**
 * Counts the real protocol security buffer down from the request timestamp.
 * This is not a prediction of the reveal: the buffer is a contract constant,
 * so once it reaches zero the copy stops promising anything and simply says
 * the round is eligible.
 */
function SecurityBufferTimer({ requestedAt, seconds }: { requestedAt: number; seconds: number }) {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const timer = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1_000);
    return () => clearInterval(timer);
  }, []);
  const remaining = Math.max(0, requestedAt + seconds - now);
  const pct = seconds > 0 ? ((seconds - remaining) / seconds) * 100 : 100;
  return (
    <div className="mt-3 flex items-center justify-center gap-2.5" data-testid="randomness-buffer-timer">
      <span aria-hidden className="relative grid size-7 shrink-0 place-items-center">
        <svg viewBox="0 0 36 36" className="absolute inset-0 -rotate-90">
          <circle cx="18" cy="18" r="15" fill="none" stroke="var(--hwa-border)" strokeWidth="3" />
          <circle
            cx="18" cy="18" r="15" fill="none"
            stroke={remaining > 0 ? "var(--hwa-chain)" : "var(--hwa-accent)"}
            strokeWidth="3" strokeLinecap="round"
            strokeDasharray={`${(pct / 100) * 94.2} 94.2`}
            style={{ transition: "stroke-dasharray 1s linear" }}
          />
        </svg>
        <span className="num font-mono text-3xs font-semibold text-dim">{remaining}</span>
      </span>
      <span className="font-mono text-3xs uppercase tracking-[0.1em] text-chain">
        {remaining > 0 ? "Security buffer" : "Round eligible"}
      </span>
    </div>
  );
}

/**
 * FWA-like concealed deck shown while drand is in flight. It only presents
 * facts already known on-chain: request sequence, current block and deadline.
 * No fake countdown or predetermined NFT is displayed before allocation.
 */
export function RandomnessFlightDeck({
  tickets,
  snapshot,
}: {
  tickets: AcquisitionTicket[];
  snapshot?: PoolSnapshot;
}) {
  const ordered = useMemo(
    () => [...tickets].sort((a, b) => (a.sequence < b.sequence ? -1 : a.sequence > b.sequence ? 1 : 0)),
    [tickets],
  );
  const ticket = ordered[0];
  if (!ticket) return null;

  const currentBlock = snapshot?.blockNumber;
  const requestBlock = ticket.requestBlock;
  const deadline = ticket.wordDeadlineBlock;
  const elapsed = currentBlock !== undefined && requestBlock !== undefined && currentBlock >= requestBlock
    ? currentBlock - requestBlock
    : null;
  const span = deadline !== undefined && requestBlock !== undefined && deadline > requestBlock
    ? deadline - requestBlock
    : null;
  const progress = elapsed !== null && span !== null && span > 0n
    ? Math.max(4, Math.min(96, Number((elapsed * 100n) / span)))
    : ticket.phase === "randomness_cached"
      ? 72
      : ticket.phase === "processing"
        ? 88
        : 20;
  const phaseIndex = Math.max(0, PHASES.findIndex((step) => step.phases.includes(ticket.phase)));
  const cards = Math.max(7, Math.min(11, ordered.length + 6));
  const securityBuffer = randomnessSecurityBufferSec(env.chainId);

  return (
    <div
      className="flex w-full max-w-5xl flex-col items-center px-3"
      data-testid="randomness-flight-deck"
      data-deck-phase={phaseIndex}
    >
      <div className="mb-4 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 font-mono text-3xs uppercase tracking-[0.12em] text-faint sm:text-2xs">
        <span className="flex items-center gap-1.5 text-secondary-readable">
          <span className="anim-pulse size-1.5 rounded-full bg-secondary" aria-hidden />
          {elapsed !== null ? `${elapsed.toString()} blocks elapsed` : "Drand request live"}
        </span>
        <span aria-hidden className="text-line-strong">|</span>
        <span>Sequence #{ticket.sequence.toString()}</span>
        <span aria-hidden className="text-line-strong">|</span>
        <span>{deadline !== undefined ? `Word deadline #${deadline.toString()}` : "Awaiting coordinator"}</span>
      </div>

      <div className="relative h-[17rem] w-full sm:h-[22rem] lg:h-[min(25rem,48dvh)]" aria-label={`${ordered.length} acquisition request${ordered.length > 1 ? "s" : ""} awaiting verifiable randomness`}>
        <div aria-hidden className="absolute inset-x-[12%] bottom-[5%] h-1/2 rounded-[50%] bg-secondary/16 blur-3xl" />
        {Array.from({ length: cards }).map((_, index) => {
          const center = (cards - 1) / 2;
          const slot = index - center;
          const distance = Math.abs(slot);
          const isCenter = Math.abs(slot) < 0.1;
          return (
            <div
              key={index}
              aria-hidden
              className={`randomness-card-back absolute left-1/2 top-1/2 aspect-[0.72] w-[clamp(9.2rem,24vw,16rem)] rounded-xl border ${
                isCenter ? "border-accent/55" : "border-secondary/25"
              } ${isCenter && phaseIndex >= 2 ? "deck-charging" : ""}`}
              style={{
                zIndex: 50 - Math.round(distance),
                transform: `translate(-50%, -50%) translateX(calc(${slot} * clamp(3.8rem, 9vw, 7rem))) translateY(${Math.min(38, distance * 7)}px) rotate(${slot * 3.8}deg) scale(${isCenter ? 1 : Math.max(0.72, 0.91 - distance * 0.055)})`,
                opacity: isCenter ? 1 : Math.max(0.34, 0.76 - distance * 0.08),
              }}
            >
              <div className="absolute inset-2 rounded-lg border border-dashed border-line-strong/70" />
              <PressureMotif
                tone="violet"
                wall={false}
                className="pointer-events-none absolute inset-0 size-full opacity-55"
              />
              <div className="absolute inset-0 grid place-items-center">
                <span className="font-display text-6xl font-extrabold text-ink sm:text-7xl">?</span>
              </div>
              <span className="absolute left-4 top-4 font-mono text-3xs uppercase tracking-[0.18em] text-chain">HWA / SEALED</span>
              <span className="absolute bottom-4 right-4 font-mono text-3xs text-mute">SEQ {ticket.sequence.toString().padStart(3, "0")}</span>
            </div>
          );
        })}
      </div>

      <div className="mt-1 w-full max-w-xl">
        <div className="flex items-center justify-between gap-3">
          {PHASES.map((step, index) => {
            const active = index <= phaseIndex;
            return (
              <div key={step.label} className="flex min-w-0 flex-1 flex-col gap-1.5">
                <span className={`h-1 rounded-full ${active ? "bg-accent" : "bg-control"} ${index === phaseIndex ? "anim-pulse" : ""}`} />
                <span className={`truncate text-center text-3xs uppercase tracking-wide ${active ? "text-accent" : "text-faint"}`}>{step.label}</span>
              </div>
            );
          })}
        </div>
        <div className="mt-3 h-1 overflow-hidden rounded-full bg-control" aria-hidden>
          <span className="block h-full rounded-full bg-gradient-to-r from-secondary via-chain to-accent transition-[width] duration-700" style={{ width: `${progress}%` }} />
        </div>
        <p className="mt-3 text-center text-2xs leading-relaxed text-mute">
          The NFT remains unknown until the authenticated drand word is received and the FIFO sequence is processed.
          {ordered.length > 1 && <span className="text-dim"> {ordered.length} requests are queued in this batch.</span>}
        </p>
        <SecurityBufferTimer requestedAt={ticket.requestedAt} seconds={securityBuffer} />
      </div>
    </div>
  );
}
