/**
 * Decorative Genesis "Pressure Field" motif — nested contour rings pressed
 * against a straight liquidation wall, echoing the approved HWA Genesis v3
 * collection. Pure geometry: aria-hidden, deterministic (fixed constants,
 * computed once at module load), never renders numbers or fake data.
 */

const TAU = Math.PI * 2;
const SIZE = 240;
const CX = 120;
const CY = 112;
const MAX_R = 88;
const WALL_DIST = 68;
const RING_COUNT = 6;
const SAMPLES = 96;

function softplus(x: number): number {
  if (x > 30) return x;
  if (x < -30) return 0;
  return Math.log1p(Math.exp(x));
}

function ringPath(index: number): string {
  const t = (index + 1) / RING_COUNT;
  const baseR = MAX_R * Math.pow(t, 0.92);
  const k = MAX_R * 0.06;
  const gap = 6 + (RING_COUNT - 1 - index) * 4;
  const limit = WALL_DIST - gap;
  const pts: Array<[number, number]> = [];
  for (let i = 0; i < SAMPLES; i += 1) {
    const th = (i / SAMPLES) * TAU;
    const wob =
      1 +
      0.055 *
        (0.35 + 0.65 * t) *
        (Math.sin(2 * th + 0.8) + 0.55 * Math.sin(5 * th + 2.1) + 0.3 * Math.sin(7 * th + 4.4));
    const r = baseR * wob;
    const x = r * Math.cos(th);
    let y = r * Math.sin(th);
    y = y - k * softplus((y - limit) / k);
    pts.push([CX + x, CY + y]);
  }
  const f = (v: number) => (Math.round(v * 10) / 10).toString();
  const at = (i: number): [number, number] => pts[((i % SAMPLES) + SAMPLES) % SAMPLES]!;
  let d = `M ${f(at(0)[0])} ${f(at(0)[1])}`;
  for (let i = 0; i < pts.length; i += 1) {
    const p0 = at(i - 1);
    const p1 = at(i);
    const p2 = at(i + 1);
    const p3 = at(i + 2);
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6] as const;
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6] as const;
    d += ` C ${f(c1[0])} ${f(c1[1])} ${f(c2[0])} ${f(c2[1])} ${f(p2[0])} ${f(p2[1])}`;
  }
  return `${d} Z`;
}

const RING_PATHS = Array.from({ length: RING_COUNT }, (_, i) => ringPath(i));
const WALL_Y = CY + WALL_DIST;

const TONE_VAR: Record<string, string> = {
  accent: "var(--hwa-accent)",
  violet: "var(--hwa-secondary-readable)",
  amber: "var(--hwa-warning)",
  mist: "var(--hwa-muted)",
  chain: "var(--hwa-chain)",
};

export function PressureMotif({
  tone = "accent",
  wall = true,
  className = "",
  wallLabel,
}: {
  tone?: "accent" | "violet" | "amber" | "mist" | "chain";
  wall?: boolean;
  className?: string;
  wallLabel?: string;
}) {
  const ink = TONE_VAR[tone];
  return (
    <svg
      aria-hidden
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      className={className}
      fill="none"
      style={{ color: ink }}
    >
      {RING_PATHS.map((d, i) => {
        const tt = 1 - (i + 1) / RING_COUNT;
        return (
          <path
            key={d.slice(0, 24)}
            d={d}
            stroke="currentColor"
            strokeOpacity={0.16 + tt * 0.4}
            strokeWidth={0.9 + tt * 0.9}
          />
        );
      })}
      {wall && (
        <>
          <line
            x1={8}
            y1={WALL_Y}
            x2={SIZE - 8}
            y2={WALL_Y}
            stroke="currentColor"
            strokeOpacity={0.55}
            strokeWidth={1.4}
          />
          {[0.18, 0.38, 0.62, 0.82].map((p) => (
            <line
              key={p}
              x1={8 + (SIZE - 16) * p}
              y1={WALL_Y}
              x2={8 + (SIZE - 16) * p}
              y2={WALL_Y + 5}
              stroke="currentColor"
              strokeOpacity={0.3}
              strokeWidth={1}
            />
          ))}
          {wallLabel && (
            <text
              x={SIZE - 10}
              y={WALL_Y + 16}
              textAnchor="end"
              fill="currentColor"
              fillOpacity={0.55}
              fontSize={8}
              letterSpacing={2}
              fontFamily="var(--font-mono)"
            >
              {wallLabel}
            </text>
          )}
        </>
      )}
      <circle cx={CX} cy={CY} r={3.4} fill="currentColor" fillOpacity={0.75} />
      <circle cx={CX} cy={CY} r={7.5} stroke="currentColor" strokeOpacity={0.4} strokeWidth={1} />
    </svg>
  );
}
