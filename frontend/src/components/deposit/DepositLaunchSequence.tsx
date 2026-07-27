"use client";

import { useRouter } from "next/navigation";
import type { CSSProperties } from "react";
import type { Listing, NFTMetadata, TxPhase } from "@/protocol/types";
import { sanitizeLabel } from "@/lib/format";
import { NFTImage } from "@/components/nft/NFTImage";
import { Hype } from "@/components/ui/Hype";
import { Button } from "@/components/ui/Button";

type DepositIntent = {
  tokenId: bigint;
  backing: bigint;
  nft?: NFTMetadata;
};

const FAILURE_PHASES: TxPhase[] = ["rejected", "reverted", "replaced", "timeout"];

function phaseCopy(phase: TxPhase, listing?: Listing) {
  if (FAILURE_PHASES.includes(phase)) {
    return {
      eyebrow: "DEPOSIT INTERRUPTED",
      title: "The NFT stayed safe.",
      detail: "The listing did not complete. Nothing is considered deposited until the transaction is confirmed on-chain.",
      tone: "failed" as const,
    };
  }
  if (listing?.status === "active") {
    return {
      eyebrow: "POOL ENTRY COMPLETE",
      title: `Position #${listing.id.toString()} is live.`,
      detail: "The NFT and its HYPE backing are now one active pool position. It is selectable and earns its share of acquisition fees.",
      tone: "active" as const,
    };
  }
  if (listing?.status === "staged") {
    return {
      eyebrow: "ON-CHAIN · QUEUED",
      title: `Position #${listing.id.toString()} is staged.`,
      detail: "Custody and backing are confirmed. The position activates automatically as soon as the acquisition sequencer is idle.",
      tone: "syncing" as const,
    };
  }
  if (phase === "completed" || phase === "indexed") {
    return {
      eyebrow: "ON-CHAIN CONFIRMED",
      title: "Reading the new position…",
      detail: "The NFT has reached HWA protocol custody. The interface is now resolving its listing number and final pool state.",
      tone: "syncing" as const,
    };
  }
  if (phase === "confirming") {
    return {
      eyebrow: "TRANSACTION FOUND",
      title: "NFT entering the pool.",
      detail: "HyperEVM is confirming the atomic listing: NFT custody and HYPE backing either settle together or not at all.",
      tone: "moving" as const,
    };
  }
  if (phase === "submitted") {
    return {
      eyebrow: "SUBMITTED TO HYPEREVM",
      title: "The pool is receiving your card.",
      detail: "Your transaction is in flight. Keep this page open while the network includes it in a block.",
      tone: "moving" as const,
    };
  }
  return {
    eyebrow: "READY TO LIST",
    title: "Confirm in your wallet.",
    detail: "This signature escrows the selected NFT together with its HYPE backing. Approval alone never moves the NFT.",
    tone: "wallet" as const,
  };
}

export function DepositLaunchSequence({
  intent,
  phase,
  listing,
  error,
  onReset,
}: {
  intent: DepositIntent;
  phase: TxPhase;
  listing?: Listing;
  error?: { title: string; detail?: string };
  onReset: () => void;
}) {
  const router = useRouter();
  const copy = phaseCopy(phase, listing);
  const failed = copy.tone === "failed";
  const active = copy.tone === "active";
  const escrowReached = ["confirming", "indexed", "completed"].includes(phase) || !!listing;
  const positionReached = !!listing;
  const nft = listing?.nft ?? intent.nft;
  const backing = listing?.backing ?? intent.backing;

  return (
    <section
      className={`deposit-launch overflow-hidden rounded-2xl border bg-elevated ${active ? "is-active" : ""} ${failed ? "is-failed" : ""}`}
      data-testid="deposit-launch-sequence"
      data-phase={listing?.status ?? phase}
      aria-live="polite"
    >
      <div className="deposit-launch-grid lg:grid lg:grid-cols-[minmax(360px,0.9fr)_minmax(420px,1.1fr)]">
        <div className="deposit-launch-visual relative min-h-[390px] overflow-hidden border-b border-line lg:border-b-0 lg:border-r">
          <div className="deposit-launch-aurora" aria-hidden />
          <div className="deposit-orbit deposit-orbit-one" aria-hidden />
          <div className="deposit-orbit deposit-orbit-two" aria-hidden />
          <div className="deposit-pool-core" aria-hidden>
            <span>HWA</span>
            <strong>{active ? "LIVE" : failed ? "SAFE" : "POOL"}</strong>
          </div>
          {Array.from({ length: 10 }).map((_, index) => (
            <i
              key={index}
              className="deposit-spark"
              style={{ "--spark-angle": `${index * 36}deg`, "--spark-delay": `${index * -0.17}s` } as CSSProperties}
              aria-hidden
            />
          ))}

          <div className={`deposit-flight-card tone-${copy.tone}`}>
            <div className="deposit-flight-card-head">
              <span>HWA · POOL INGRESS</span>
              <strong>#{intent.tokenId.toString()}</strong>
            </div>
            <div className="deposit-flight-art">
              <NFTImage src={nft?.imageUrl} alt={sanitizeLabel(nft?.name, `NFT #${intent.tokenId.toString()}`)} rounded={false} />
              <div className="deposit-flight-scan" aria-hidden />
            </div>
            <div className="deposit-flight-card-foot">
              <span>{sanitizeLabel(nft?.name, `NFT #${intent.tokenId.toString()}`)}</span>
              <Hype wei={backing} maxDecimals={4} />
            </div>
          </div>

          <div className="deposit-signal" aria-hidden>
            <span />
            <span />
            <span />
          </div>
        </div>

        <div className="flex flex-col justify-center p-6 sm:p-9">
          <div className={`mlabel ${failed ? "text-red" : active ? "text-accent" : "text-violet"}`}>{copy.eyebrow}</div>
          <h2 className="mt-2 text-3xl font-bold tracking-tight text-ink sm:text-4xl">{copy.title}</h2>
          <p className="mt-3 max-w-xl text-sm leading-relaxed text-dim">{copy.detail}</p>

          <ol className="mt-7 grid gap-2" aria-label="Deposit progress">
            <ProgressStep index="01" label="Custody approved" detail="The ERC-721 permission was confirmed separately." reached current={phase === "wallet"} />
            <ProgressStep
              index="02"
              label="NFT + backing escrowed"
              detail={`${formatBacking(backing)} HYPE is paired atomically with token #${intent.tokenId.toString()}.`}
              reached={escrowReached}
              current={!failed && !escrowReached}
            />
            <ProgressStep
              index="03"
              label={listing?.status === "staged" ? "Queued for activation" : "Pool position activated"}
              detail={listing ? `Recorded on-chain as listing #${listing.id.toString()}.` : "The final listing number appears after confirmation."}
              reached={positionReached}
              current={!failed && escrowReached && !positionReached}
            />
          </ol>

          {error && (
            <div className="mt-5 rounded-xl border border-red/30 bg-red/8 p-3 text-xs" role="alert">
              <div className="font-semibold text-red">{error.title}</div>
              {error.detail && <div className="mt-1 text-dim">{error.detail}</div>}
            </div>
          )}

          <div className="mt-6 flex flex-wrap gap-2">
            {listing ? (
              <>
                <Button variant="primary" onClick={() => router.push(`/?listing=${listing.id.toString()}`)}>
                  View live card
                </Button>
                <Button variant="secondary" onClick={() => router.push("/positions")}>
                  Manage position
                </Button>
              </>
            ) : failed ? (
              <Button variant="primary" onClick={onReset}>Return to deposit</Button>
            ) : (
              <div className="inline-flex items-center gap-2 rounded-full border border-violet/25 bg-violet/8 px-3 py-2 text-xs text-dim">
                <span className="deposit-live-dot" aria-hidden />
                Live status — no second submission needed
              </div>
            )}
            {listing && <Button variant="ghost" onClick={onReset}>Deposit another</Button>}
          </div>
        </div>
      </div>
    </section>
  );
}

function ProgressStep({
  index,
  label,
  detail,
  reached,
  current = false,
}: {
  index: string;
  label: string;
  detail: string;
  reached: boolean;
  current?: boolean;
}) {
  return (
    <li className={`deposit-progress-step ${reached ? "is-reached" : ""} ${current ? "is-current" : ""}`}>
      <span className="deposit-progress-index">{reached ? "✓" : index}</span>
      <span className="min-w-0">
        <strong className="block text-xs text-ink">{label}</strong>
        <span className="mt-0.5 block text-2xs leading-snug text-mute">{detail}</span>
      </span>
    </li>
  );
}

function formatBacking(value: bigint): string {
  const whole = value / 10n ** 18n;
  const fraction = (value % 10n ** 18n).toString().padStart(18, "0").slice(0, 4).replace(/0+$/u, "");
  return fraction ? `${whole.toString()}.${fraction}` : whole.toString();
}
