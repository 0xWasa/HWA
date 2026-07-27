import { formatHype } from "@/lib/units";
import type { PoolSnapshot } from "@/protocol/types";

type MarketMode = "syncing" | "genesis" | "live" | "drawing" | "paused";

function marketMode(snapshot: PoolSnapshot | undefined, inFlightCount: number): MarketMode {
  if (!snapshot) return "syncing";
  if (snapshot.activeListingCount === 0) return "genesis";
  if (inFlightCount > 0) return "drawing";
  if (!snapshot.acquisitionsEnabled) return "paused";
  return "live";
}

const MODE_COPY: Record<MarketMode, { label: string; detail: string; tone: string }> = {
  syncing: { label: "SYNCING", detail: "Reading HyperEVM", tone: "text-mute" },
  genesis: { label: "GENESIS", detail: "First position needed", tone: "text-accent" },
  live: { label: "MARKET LIVE", detail: "Random draw open", tone: "text-green" },
  drawing: { label: "DRAW IN FLIGHT", detail: "Randomness settling", tone: "text-chain" },
  paused: { label: "MARKET PAUSED", detail: "Pool visible, buys closed", tone: "text-amber" },
};

export function PoolMissionHud({
  snapshot,
  inFlightCount,
}: {
  snapshot?: PoolSnapshot;
  inFlightCount: number;
}) {
  const mode = marketMode(snapshot, inFlightCount);
  const activeStep = mode === "genesis" ? 0 : mode === "drawing" ? 2 : 1;
  const copy = MODE_COPY[mode];

  return (
    <div className="market-hud relative z-20 shrink-0 border-b border-line/70 px-3 py-2 sm:px-4" data-testid="market-hud">
      <div className="mx-auto flex min-h-11 w-full max-w-6xl items-center gap-3">
        <div className="flex min-w-[6.4rem] items-center gap-2 sm:min-w-[9.5rem] sm:gap-2.5">
          <span
            aria-hidden
            className={`relative size-2 rounded-full ${
              mode === "live"
                ? "anim-ping bg-green text-green"
                : mode === "drawing"
                  ? "anim-ping bg-chain text-chain"
                  : mode === "genesis"
                    ? "bg-accent"
                    : mode === "paused"
                      ? "bg-amber"
                      : "anim-pulse bg-mute"
            }`}
          />
          <div className="min-w-0">
            <div className={`mlabel whitespace-nowrap ${copy.tone}`}>{copy.label}</div>
            <div className="mt-1 hidden truncate text-3xs text-mute sm:block">{copy.detail}</div>
          </div>
        </div>

        <div className="hidden h-7 w-px shrink-0 bg-line/80 sm:block" aria-hidden />

        <ol className="market-steps flex min-w-0 flex-1 items-center" aria-label="Protocol game loop">
          {[
            ["01", "BACK", "Supply liquidity"],
            ["02", "DRAW", "Buy a random position"],
            ["03", "EXIT", "Keep, relist or sell"],
          ].map(([index, title, detail], stepIndex) => (
            <li
              key={index}
              className="market-step group flex min-w-0 flex-1 items-center"
              data-active={activeStep === stepIndex}
              data-complete={activeStep > stepIndex}
            >
              <span className="market-step__index num shrink-0 font-mono text-3xs">{index}</span>
              <span className="ml-2 min-w-0">
                <span className="market-step__title block truncate font-mono text-2xs font-bold tracking-[0.08em]">
                  {title}
                </span>
                <span className="hidden truncate text-3xs text-mute xl:block">{detail}</span>
              </span>
              {stepIndex < 2 && <span className="market-step__line mx-2 h-px min-w-3 flex-1" aria-hidden />}
            </li>
          ))}
        </ol>

        <div className="hidden shrink-0 items-center gap-5 border-l border-line/80 pl-4 xl:flex">
          <HudMetric label="ENTRY" value={snapshot ? `${formatHype(snapshot.totalPrice)} HYPE` : "—"} accent />
          <HudMetric label="POOL DEPTH" value={snapshot ? `${formatHype(snapshot.totalBacking)} HYPE` : "—"} />
          <HudMetric label="POSITIONS" value={snapshot ? String(snapshot.activeListingCount) : "—"} />
        </div>
      </div>
    </div>
  );
}

function HudMetric({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="text-right">
      <div className="mlabel text-3xs text-faint">{label}</div>
      <div className={`num mt-1 font-mono text-2xs font-bold ${accent ? "text-accent" : "text-ink"}`}>{value}</div>
    </div>
  );
}
