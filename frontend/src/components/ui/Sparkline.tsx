"use client";

import { useId, useMemo } from "react";

/**
 * Dependency-free area+line sparkline.
 *
 * bigint values are converted to Number for *pixel geometry only* — nothing
 * here is ever displayed as an amount, so no precision reaches the user.
 * The plot stretches with `preserveAspectRatio="none"`, so strokes use
 * `vector-effect: non-scaling-stroke` and the last-point dot is an HTML node
 * (an SVG circle would be squashed by the non-uniform scale).
 */

export type SparkTone = "accent" | "amber" | "blue" | "green" | "red";

export interface SparkPoint {
  /** Unix seconds. Kept for callers' bookkeeping; spacing is index-based. */
  t: number;
  v: bigint;
}

export type SparkSeries = readonly bigint[] | readonly SparkPoint[];

const TONE_COLOR: Record<SparkTone, string> = {
  accent: "var(--hwa-accent)",
  amber: "var(--hwa-warning)",
  blue: "var(--hwa-info)",
  green: "var(--hwa-success)",
  red: "var(--hwa-danger)",
};

/** Percent-sized viewBox: 1 user unit === 1% of the box, both axes. */
const VB = 100;
const PAD_Y = 12;
const PLOT_H = VB - PAD_Y * 2;

function valuesOf(series: SparkSeries): bigint[] {
  const out: bigint[] = [];
  for (const p of series as readonly (bigint | SparkPoint)[]) {
    out.push(typeof p === "bigint" ? p : p.v);
  }
  return out;
}

export function Sparkline({
  series,
  tone = "accent",
  height = 44,
  className = "",
  ariaLabel,
}: {
  series: SparkSeries;
  tone?: SparkTone;
  /** CSS pixels of plot height. */
  height?: number;
  className?: string;
  /** Omitted → the plot is decorative and hidden from assistive tech. */
  ariaLabel?: string;
}) {
  const rawId = useId();
  // useId() emits delimiter characters (`:` or `«»`, depending on the React
  // build) that are unsafe inside a `url(#…)` paint reference, so strip them.
  const gradientId = `spark${rawId.replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const titleId = useId();
  const color = TONE_COLOR[tone];

  const geometry = useMemo(() => {
    const values = valuesOf(series);
    if (values.length < 2) return null;
    let min = values[0]!;
    let max = min;
    for (const v of values) {
      if (v < min) min = v;
      if (v > max) max = v;
    }
    const span = Number(max - min);
    // A flat series has no vertical information — draw it down the middle.
    const y = (v: bigint) => (span <= 0 ? VB / 2 : PAD_Y + (1 - Number(v - min) / span) * PLOT_H);
    const points = values.map((v, i) => ({
      x: (i / (values.length - 1)) * VB,
      y: y(v),
    }));
    const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(" ");
    const first = points[0]!;
    const last = points[points.length - 1]!;
    const area = `${line} L${last.x.toFixed(2)},${VB} L${first.x.toFixed(2)},${VB} Z`;
    return { line, area, last };
  }, [series]);

  const a11y = ariaLabel
    ? ({ role: "img", "aria-labelledby": titleId } as const)
    : ({ "aria-hidden": true } as const);

  if (!geometry) {
    // 0 or 1 point: a baseline, so the card keeps its shape without implying data.
    return (
      <div className={`relative w-full ${className}`} style={{ height }}>
        <svg
          viewBox={`0 0 ${VB} ${VB}`}
          preserveAspectRatio="none"
          className="absolute inset-0 size-full"
          {...a11y}
        >
          {ariaLabel && <title id={titleId}>{ariaLabel}</title>}
          {/* Barely-there rule: it holds the slot without reading as a broken
              or half-loaded chart while samples accumulate. */}
          <line
            x1={0}
            x2={VB}
            y1={VB - 1}
            y2={VB - 1}
            className="stroke-line-subtle"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      </div>
    );
  }

  return (
    <div className={`relative w-full ${className}`} style={{ height }}>
      <svg
        viewBox={`0 0 ${VB} ${VB}`}
        preserveAspectRatio="none"
        className="absolute inset-0 size-full"
        {...a11y}
      >
        {ariaLabel && <title id={titleId}>{ariaLabel}</title>}
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.3" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={geometry.area} fill={`url(#${gradientId})`} />
        <path
          d={geometry.line}
          fill="none"
          stroke={color}
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <span
        aria-hidden
        className="absolute size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full"
        style={{
          // Half the dot (6px) pulled inside so it survives a clipped card edge.
          left: `calc(${geometry.last.x}% - 3px)`,
          top: `${geometry.last.y}%`,
          background: color,
          boxShadow: `0 0 0 3px color-mix(in srgb, ${color} 22%, transparent)`,
        }}
      />
    </div>
  );
}
