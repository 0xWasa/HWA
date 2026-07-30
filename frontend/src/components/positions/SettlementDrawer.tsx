"use client";

import { useMemo, useState } from "react";
import { sanitizeLabel } from "@/lib/format";
import { minHwaOutFromSpotPrice } from "@/lib/units";
import { FWA_PARAMS } from "@/protocol/params";
import { useAccountState, useProtocol } from "@/protocol/provider";
import type { Listing, SettlementChoice } from "@/protocol/types";
import { useProtocolAction } from "@/state/actions";
import { useNativeBalance, usePoolSnapshot, useRewards, useSettlementInfo, useTokenMarket } from "@/state/queries";
import { AmountInput } from "@/components/ui/AmountInput";
import { Button } from "@/components/ui/Button";
import { Countdown } from "@/components/ui/Countdown";
import { Drawer } from "@/components/ui/Drawer";
import { Hype } from "@/components/ui/Hype";
import { NFTImage } from "@/components/nft/NFTImage";

type ChoiceKind = "keep" | "relist" | "acceptBidHype" | "acceptBidTokens";

/**
 * Purchaser settlement — the four HWA choices. You can never keep both the
 * NFT and the HYPE; every option shows exactly what you give and receive.
 */
export function SettlementDrawer({
  listing,
  onClose,
  onSettled,
}: {
  listing: Listing | null;
  onClose: () => void;
  onSettled: () => void;
}) {
  const { data: info } = useSettlementInfo(listing?.id ?? null);
  const { data: snapshot } = usePoolSnapshot();
  const { data: rewards } = useRewards();
  const { data: balance } = useNativeBalance();
  const { data: market } = useTokenMarket();
  const action = useProtocolAction();
  const account = useAccountState();
  const { writesEnabled, exitWritesEnabled } = useProtocol();
  const [choice, setChoice] = useState<ChoiceKind | null>(null);
  const [relistBacking, setRelistBacking] = useState<bigint | null>(null);
  const [minTokensOverride, setMinTokensOverride] = useState<{ listingId: bigint; value: bigint | null } | null>(null);

  const tokensAvailable = rewards?.moduleActive ?? false;
  const windowOpen = info !== null && info !== undefined && Date.now() / 1000 < info.purchaserWindowEndsAt;
  const suggestedMinTokensOut = info && market?.price
    ? minHwaOutFromSpotPrice(info.bidPayout, market.price, FWA_PARAMS.defaultDriftBps)
    : null;
  const minTokensOut = listing && minTokensOverride?.listingId === listing.id
    ? (minTokensOverride.value ?? suggestedMinTokensOut)
    : suggestedMinTokensOut;

  const options = useMemo(() => {
    if (!listing || !info) return [];
    return [
      {
        kind: "keep" as const,
        title: "Keep the NFT",
        give: "your claim on the standing bid",
        get: "the NFT, delivered now",
        detail: `Depositor receives backing minus the ${FWA_PARAMS.ownerSettlementFeeBps / 100}% protocol cut.`,
        disabled: false,
      },
      {
        kind: "relist" as const,
        title: "Keep & relist",
        give: "fresh HYPE backing",
        get: "a new listing of this NFT, in one transaction",
        detail: "The NFT never leaves custody; your new backing funds its next standing bid.",
        disabled: false,
      },
      {
        kind: "acceptBidHype" as const,
        title: "Accept the depositor bid",
        give: "the NFT (returns to its depositor)",
        get: (
          <>
            <Hype wei={info.bidPayout} maxDecimals={3} /> ({info.bidPayoutBps / 100}% of backing)
          </>
        ),
        detail: `The ${100 - info.bidPayoutBps / 100}% discount is the price of instant exit.`,
        disabled: false,
      },
      {
        kind: "acceptBidTokens" as const,
        title: "Accept the bid, settled as HWA",
        give: "the NFT (returns to its depositor)",
        get: (
          <>
            <Hype wei={info.bidPayout} maxDecimals={3} /> worth of HWA, bought from the pool
          </>
        ),
        detail: tokensAvailable
          ? "Same sale; the HYPE buys HWA via Project X and sends it to you (minOut protected)."
          : "Unavailable — the HWA rewards module is not activated.",
        disabled: !tokensAvailable,
      },
    ];
  }, [listing, info, tokensAvailable]);

  if (!listing) return null;
  const name = sanitizeLabel(listing.nft.name, `#${listing.tokenId}`);
  const isPurchaser =
    account.status === "connected" &&
    !!account.address &&
    !!listing.purchaser &&
    account.address.toLowerCase() === listing.purchaser.toLowerCase();

  if (!isPurchaser) {
    return (
      <Drawer open onClose={onClose} title={`Settlement unavailable — ${name}`} wide>
        <div className="p-4">
          <p className="rounded-sm border border-amber/30 bg-amber/8 p-3 text-xs text-amber" role="alert">
            Only the on-chain purchaser of this listing can choose a purchaser settlement outcome.
          </p>
        </div>
      </Drawer>
    );
  }

  async function submit() {
    if (!listing || !choice) return;
    let payload: SettlementChoice;
    if (choice === "relist") {
      if (relistBacking === null) return;
      payload = { kind: "relist", newBacking: relistBacking };
    } else if (choice === "acceptBidTokens") {
      if (minTokensOut === null || minTokensOut <= 0n) return;
      payload = { kind: "acceptBidTokens", minTokensOut };
    } else {
      payload = { kind: choice };
    }
    const tx = await action.run((c) => c.settle({ listingId: listing.id, choice: payload }));
    if (tx) {
      onSettled();
      onClose();
    }
  }

  return (
    <Drawer open={listing !== null} onClose={onClose} title={`Settle — ${name}`} wide>
      <div className="space-y-3 p-4" data-testid="settlement-drawer">
        <div className="flex items-center gap-3">
          <div className="size-16 shrink-0 overflow-hidden rounded-sm">
            <NFTImage src={listing.nft.imageUrl} alt={name} rounded={false} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold">{name}</div>
            <div className="truncate text-2xs text-mute">
              {sanitizeLabel(listing.nft.collectionName, "Unknown collection")} · listing{" "}
              <span className="num font-mono">#{listing.id.toString()}</span>
            </div>
            <div className="mt-0.5 text-2xs text-dim">
              Backing <Hype wei={listing.backing} maxDecimals={3} />
            </div>
          </div>
          {info && (
            <div
              className={`shrink-0 rounded-sm border px-2 py-1.5 text-center ${
                windowOpen ? "border-accent/40 bg-accent/8" : "border-amber/40 bg-amber/8"
              }`}
            >
              <div className={`text-3xs uppercase tracking-wide ${windowOpen ? "text-accent" : "text-amber"}`}>
                {windowOpen ? "Your exclusive window" : "Window elapsed"}
              </div>
              <div className={`text-xs font-semibold ${windowOpen ? "text-accent" : "text-amber"}`}>
                {windowOpen ? <Countdown until={info.purchaserWindowEndsAt} /> : "depositor may resolve"}
              </div>
            </div>
          )}
        </div>

        {!windowOpen && info && (
          <p className="rounded-sm border border-amber/30 bg-amber/8 p-2 text-2xs leading-snug text-amber">
            Your 24h exclusive window has passed. You can still settle until the depositor or (after 7 days) anyone
            resolves it — first transaction wins.
          </p>
        )}

        <div className="space-y-1.5" role="radiogroup" aria-label="Settlement choice">
          {options.map((o, doorIndex) => {
            const active = choice === o.kind;
            return (
              <button
                key={o.kind}
                role="radio"
                aria-checked={active}
                disabled={o.disabled}
                data-testid={`settle-${o.kind}`}
                onClick={() => setChoice(o.kind)}
                className={`w-full rounded-data border p-2.5 text-left transition-[color,background-color,border-color,transform] duration-200 ease-(--ease-squish) ${
                  active
                    ? "border-accent bg-accent/8"
                    : o.disabled
                      ? "cursor-not-allowed border-line opacity-45"
                      : "border-line bg-inset hover:-translate-y-px hover:border-line-strong"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-2">
                    <span
                      aria-hidden
                      className={`mlabel shrink-0 ${active ? "text-accent" : "text-faint"}`}
                    >
                      {String(doorIndex + 1).padStart(2, "0")}
                    </span>
                    <span className={`truncate text-xs font-semibold ${active ? "text-accent" : "text-ink"}`}>{o.title}</span>
                  </span>
                  {active && <span aria-hidden className="size-1.5 rounded-full bg-accent" />}
                </div>
                <div className="mt-1 grid grid-cols-2 gap-2 text-2xs">
                  <div>
                    <span className="text-faint">You give </span>
                    <span className="text-dim">{o.give}</span>
                  </div>
                  <div>
                    <span className="text-faint">You get </span>
                    <span className="text-green/90">{o.get}</span>
                  </div>
                </div>
                <div className="mt-1 text-2xs leading-snug text-mute">{o.detail}</div>
              </button>
            );
          })}
        </div>

        {choice === "relist" && (
          <div className="anim-fade-up space-y-1">
            <div className="flex items-center justify-between text-2xs">
              <label htmlFor="relist-backing" className="uppercase tracking-wide text-mute">
                New backing
              </label>
              <span className="text-faint">
                min <Hype wei={snapshot?.minBacking ?? FWA_PARAMS.minBacking} maxDecimals={2} unit={false} /> · bal{" "}
                {balance !== undefined ? <Hype wei={balance} maxDecimals={2} unit={false} /> : "—"}
              </span>
            </div>
            <AmountInput id="relist-backing" label="New HYPE backing" value={relistBacking} onChange={setRelistBacking} max={balance} />
          </div>
        )}

        {choice === "acceptBidTokens" && info && (
          <div className="anim-fade-up space-y-1">
            <div className="flex items-center gap-1 text-2xs uppercase tracking-wide text-mute">
              Minimum HWA out (slippage guard)
            </div>
            <AmountInput
              id="min-tokens-out"
              label="Minimum HWA received"
              value={minTokensOut}
              onChange={(value) => setMinTokensOverride({ listingId: listing.id, value })}
              unit="HWA"
            />
            <p className="text-2xs text-faint">Route: Project X, 1% tier. Default guard: spot quote minus {FWA_PARAMS.defaultDriftBps / 100}%.</p>
          </div>
        )}

        {action.error && (
          <div className="rounded-sm border border-red/30 bg-red/10 p-2 text-2xs" role="alert">
            <div className="font-semibold text-red">{action.error.title}</div>
            {action.error.detail && <div className="mt-0.5 text-dim">{action.error.detail}</div>}
          </div>
        )}

        <div className="grid grid-cols-2 gap-2">
          <Button variant="ghost" onClick={onClose}>
            Later
          </Button>
          <Button
            variant="primary"
            disabled={
              !choice ||
              !exitWritesEnabled ||
              (choice === "relist" &&
                (!writesEnabled || relistBacking === null || relistBacking < (snapshot?.minBacking ?? FWA_PARAMS.minBacking))) ||
              (choice === "acceptBidTokens" && (minTokensOut === null || minTokensOut <= 0n))
            }
            loading={action.submitting}
            data-testid="settle-confirm"
            onClick={() => void submit()}
          >
            Confirm in wallet
          </Button>
        </div>

        <p className="text-2xs leading-snug text-faint">
          You can never keep both the NFT and the standing bid. If you do nothing: after 24h the depositor may resolve;
          after 7 days anyone can finalize the default outcome (NFT to you, net backing to the depositor).
        </p>
      </div>
    </Drawer>
  );
}
