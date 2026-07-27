import { formatHype } from "@/lib/units";

/** Canonical HYPE amount rendering — mono, tabular, explicit unit. */
export function Hype({
  wei,
  maxDecimals = 4,
  className = "",
  signed = false,
  unit = true,
}: {
  wei: bigint;
  maxDecimals?: number;
  className?: string;
  signed?: boolean;
  unit?: boolean;
}) {
  return (
    <span className={`num font-mono ${className}`}>
      {formatHype(wei, { maxDecimals, sign: signed })}
      {unit && <span className="ml-1 text-[0.85em] text-mute">HYPE</span>}
    </span>
  );
}
