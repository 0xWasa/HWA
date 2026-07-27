import type { ReactNode } from "react";
import { InfoTip } from "./InfoTip";
import { Skeleton } from "./Skeleton";
import { Sparkline, type SparkSeries, type SparkTone } from "./Sparkline";

/**
 * Headline stat: micro-label, one big number, optional change chip and an
 * optional area sparkline filling the lower edge of the card.
 *
 * `value === undefined` means "not loaded yet" and renders the skeleton — a
 * genuinely absent value (no crown, module off) must be passed as a rendered
 * placeholder such as "—" so the card never shimmers forever.
 */

export type StatTone = "ink" | "accent" | "amber" | "green" | "red" | "blue";

const VALUE_TONE: Record<StatTone, string> = {
  ink: "text-ink",
  accent: "text-accent",
  amber: "text-amber",
  green: "text-green",
  red: "text-red",
  blue: "text-blue",
};

/** Signed percent from an integer bps delta (bps are integers, so this float
 *  is presentation only and never touches an amount). */
function formatDeltaBps(bps: number): string {
  const pct = Math.abs(bps) / 100;
  const sign = bps > 0 ? "+" : bps < 0 ? "-" : "";
  return `${sign}${pct.toFixed(pct >= 10 ? 1 : 2)}%`;
}

export interface StatSpark {
  series: SparkSeries;
  tone?: SparkTone;
  height?: number;
  /** Screen-reader description. Say what the series is and what it covers. */
  ariaLabel?: string;
  /** Small honest caption above the plot ("since page load", "24h"…). */
  caption?: ReactNode;
}

export function StatCard({
  label,
  tip,
  value,
  sub,
  tone = "ink",
  deltaBps,
  deltaNote,
  spark,
  className = "",
  testId,
}: {
  label: ReactNode;
  /** Optional explainer rendered next to the label. */
  tip?: ReactNode;
  /** undefined → skeleton. */
  value?: ReactNode;
  sub?: ReactNode;
  tone?: StatTone;
  /** Signed integer bps. Positive is green, negative red. */
  deltaBps?: number;
  /** Qualifier printed next to the chip so the window is never implied. */
  deltaNote?: ReactNode;
  spark?: StatSpark;
  className?: string;
  testId?: string;
}) {
  const loading = value === undefined;
  const up = (deltaBps ?? 0) > 0;
  const down = (deltaBps ?? 0) < 0;

  return (
    <div className={`card flex min-w-0 flex-col overflow-hidden ${className}`} data-testid={testId}>
      <div className="flex min-w-0 flex-col gap-1.5 px-4 pt-3.5">
        {/* min-h reserves the delta chip's line box so a card that gains a chip
            later (or sits beside one) never changes the row's height. */}
        <div className="flex min-h-[1.125rem] min-w-0 items-center justify-between gap-2">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="mlabel truncate text-mute">{label}</span>
            {tip !== undefined && <InfoTip label="More info">{tip}</InfoTip>}
          </span>
          {deltaBps !== undefined && !loading && (
            <span className="flex shrink-0 items-center gap-1.5">
              <span
                className={`num rounded-xs px-1.5 py-0.5 font-mono text-2xs font-semibold ${
                  up
                    ? "bg-green/12 text-green"
                    : down
                      ? "bg-red/12 text-red"
                      : "bg-control text-mute"
                }`}
              >
                {formatDeltaBps(deltaBps)}
              </span>
              {deltaNote !== undefined && <span className="text-2xs text-mute">{deltaNote}</span>}
            </span>
          )}
        </div>

        {loading ? (
          <Skeleton className="h-7 w-28" />
        ) : (
          // Amounts are mono everywhere in the system; <Hype> already forces it
          // on its own span, so plain values must match rather than fall back
          // to the display face.
          <div className={`num truncate font-mono text-2xl font-semibold leading-tight ${VALUE_TONE[tone]}`}>
            {value}
          </div>
        )}

        {sub !== undefined && (
          <div className="truncate text-2xs text-mute">{loading ? <Skeleton className="h-3 w-20" /> : sub}</div>
        )}
      </div>

      {spark ? (
        <div className="mt-auto pt-3">
          {spark.caption !== undefined && (
            <div className="px-4 pb-1 text-2xs text-mute">{spark.caption}</div>
          )}
          <Sparkline
            series={spark.series}
            tone={spark.tone ?? "accent"}
            height={spark.height ?? 44}
            ariaLabel={spark.ariaLabel}
          />
        </div>
      ) : (
        <div className="h-4" />
      )}
    </div>
  );
}
