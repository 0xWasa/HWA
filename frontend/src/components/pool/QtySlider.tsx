"use client";

import { useRef } from "react";

/**
 * fwa.fun batch slider: h-11 bordered track with tappable steps and a sliding
 * thumb. Keyboard: arrows/home/end on the track (role=slider). Geometry is
 * computed from the track's own width (padding 1rem each side), so it stays
 * correct at any container size.
 */
export function QtySlider({
  value,
  max,
  onChange,
}: {
  value: number;
  max: number;
  onChange: (n: number) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);

  const fromPointer = (clientX: number) => {
    const el = trackRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    onChange(1 + Math.round(ratio * (max - 1)));
  };

  const ratio = max > 1 ? (value - 1) / (max - 1) : 0;
  // Thumb center: 1rem inset on both ends, linear in between.
  const posCalc = `calc(1rem + (100% - 2rem) * ${ratio})`;

  return (
    <div
      ref={trackRef}
      role="slider"
      aria-label="Select NFT batch size"
      aria-valuemin={1}
      aria-valuemax={max}
      aria-valuenow={value}
      tabIndex={0}
      data-testid="qty-slider"
      onKeyDown={(e) => {
        if (e.key === "ArrowRight" || e.key === "ArrowUp") onChange(Math.min(max, value + 1));
        else if (e.key === "ArrowLeft" || e.key === "ArrowDown") onChange(Math.max(1, value - 1));
        else if (e.key === "Home") onChange(1);
        else if (e.key === "End") onChange(max);
      }}
      onPointerDown={(e) => {
        // Capture on the track itself: a press starting on a step button must
        // still turn into a drag, and release position wins over the button.
        e.currentTarget.setPointerCapture?.(e.pointerId);
        fromPointer(e.clientX);
      }}
      onPointerMove={(e) => {
        if (e.buttons === 1) fromPointer(e.clientX);
      }}
      className="relative h-11 w-full touch-none select-none rounded-lg border border-line bg-inset"
    >
      {/* filled track — fades out before the thumb so no seam crosses the glow */}
      <div
        aria-hidden
        className="absolute inset-y-0 left-0 rounded-l-lg"
        style={{
          width: posCalc,
          background:
            "linear-gradient(to right, color-mix(in srgb, var(--hwa-accent) 12%, transparent) calc(100% - 20px), transparent)",
        }}
      />
      {/* step ticks */}
      <div className="absolute inset-x-4 top-1/2 flex -translate-y-1/2 items-center justify-between">
        {Array.from({ length: max }).map((_, i) => {
          const n = i + 1;
          const active = n <= value;
          return (
            <button
              key={n}
              type="button"
              tabIndex={-1}
              aria-label={`Set batch size to ${n}`}
              data-testid={`qty-${n}`}
              onClick={(e) => {
                e.stopPropagation();
                onChange(n);
              }}
              className={`z-10 grid size-6 place-items-center rounded-full text-2xs font-semibold transition-colors ${
                n === value ? "text-accent-fg" : active ? "text-accent" : "text-faint hover:text-mute"
              }`}
            >
              {n === value ? "" : n}
            </button>
          );
        })}
      </div>
      {/* thumb — springs into place; the number pops on every step change
          (keyed span retriggers the pop without breaking the left transition) */}
      <div
        aria-hidden
        className="absolute top-1/2 z-20 grid size-8 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-md bg-accent text-sm font-bold text-accent-fg transition-[left] duration-200 ease-(--ease-spring)"
        style={{
          left: posCalc,
          boxShadow: "0 6px 16px color-mix(in srgb, var(--hwa-accent) 35%, transparent)",
        }}
      >
        <span key={value} className="anim-step-pop">
          {value}
        </span>
      </div>
    </div>
  );
}
