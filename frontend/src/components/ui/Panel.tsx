import type { ReactNode } from "react";

export function Panel({
  title,
  actions,
  children,
  className = "",
  padded = true,
}: {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return (
    <section className={`card ${className}`}>
      {(title !== undefined || actions !== undefined) && (
        <header className="flex h-11 items-center justify-between gap-2 border-b border-line-subtle px-4">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-mute">{title}</h2>
          {actions && <div className="flex items-center gap-1.5">{actions}</div>}
        </header>
      )}
      <div className={padded ? "p-4" : ""}>{children}</div>
    </section>
  );
}

/** Label/value pair for dense stat strips. Values are tabular mono. */
export function Stat({
  label,
  value,
  sub,
  tone = "ink",
  align = "left",
}: {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  tone?: "ink" | "accent" | "dim" | "red" | "amber";
  align?: "left" | "right";
}) {
  const tones = { ink: "text-ink", accent: "text-accent", dim: "text-dim", red: "text-red", amber: "text-amber" };
  return (
    <div className={`min-w-0 ${align === "right" ? "text-right" : ""}`}>
      <div className="truncate text-2xs uppercase tracking-wide text-mute">{label}</div>
      <div className={`num truncate font-mono text-sm ${tones[tone]}`}>{value}</div>
      {/* `sub` carries information (rates, epochs, countdowns) — it stays at
          text-mute so 10px copy keeps enough contrast. */}
      {sub !== undefined && <div className="truncate text-2xs text-mute">{sub}</div>}
    </div>
  );
}

export function Divider({ className = "" }: { className?: string }) {
  return <hr className={`border-0 border-t border-line-subtle ${className}`} />;
}
