import type { ReactNode } from "react";

export function ProtocolPrelaunch({
  title,
  detail,
  children,
  compact = false,
}: {
  title: string;
  detail: string;
  children?: ReactNode;
  compact?: boolean;
}) {
  return (
    <section
      className={`prelaunch-panel relative isolate overflow-hidden rounded-xl border border-accent/25 bg-panel ${
        compact ? "px-4 py-8" : "px-5 py-12 sm:px-8 sm:py-16"
      }`}
      data-testid="protocol-prelaunch"
    >
      <div aria-hidden className="grid-paper pointer-events-none absolute inset-0 opacity-60" />
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-1/2 size-[28rem] -translate-x-1/2 -translate-y-1/2 rounded-full border border-accent/10 shadow-[0_0_90px_color-mix(in_srgb,var(--hwa-accent)_12%,transparent)]"
      />
      <div aria-hidden className="pointer-events-none absolute inset-x-[12%] top-1/2 h-px bg-accent/25" />

      <div className="relative mx-auto flex max-w-2xl flex-col items-center text-center">
        <span className="mlabel inline-flex items-center gap-2 rounded-full border border-amber/30 bg-amber/8 px-3 py-1.5 text-amber">
          <span aria-hidden className="size-1.5 rounded-full bg-amber" />
          MAINNET STAGING
        </span>
        <div className="mt-6 grid size-20 place-items-center rounded-[1.4rem] border border-accent/35 bg-bg/90 font-display text-2xl font-black tracking-[-0.08em] text-accent shadow-[0_18px_55px_rgba(0,0,0,.42),0_0_35px_color-mix(in_srgb,var(--hwa-accent)_18%,transparent)]">
          HWA
        </div>
        <h2 className="mt-6 text-2xl font-semibold tracking-tight text-ink sm:text-3xl">{title}</h2>
        <p className="mt-3 max-w-xl text-sm leading-relaxed text-mute">{detail}</p>

        <div className="mt-7 grid w-full max-w-xl grid-cols-1 gap-2 text-left sm:grid-cols-3">
          <PrelaunchDatum label="NETWORK" value="HyperEVM · 999" />
          <PrelaunchDatum label="CONTRACTS" value="Not published" />
          <PrelaunchDatum label="TRANSACTIONS" value="Locked" tone="text-amber" />
        </div>
        {children && <div className="mt-6">{children}</div>}
      </div>
    </section>
  );
}

function PrelaunchDatum({ label, value, tone = "text-dim" }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-lg border border-line bg-bg/75 px-3 py-2.5">
      <div className="mlabel text-faint">{label}</div>
      <div className={`mt-1 font-mono text-xs font-semibold ${tone}`}>{value}</div>
    </div>
  );
}
