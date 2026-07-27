"use client";

import { useEffect, useState } from "react";
import { formatHype, parseHype } from "@/lib/units";

/**
 * HYPE amount input. The typed string is the source of truth; the parsed
 * bigint (wei) is emitted on every valid change, null when invalid. No floats.
 */
export function AmountInput({
  value,
  onChange,
  max,
  placeholder = "0.00",
  label,
  id,
  autoFocus,
}: {
  value: bigint | null;
  onChange: (wei: bigint | null) => void;
  /** Optional balance cap — renders a MAX button. */
  max?: bigint;
  placeholder?: string;
  label: string;
  id: string;
  autoFocus?: boolean;
}) {
  const [text, setText] = useState(value !== null ? formatHype(value, { maxDecimals: 18 }) : "");

  // Keep local text in sync when the parent resets the value (e.g. MAX).
  useEffect(() => {
    if (value === null) return;
    const parsed = parseHype(text);
    if (parsed !== value) setText(formatHype(value, { maxDecimals: 18 }).replace(/ /g, ""));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <div className="flex h-ctl-lg items-center gap-2 rounded-sm border border-line bg-inset px-2.5 focus-within:border-accent/60">
      <input
        id={id}
        aria-label={label}
        inputMode="decimal"
        autoComplete="off"
        autoFocus={autoFocus}
        placeholder={placeholder}
        value={text}
        onChange={(e) => {
          const t = e.target.value;
          setText(t);
          onChange(t.trim() === "" ? null : parseHype(t));
        }}
        className="num min-w-0 flex-1 bg-transparent font-mono text-base text-ink outline-none placeholder:text-faint"
      />
      <span className="text-xs font-medium text-mute">HYPE</span>
      {max !== undefined && (
        <button
          type="button"
          onClick={() => {
            onChange(max);
            setText(formatHype(max, { maxDecimals: 18 }).replace(/ /g, ""));
          }}
          className="rounded-xs bg-control px-1.5 py-0.5 text-2xs font-semibold text-accent hover:bg-hover"
        >
          MAX
        </button>
      )}
    </div>
  );
}
