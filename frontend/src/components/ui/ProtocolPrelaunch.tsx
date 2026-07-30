import type { ReactNode } from "react";
import { PressureMotif } from "@/components/ui/PressureMotif";

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
      {/* The dormant Genesis pressure field: rings held against the launch
          wall until the mainnet manifest is published. Pure geometry. */}
      <PressureMotif
        tone="amber"
        wallLabel="LAUNCH WALL"
        className={`pointer-events-none absolute left-1/2 top-[38%] -translate-x-1/2 -translate-y-1/2 opacity-45 ${
          compact ? "size-[22rem]" : "size-[30rem]"
        }`}
      />
      <span aria-hidden className="stamp stamp--amber stamp--tilt-r absolute right-4 top-4">
        Locked
      </span>

      <div className="relative mx-auto flex max-w-2xl flex-col items-center text-center">
        <span className="mlabel inline-flex items-center gap-2 rounded-full border border-amber/30 bg-amber/8 px-3 py-1.5 text-amber">
          <span aria-hidden className="size-1.5 rounded-full bg-amber" />
          MAINNET STAGING
        </span>
        <div className="mt-6 grid size-20 place-items-center rounded-[1.4rem] border border-accent/35 bg-bg/90 font-display text-2xl font-extrabold tracking-[-0.08em] text-accent shadow-[0_18px_55px_rgba(0,0,0,.42),0_0_35px_color-mix(in_srgb,var(--hwa-accent)_18%,transparent)]">
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
    <div className="rounded-data border border-line bg-bg/75 px-3 py-2.5">
      <div className="mlabel text-faint">{label}</div>
      <div className={`mt-1 font-mono text-xs font-semibold ${tone}`}>{value}</div>
    </div>
  );
}
