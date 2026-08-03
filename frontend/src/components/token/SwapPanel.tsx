"use client";

import { useState } from "react";
import { env } from "@/config/env";
import { chainLabel } from "@/config/chains";
import { conciseError } from "@/lib/errors";
import { formatHwa } from "@/lib/units";
import { useAccountState, useProtocol } from "@/protocol/provider";
import type { SwapSide, TokenMarket } from "@/protocol/types";
import { useProtocolAction } from "@/state/actions";
import { useSwapQuote, useTradeAllowance } from "@/state/queries";
import { AmountInput } from "@/components/ui/AmountInput";
import { Button } from "@/components/ui/Button";
import { Hype } from "@/components/ui/Hype";
import { InfoTip } from "@/components/ui/InfoTip";
import { Segmented } from "@/components/ui/Segmented";

/**
 * Buy/Sell Project X panel. `amountIn` is denominated in the token being
 * spent — HYPE wei when buying, HWA wei when selling — so switching side
 * always clears the field (a raw remount, since the amount is meaningless in
 * the other unit).
 */

const SLIPPAGE_PRESETS = [50, 100, 250] as const;

/** Price impact above this reads as a warning, twice that as a danger. */
const IMPACT_WARN_BPS = 300;

type Unit = "HYPE" | "HWA";

function Amount({ wei, unit, className = "" }: { wei: bigint; unit: Unit; className?: string }) {
  if (unit === "HYPE") return <Hype wei={wei} maxDecimals={6} className={className} />;
  return (
    <span className={`num font-mono ${className}`}>
      {formatHwa(wei, 4)}
      <span className="ml-1 text-[0.85em] text-mute">HWA</span>
    </span>
  );
}

export function SwapPanel({ market }: { market: TokenMarket }) {
  const { writesEnabled, manifestState } = useProtocol();
  const account = useAccountState();
  const action = useProtocolAction();

  const [side, setSide] = useState<SwapSide>("buy");
  const [amountIn, setAmountIn] = useState<bigint | null>(null);
  const [slippageBps, setSlippageBps] = useState<number>(100);
  // Bumped to remount AmountInput: its text state is internal and cannot be
  // cleared from the outside.
  const [fieldKey, setFieldKey] = useState(0);

  // The venue is only off-limits while the token contract keeps public buys
  // shut. Once they are open the app quotes and submits the trade itself,
  // delivering straight from the pool to the trader, which is the only shape
  // HWA's transfer guard accepts.
  const venueClosed = market.externalBuysEnabled === false;
  const quote = useSwapQuote(side, venueClosed ? null : amountIn, slippageBps);
  const allowance = useTradeAllowance(side === "sell" ? account.address : undefined);
  const needsApproval =
    side === "sell" && amountIn !== null && allowance.data !== undefined && allowance.data < amountIn;

  const payUnit: Unit = side === "buy" ? "HYPE" : "HWA";
  const receiveUnit: Unit = side === "buy" ? "HWA" : "HYPE";
  const connected = account.status === "connected";
  const balance = connected ? (side === "buy" ? market.user?.hypeBalance : market.user?.tokenBalance) : undefined;
  const insufficient = amountIn !== null && balance !== undefined && amountIn > balance;
  const impactBps = quote.data?.priceImpactBps ?? 0;
  const testHarnessOnly =
    manifestState.status === "ready" && manifestState.manifest.features.dexMode === "projectx-v3-compat-testnet";

  if (venueClosed) {
    const open = false;
    return (
      <section
        data-testid="swap-panel"
        aria-label="Trade HWA on Project X"
        className="flex flex-col gap-3 rounded-md border border-line bg-panel p-3"
      >
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-mute">Trade on Project X</h2>
          <span className={`rounded-full px-2 py-1 text-3xs font-semibold ${open ? "bg-green/15 text-green" : "bg-amber/15 text-amber"}`}>
            {open ? "PUBLIC MARKET OPEN" : "BUYS CLOSED"}
          </span>
        </div>
        <div className="rounded-sm border border-line-subtle bg-inset p-3 text-xs leading-relaxed text-dim">
          {open
            ? "Public pool buys are enabled on-chain. Quotes, approvals and swaps are handled by Project X's reviewed interface."
            : "The pool is initialized, but public buys remain disabled by the token contract. The owner can open or close them manually; there is no timer or automatic unlock."}
        </div>
        {open && market.externalTradeUrl ? (
          <a
            href={market.externalTradeUrl}
            target="_blank"
            rel="noreferrer"
            className="flex h-10 items-center justify-center rounded-sm bg-primary px-3 text-sm font-semibold text-primary-ink transition hover:brightness-110"
            data-testid="swap-external-link"
          >
            Open HWA / HYPE on Project X ↗
          </a>
        ) : (
          <Button variant="primary" size="lg" className="w-full" disabled data-testid="swap-external-closed">
            {open ? "Project X route pending review" : "Public buys not enabled"}
          </Button>
        )}
        <p className="text-2xs leading-snug text-mute">
          Pool trades are not proxied by HWA. Protocol buybacks use the restricted adapter; public users interact directly
          with Project X. Always verify the token and pool addresses shown on this page.
        </p>
      </section>
    );
  }

  function switchSide(next: SwapSide) {
    if (next === side) return;
    setSide(next);
    setAmountIn(null);
    setFieldKey((n) => n + 1);
    action.clearError();
  }

  async function onSwap() {
    const quoted = quote.data;
    if (!quoted) return;
    const tx = await action.run((client) => client.swap({ quote: quoted }));
    if (tx) {
      setAmountIn(null);
      setFieldKey((n) => n + 1);
    }
  }

  // Selling moves HWA through the venue, so it needs an allowance first. The
  // approval is for this sale only: a standing unlimited one is a permanent
  // claim on the balance for a token this volatile.
  async function onApprove() {
    if (amountIn === null) return;
    const tx = await action.run((client) => client.approveTradeToken(amountIn));
    if (tx) void allowance.refetch();
  }

  const ctaLabel = insufficient
    ? `Insufficient ${payUnit} balance`
    : amountIn === null || amountIn <= 0n
      ? "Enter an amount"
      : quote.isError
        ? "Quote unavailable"
        : !quote.data
          ? "Fetching quote…"
          : side === "buy"
            ? "Buy HWA"
            : "Sell HWA";

  return (
    <section
      data-testid="swap-panel"
      aria-label="Swap HWA"
      className="flex flex-col gap-3 rounded-md border border-line bg-panel p-3"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-mute">Trade</h2>
        <Segmented
          ariaLabel="Swap direction"
          value={side}
          onChange={switchSide}
          options={[
            { value: "buy", label: "BUY" },
            { value: "sell", label: "SELL" },
          ]}
        />
      </div>

      {/* You pay */}
      <div className="space-y-1.5">
        <div className="flex items-baseline justify-between gap-2">
          <label htmlFor="swap-amount" className="text-2xs uppercase tracking-wide text-mute">
            You pay <span className="font-semibold text-dim">{payUnit}</span>
          </label>
          {balance !== undefined && (
            <span className="text-2xs text-mute" data-testid="swap-balance">
              Balance <Amount wei={balance} unit={payUnit} className="text-dim" />
            </span>
          )}
        </div>
        <AmountInput
          key={fieldKey}
          id="swap-amount"
          label={side === "buy" ? "Amount of HYPE to spend" : "Amount of HWA to sell"}
          value={amountIn}
          onChange={setAmountIn}
          max={balance}
        />
      </div>

      {/* You receive */}
      <div className="space-y-1.5">
        <span className="block text-2xs uppercase tracking-wide text-mute">
          You receive (est.) <span className="font-semibold text-dim">{receiveUnit}</span>
        </span>
        <div
          className="flex h-ctl-lg items-center rounded-sm border border-line-subtle bg-inset px-2.5"
          data-testid="swap-receive"
        >
          {quote.data ? (
            <Amount wei={quote.data.amountOut} unit={receiveUnit} className="text-base text-ink" />
          ) : (
            <span className="num font-mono text-base text-faint">0.00</span>
          )}
        </div>
      </div>

      {/* Slippage */}
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1 text-2xs text-mute">
          Max slippage
          <InfoTip>
            The swap reverts if the pool moves against you by more than this between signing and execution. The minimum
            you receive is enforced on-chain.
          </InfoTip>
        </span>
        <div className="flex gap-1" role="group" aria-label="Max slippage">
          {SLIPPAGE_PRESETS.map((bps) => (
            <button
              key={bps}
              type="button"
              data-testid={`slippage-${bps}`}
              onClick={() => setSlippageBps(bps)}
              aria-pressed={slippageBps === bps}
              className={`h-6 rounded-xs px-1.5 text-3xs font-semibold transition-colors ${
                slippageBps === bps ? "bg-control text-accent" : "text-mute hover:text-dim"
              }`}
            >
              {bps / 100}%
            </button>
          ))}
        </div>
      </div>

      {/* Quote breakdown */}
      <dl className="space-y-1 border-t border-line-subtle pt-2 text-2xs text-dim">
        <div className="flex items-center justify-between gap-2">
          <dt className="text-mute">Rate</dt>
          <dd className="num font-mono">
            {market.price ? (
              <>
                1 HWA = <Hype wei={market.price} maxDecimals={9} />
              </>
            ) : (
              "—"
            )}
          </dd>
        </div>
        <div className="flex items-center justify-between gap-2">
          <dt className="text-mute">Pool fee</dt>
          <dd className="num font-mono">
            {quote.data ? `${quote.data.feeBps / 100}%` : market.feeTierBps ? `${market.feeTierBps / 100}%` : "—"}
          </dd>
        </div>
        <div className="flex items-center justify-between gap-2">
          <dt className="text-mute">Price impact</dt>
          <dd
            className={`num font-mono ${
              impactBps >= IMPACT_WARN_BPS * 2 ? "text-red" : impactBps >= IMPACT_WARN_BPS ? "text-amber" : ""
            }`}
            data-testid="swap-impact"
          >
            {quote.data ? `${(impactBps / 100).toFixed(2)}%` : "—"}
          </dd>
        </div>
        <div className="flex items-center justify-between gap-2">
          <dt className="text-mute">Minimum received</dt>
          <dd data-testid="swap-min-out">
            {quote.data ? <Amount wei={quote.data.minOut} unit={receiveUnit} /> : <span className="text-mute">—</span>}
          </dd>
        </div>
      </dl>

      {/* Errors */}
      {quote.isError && (
        <div className="rounded-sm border border-red/30 bg-red/10 p-2 text-2xs text-red" role="alert">
          Quote unavailable — {conciseError(quote.error)}.
        </div>
      )}
      {action.error && (
        <div className="rounded-sm border border-red/30 bg-red/10 p-2 text-2xs" role="alert">
          <div className="font-semibold text-red">{action.error.title}</div>
          {action.error.detail && <div className="mt-0.5 text-dim">{action.error.detail}</div>}
        </div>
      )}

      {/* CTA — mirrors PurchaseSidebar's connect / switch / act ladder */}
      {testHarnessOnly ? (
        <div className="rounded-lg border border-amber/30 bg-amber/10 p-3 text-center" data-testid="swap-harness-disabled">
          <div className="text-sm font-medium text-amber">Public swaps disabled</div>
          <div className="mt-0.5 text-2xs text-mute">Chain 998 uses an ABI-compatible V3 venue for validation; it is not an official Project X market.</div>
        </div>
      ) : !writesEnabled ? (
        <div className="rounded-lg border border-line bg-control/50 p-3 text-center">
          <div className="text-sm font-medium text-dim">Read-only mode</div>
          <div className="mt-0.5 text-2xs text-mute">No deployment manifest for this chain.</div>
        </div>
      ) : !connected ? (
        <Button variant="primary" size="lg" className="w-full" data-testid="swap-connect" onClick={account.connect}>
          Connect wallet to trade
        </Button>
      ) : account.isWrongNetwork ? (
        <Button
          variant="primary"
          size="lg"
          className="w-full"
          data-testid="swap-switch"
          onClick={() => void account.switchToAppNetwork()}
        >
          Switch to {chainLabel(env.chainId)}
        </Button>
      ) : needsApproval ? (
        <Button
          variant="primary"
          size="lg"
          className="w-full"
          data-testid="swap-approve"
          loading={action.submitting}
          disabled={insufficient}
          onClick={() => void onApprove()}
        >
          {insufficient ? `Insufficient ${payUnit} balance` : "Approve HWA to sell"}
        </Button>
      ) : (
        <Button
          variant="primary"
          size="lg"
          className="w-full"
          data-testid="swap-submit"
          loading={action.submitting}
          disabled={!quote.data || insufficient}
          onClick={() => void onSwap()}
        >
          {ctaLabel}
        </Button>
      )}

      <p className="text-2xs leading-snug text-mute">
        {testHarnessOnly ? "Project X-compatible test route via" : "Routed through"} {market.dex ?? "Project X"}
        {market.feeTierBps !== undefined ? ` (${market.feeTierBps / 100}% tier, wHYPE pair)` : ""}. $HWA has no
        guaranteed value.
        {side === "buy" && balance !== undefined ? " MAX spends your whole balance — keep some HYPE for gas." : ""}
      </p>
    </section>
  );
}
