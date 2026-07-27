"use client";

import { useRef } from "react";

/**
 * fwa.fun segment control (.segment) with a correct radiogroup pattern:
 * roving tabindex (only the checked item is tabbable) and Left/Right/Home/End
 * move both focus and selection.
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  fullWidth = false,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  ariaLabel: string;
  fullWidth?: boolean;
}) {
  const rootRef = useRef<HTMLDivElement>(null);

  const move = (delta: number | "home" | "end") => {
    const idx = options.findIndex((o) => o.value === value);
    const next =
      delta === "home"
        ? 0
        : delta === "end"
          ? options.length - 1
          : (idx + delta + options.length) % options.length;
    const target = options[next];
    if (!target) return;
    onChange(target.value);
    // Focus follows selection (roving tabindex)
    rootRef.current?.querySelectorAll<HTMLButtonElement>("[role=radio]")[next]?.focus();
  };

  return (
    <div
      ref={rootRef}
      role="radiogroup"
      aria-label={ariaLabel}
      className={`segment ${fullWidth ? "flex w-full" : ""}`}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight" || e.key === "ArrowDown") {
          e.preventDefault();
          move(1);
        } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
          e.preventDefault();
          move(-1);
        } else if (e.key === "Home") {
          e.preventDefault();
          move("home");
        } else if (e.key === "End") {
          e.preventDefault();
          move("end");
        }
      }}
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(o.value)}
            className={`segment__item ${fullWidth ? "flex-1 text-center" : ""}`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
