"use client";

import { useState, type ReactNode } from "react";
import { minHwaOutFromSpotPrice } from "@/lib/units";
import { FWA_PARAMS } from "@/protocol/params";
import { useAccountState, useProtocol } from "@/protocol/provider";
import type { Listing, SettlementChoice } from "@/protocol/types";
import { useProtocolAction } from "@/state/actions";
import { useNativeBalance, usePoolSnapshot, useRewards, useSettlementInfo, useTokenMarket } from "@/state/queries";
import { AmountInput } from "@/components/ui/AmountInput";
import { Button } from "@/components/ui/Button";
import { Countdown } from "@/components/ui/Countdown";
import { Hype } from "@/components/ui/Hype";

/* Wording contract shared with the feed chips. Keyed by the union so a new
   outcome fails the build instead of leaking a raw enum into the sentence. */
const OUTCOME_TEXT: Record<NonNullable<Listing["settlement"]>, string> = {
  kept: "you kept the NFT",
  relisted: "relisted as your own position",
  bid_accepted: "bid accepted, paid in HYPE",
  bid_accepted_tokens: "bid accepted, paid in $HWA",
  depositor_reclaim_nft: "the depositor took the NFT back",
  depositor_reclaim_backing: "the depositor took the backing",
  finalized: "finalized after the settlement window",
};

/** Four purchaser outcomes, kept inline on the acquisition result surface. */
export function InlineSettlementPanel({
  listing,
  onSettled,
}: {
  listing: Listing;
  onSettled?: (choice: SettlementChoice["kind"]) => void;
}) {
  const { data: info } = useSettlementInfo(listing.id);
  const { data: snapshot } = usePoolSnapshot();
  const { data: rewards } = useRewards();
  const { data: balance } = useNativeBalance();
  const { data: market } = useTokenMarket();
  const action = useProtocolAction();
  const account = useAccountState();
  const { writesEnabled, exitWritesEnabled } = useProtocol();
  const [relistBacking, setRelistBacking] = useState<bigint | null>(listing.backing);
  const [minTokensOverride, setMinTokensOverride] = useState<{ listingId: bigint; value: bigint | null } | null>(null);
  const [submitted, setSubmitted] = useState<SettlementChoice["kind"] | null>(null);
  const suggestedMinTokensOut = info && market?.price
    ? minHwaOutFromSpotPrice(info.bidPayout, market.price, FWA_PARAMS.defaultDriftBps)
    : null;
  const minTokensOut = minTokensOverride?.listingId === listing.id
    ? (minTokensOverride.value ?? suggestedMinTokensOut)
    : suggestedMinTokensOut;

  if (listing.status !== "allocated") {
    return (
      <div className="rounded-xl border border-green/25 bg-green/8 p-4" data-testid="settlement-complete">
        <div className="mlabel text-green">SETTLEMENT RECORDED</div>
        <p className="mt-1 text-sm text-dim">
          This position is no longer awaiting a purchaser decision
          {listing.settlement ? `: ${OUTCOME_TEXT[listing.settlement]}.` : "."}
        </p>
      </div>
    );
  }

  const isPurchaser =
    account.status === "connected" &&
    !!account.address &&
    !!listing.purchaser &&
    account.address.toLowerCase() === listing.purchaser.toLowerCase();
  if (!isPurchaser) {
    return (
      <div className="rounded-xl border border-amber/25 bg-amber/8 p-4 text-sm text-amber" role="alert">
        Settlement choices are only available to the on-chain purchaser of this listing.
      </div>
    );
  }

  const tokensAvailable = rewards?.moduleActive ?? false;
  const windowOpen = info !== undefined && info !== null && Date.now() / 1000 < info.purchaserWindowEndsAt;

  async function submit(choice: SettlementChoice) {
    const tx = await action.run((client) => client.settle({ listingId: listing.id, choice }));
    if (!tx) return;
    setSubmitted(choice.kind);
    onSettled?.(choice.kind);
  }

  return (
    <section className="space-y-3" data-testid="inline-settlement-panel" aria-label="Choose settlement outcome">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="mlabel text-secondary-readable">CHOOSE THE OUTCOME</div>
          <p className="mt-1 text-2xs text-mute">You can keep the NFT or take the standing bid — never both.</p>
        </div>
        {info && (
          <span className={`rounded-full border px-2.5 py-1 text-2xs ${windowOpen ? "border-accent/30 bg-accent/8 text-accent" : "border-amber/30 bg-amber/8 text-amber"}`}>
            {windowOpen ? <>Exclusive window · <Countdown until={info.purchaserWindowEndsAt} /></> : "Purchaser window elapsed"}
          </span>
        )}
      </div>

      {submitted && (
        <div className="rounded-md border border-chain/30 bg-chain/8 p-3 text-2xs text-chain" role="status">
          Settlement submitted. Keep this page open until the transaction reaches <span className="font-semibold">completed</span> in the transaction dock.
        </div>
      )}

      {action.error && (
        <div className="rounded-md border border-red/30 bg-red/10 p-3 text-2xs" role="alert">
          <div className="font-semibold text-red">{action.error.title}</div>
          {action.error.detail && <div className="mt-0.5 text-dim">{action.error.detail}</div>}
        </div>
      )}

      <SettlementRow
        title="Keep NFT"
        detail={`The NFT transfers to you. The depositor receives backing minus the ${FWA_PARAMS.ownerSettlementFeeBps / 100}% protocol cut.`}
        action={
          <Button variant="primary" disabled={!exitWritesEnabled} onClick={() => void submit({ kind: "keep" })} loading={action.submitting} data-testid="settle-keep">
            Keep NFT
          </Button>
        }
      />

      <SettlementRow
        title="Auto-relist"
        detail="Keep the NFT in protocol custody and create your own pool position with fresh HYPE backing."
        controls={
          <AmountInput
            id={`result-relist-${listing.id.toString()}`}
            label="New HYPE backing"
            value={relistBacking}
            onChange={setRelistBacking}
            max={balance}
          />
        }
        action={
          <Button
            variant="violet"
            disabled={
              !writesEnabled ||
              relistBacking === null ||
              relistBacking < (snapshot?.minBacking ?? FWA_PARAMS.minBacking)
            }
            onClick={() => relistBacking !== null && void submit({ kind: "relist", newBacking: relistBacking })}
            loading={action.submitting}
            data-testid="settle-relist"
          >
            Auto-relist
          </Button>
        }
      />

      <SettlementRow
        title="Accept HYPE"
        detail={info ? `Return the NFT to its depositor and receive ${info.bidPayoutBps / 100}% of backing immediately.` : "Return the NFT to its depositor for the standing HYPE bid."}
        value={info ? <Hype wei={info.bidPayout} maxDecimals={4} /> : undefined}
        action={
          <Button variant="secondary" disabled={!exitWritesEnabled} onClick={() => void submit({ kind: "acceptBidHype" })} loading={action.submitting} data-testid="settle-acceptBidHype">
            Accept HYPE
          </Button>
        }
      />

      <SettlementRow
        title="Accept $HWA"
        detail={tokensAvailable ? "Same 85% exit, bought as HWA through Project X with your min-out guard." : "Unavailable until the HWA rewards/Project X route is active."}
        controls={tokensAvailable ? (
          <AmountInput
            id={`result-min-fwa-${listing.id.toString()}`}
            label="Minimum HWA received"
            value={minTokensOut}
            onChange={(value) => setMinTokensOverride({ listingId: listing.id, value })}
            unit="HWA"
          />
        ) : undefined}
        action={
          <Button
            variant="secondary"
            disabled={!exitWritesEnabled || !tokensAvailable || minTokensOut === null || minTokensOut <= 0n}
            onClick={() => {
              if (minTokensOut !== null && minTokensOut > 0n) {
                void submit({ kind: "acceptBidTokens", minTokensOut });
              }
            }}
            loading={action.submitting}
            data-testid="settle-acceptBidTokens"
          >
            Accept $HWA
          </Button>
        }
      />

      {!windowOpen && info && (
        <p className="rounded-md border border-amber/25 bg-amber/7 p-3 text-2xs leading-relaxed text-amber">
          The depositor may now resolve the position too; after seven days anyone can finalize it. The first valid transaction wins.
        </p>
      )}
    </section>
  );
}

function SettlementRow({
  title,
  detail,
  value,
  controls,
  action,
}: {
  title: string;
  detail: string;
  value?: ReactNode;
  controls?: ReactNode;
  action: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-line bg-inset/72 p-3 transition-colors hover:border-line-strong">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-ink">{title}</h3>
            {value && <span className="text-xs font-semibold text-accent">{value}</span>}
          </div>
          <p className="mt-1 text-2xs leading-relaxed text-mute">{detail}</p>
          {controls && <div className="mt-2 max-w-sm">{controls}</div>}
        </div>
        <div className="shrink-0 sm:w-36 [&>button]:w-full">{action}</div>
      </div>
    </div>
  );
}
