"use client";

import { useId, useState, type ReactNode } from "react";

/**
 * Accessible inline explainer: click/focus toggles a small popover. Content is
 * never hover-only (mobile + a11y rule).
 */
export function InfoTip({ children, label = "More info" }: { children: ReactNode; label?: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <span className="relative inline-flex">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        aria-label={label}
        onClick={() => setOpen((o) => !o)}
        onBlur={(e) => {
          if (!e.currentTarget.parentElement?.contains(e.relatedTarget as Node)) setOpen(false);
        }}
        className={`grid size-3.5 place-items-center rounded-full border text-[9px] leading-none ${
          open ? "border-accent text-accent" : "border-line-strong text-mute hover:border-mute hover:text-dim"
        }`}
      >
        i
      </button>
      {open && (
        <span
          id={id}
          role="note"
          className="anim-fade-up absolute left-1/2 top-5 z-40 w-60 -translate-x-1/2 rounded-sm border border-line bg-elevated p-2 text-left text-2xs leading-snug text-dim"
          style={{ boxShadow: "var(--shadow-pop)" }}
        >
          {children}
        </span>
      )}
    </span>
  );
}
