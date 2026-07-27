"use client";

import { useId, useMemo, useState } from "react";
import { isMockMode } from "@/config/env";
import { formatHype } from "@/lib/units";
import type { Candle } from "@/protocol/types";
import { Segmented } from "@/components/ui/Segmented";

/**
 * Inline SVG candlestick chart — no chart library, no network. Candles arrive
 * as 15-minute buckets over 24h; wider timeframes aggregate client-side so the
 * plot always holds 24-48 bodies.
 *
 * bigint prices are converted to Number for *pixel geometry only*; every value
 * that reaches the screen as text is formatted from the original bigint.
 */

type Timeframe = "6h" | "12h" | "24h";

const TIMEFRAMES: Record<Timeframe, { keep: number; group: number; bucket: string }> = {
  "6h": { keep: 24, group: 1, bucket: "15m" },
  "12h": { keep: 48, group: 2, bucket: "30m" },
  "24h": { keep: 96, group: 4, bucket: "1h" },
};

const VB_W = 1000;
const VB_H = 340;
const PAD_T = 16;
const PAD_B = 16;
const PLOT_H = VB_H - PAD_T - PAD_B;
const TICKS = 4;

/** Sub-cent HYPE prices need far more decimals than the 4-decimal money default. */
export function formatPrice(wei: bigint, fixed = false): string {
  return formatHype(wei, { maxDecimals: 9, minDecimals: fixed ? 9 : 0 });
}

function aggregate(candles: Candle[], keep: number, group: number): Candle[] {
  const slice = candles.slice(Math.max(0, candles.length - keep));
  if (group <= 1) return slice;
  const out: Candle[] = [];
  for (let i = 0; i < slice.length; i += group) {
    const chunk = slice.slice(i, i + group);
    const first = chunk[0];
    const last = chunk[chunk.length - 1];
    if (!first || !last) continue;
    let h = first.h;
    let l = first.l;
    let v = 0n;
    for (const c of chunk) {
      if (c.h > h) h = c.h;
      if (c.l < l) l = c.l;
      v += c.v;
    }
    out.push({ t: first.t, o: first.o, h, l, c: last.c, v });
  }
  return out;
}

function clockLabel(unixSec: number): string {
  const d = new Date(unixSec * 1000);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function PriceChart({ candles }: { candles?: Candle[] }) {
  const [timeframe, setTimeframe] = useState<Timeframe>("24h");
  const gradientId = useId();
  const titleId = useId();

  const tf = TIMEFRAMES[timeframe];
  const series = useMemo(() => aggregate(candles ?? [], tf.keep, tf.group), [candles, tf.keep, tf.group]);

  const geometry = useMemo(() => {
    if (series.length < 2) return null;
    let lo = series[0]!.l;
    let hi = series[0]!.h;
    for (const c of series) {
      if (c.l < lo) lo = c.l;
      if (c.h > hi) hi = c.h;
    }
    // 4% headroom top and bottom so wicks never touch the frame.
    const pad = (hi - lo) / 25n || 1n;
    // A price axis must never label a negative price, so clamp the bottom pad.
    const min = pad > lo ? 0n : lo - pad;
    const max = hi + pad;
    const span = Number(max - min) || 1;
    const y = (v: bigint) => PAD_T + (1 - Number(v - min) / span) * PLOT_H;
    const slot = VB_W / series.length;
    const x = (i: number) => slot * (i + 0.5);
    return { min, max, y, x, slot, bodyW: slot * 0.58 };
  }, [series]);

  if (series.length < 2 || !geometry) {
    return (
      <div className="flex h-56 items-center justify-center rounded-sm border border-line-subtle bg-inset text-xs text-mute sm:h-72">
        No price history for this pool yet.
      </div>
    );
  }

  const { min, max, y, x, bodyW } = geometry;
  const last = series[series.length - 1]!;
  const first = series[0]!;
  const rising = last.c >= first.o;

  const closes = series.map((c, i) => ({ x: x(i), y: y(c.c) }));
  const linePath = closes.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(" ");
  const baseline = VB_H - PAD_B;
  const areaPath = `${linePath} L${closes[closes.length - 1]!.x.toFixed(2)},${baseline} L${closes[0]!.x.toFixed(2)},${baseline} Z`;

  const lastY = y(last.c);
  const lastPct = (lastY / VB_H) * 100;
  const lastXPct = (closes[closes.length - 1]!.x / VB_W) * 100;

  const ticks = Array.from({ length: TICKS + 1 }, (_, i) => ({
    value: max - ((max - min) * BigInt(i)) / BigInt(TICKS),
    pct: ((PAD_T + (PLOT_H * i) / TICKS) / VB_H) * 100,
  }));

  const xLabelIdx = [0, Math.floor(series.length / 3), Math.floor((series.length * 2) / 3), series.length - 1];

  return (
    <div className="space-y-2">
      {/* Last bucket OHLC + timeframe */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <dl className="flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs">
          {(
            [
              ["O", last.o],
              ["H", last.h],
              ["L", last.l],
              ["C", last.c],
            ] as const
          ).map(([k, v]) => (
            <div key={k} className="flex items-center gap-1">
              <dt className="text-mute">{k}</dt>
              <dd className={`num font-mono ${k === "C" ? (rising ? "text-green" : "text-red") : "text-dim"}`}>
                {formatPrice(v)}
              </dd>
            </div>
          ))}
          <div className="flex items-center gap-1">
            <dt className="text-mute">Bucket</dt>
            <dd className="num font-mono text-dim">{tf.bucket}</dd>
          </div>
        </dl>
        <Segmented
          ariaLabel="Chart timeframe"
          value={timeframe}
          onChange={(v) => setTimeframe(v)}
          options={[
            { value: "6h", label: "6H" },
            { value: "12h", label: "12H" },
            { value: "24h", label: "24H" },
          ]}
        />
      </div>

      {/* Plot + right price gutter */}
      <div className="flex">
        <div className="relative h-56 min-w-0 flex-1 sm:h-72">
          <svg
            viewBox={`0 0 ${VB_W} ${VB_H}`}
            preserveAspectRatio="none"
            className="size-full overflow-visible"
            role="img"
            aria-labelledby={titleId}
            data-testid="price-chart-svg"
          >
            <title id={titleId}>
              {`HWA price over the last ${timeframe}, ${tf.bucket} buckets. Low ${formatPrice(min)} HYPE, high ${formatPrice(max)} HYPE, last ${formatPrice(last.c)} HYPE.`}
            </title>
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--hwa-accent)" stopOpacity="0.28" />
                <stop offset="100%" stopColor="var(--hwa-accent)" stopOpacity="0" />
              </linearGradient>
            </defs>

            {/* Grid */}
            {ticks.map((t, i) => (
              <line
                key={i}
                x1={0}
                x2={VB_W}
                y1={(t.pct / 100) * VB_H}
                y2={(t.pct / 100) * VB_H}
                className="stroke-line-subtle"
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
            ))}

            {/* Mint area under the close series */}
            <path d={areaPath} fill={`url(#${gradientId})`} />
            <path
              d={linePath}
              fill="none"
              className="stroke-accent"
              strokeWidth={1.5}
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
              opacity={0.55}
            />

            {/* Candles */}
            {series.map((c, i) => {
              const up = c.c >= c.o;
              const cx = x(i);
              const top = Math.min(y(c.o), y(c.c));
              const height = Math.max(2, Math.abs(y(c.o) - y(c.c)));
              return (
                <g key={c.t} className={up ? "fill-green stroke-green" : "fill-red stroke-red"}>
                  <line
                    x1={cx}
                    x2={cx}
                    y1={y(c.h)}
                    y2={y(c.l)}
                    strokeWidth={1}
                    vectorEffect="non-scaling-stroke"
                  />
                  <rect x={cx - bodyW / 2} width={bodyW} y={top} height={height} />
                </g>
              );
            })}

            {/* Last price */}
            <line
              x1={0}
              x2={VB_W}
              y1={lastY}
              y2={lastY}
              className="stroke-accent"
              strokeWidth={1}
              strokeDasharray="4 4"
              vectorEffect="non-scaling-stroke"
              opacity={0.8}
            />
          </svg>

          {/* Marker as HTML: preserveAspectRatio="none" would squash an SVG circle. */}
          <span
            aria-hidden
            className="anim-pulse absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent"
            style={{ left: `${lastXPct}%`, top: `${lastPct}%` }}
          />

          {isMockMode && (
            <span className="absolute left-2 top-2 rounded-xs border border-amber/40 bg-amber/10 px-1.5 py-0.5 text-2xs font-semibold text-amber">
              SIMULATED SERIES — mock mode
            </span>
          )}
        </div>

        {/* Price axis */}
        <div className="relative h-56 w-20 shrink-0 sm:h-72" aria-hidden>
          {ticks.map((t, i) => (
            <span
              key={i}
              className="num absolute right-0 -translate-y-1/2 pl-1.5 font-mono text-2xs text-mute"
              style={{ top: `${t.pct}%` }}
            >
              {formatPrice(t.value, true)}
            </span>
          ))}
          <span
            className="num absolute right-0 -translate-y-1/2 rounded-xs bg-accent px-1 py-0.5 font-mono text-2xs font-semibold text-accent-fg"
            style={{ top: `${lastPct}%` }}
          >
            {formatPrice(last.c, true)}
          </span>
        </div>
      </div>

      {/* Time axis */}
      <div className="flex">
        <div className="flex min-w-0 flex-1 justify-between">
          {xLabelIdx.map((idx, i) => {
            const c = series[idx];
            if (!c) return null;
            return (
              <span key={i} className="num font-mono text-2xs text-mute">
                {clockLabel(c.t)}
              </span>
            );
          })}
        </div>
        <div className="w-20 shrink-0" />
      </div>

      <p className="text-2xs leading-snug text-mute">
        Price in HYPE per HWA, {tf.bucket} buckets from the Project X pool.
        {isMockMode ? " In mock mode this series is generated locally — it is not market data." : ""}
      </p>
    </div>
  );
}
