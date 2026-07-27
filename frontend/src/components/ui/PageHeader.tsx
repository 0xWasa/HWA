import type { ReactNode } from "react";

export function PageHeader({
  eyebrow,
  title,
  description,
  action,
  meta,
}: {
  eyebrow: string;
  title: string;
  description: string;
  action?: ReactNode;
  meta?: ReactNode;
}) {
  return (
    <div className="page-header group relative overflow-hidden rounded-xl border border-line bg-panel/80 px-4 py-4 sm:px-5 sm:py-5">
      <div aria-hidden className="grid-paper pointer-events-none absolute inset-0 opacity-40" />
      <div aria-hidden className="absolute -right-12 -top-20 size-48 rounded-full bg-secondary/16 blur-3xl" />
      <div className="relative flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3.5">
          <div aria-hidden className="page-header-mark mt-0.5 grid size-10 shrink-0 place-items-center rounded-lg border border-secondary/35 bg-secondary-deep/65">
            <span className="size-2.5 rotate-45 rounded-[3px] border border-accent bg-accent/20" />
          </div>
          <div className="min-w-0">
            <div className="mlabel mb-1.5 text-secondary-readable">{eyebrow}</div>
            <h1 className="text-xl font-semibold text-ink sm:text-2xl">{title}</h1>
            <p className="mt-1 max-w-2xl text-xs leading-relaxed text-mute sm:text-sm">{description}</p>
            {meta && <div className="mt-2 text-2xs text-faint">{meta}</div>}
          </div>
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
    </div>
  );
}
