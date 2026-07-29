import type { ReactNode } from "react";
import { PressureMotif } from "@/components/ui/PressureMotif";

export function EmptyState({
  title,
  detail,
  action,
  compact = false,
}: {
  title: string;
  detail?: string;
  action?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div className={`relative flex flex-col items-center justify-center gap-2 overflow-hidden text-center ${compact ? "py-8" : "py-16"}`}>
      <div aria-hidden className="absolute left-1/2 top-1/2 size-40 -translate-x-1/2 -translate-y-1/2 rounded-full bg-secondary/12 blur-3xl" />
      <PressureMotif
        tone="mist"
        wall={false}
        className="pointer-events-none absolute left-1/2 top-1/2 size-52 -translate-x-1/2 -translate-y-1/2 opacity-40"
      />
      <div aria-hidden className="relative grid size-12 place-items-center rounded-xl border border-line bg-inset shadow-lg">
        <div className="size-3.5 rotate-45 rounded-[4px] border border-accent/55 bg-secondary-deep" />
      </div>
      <div className="relative text-sm font-medium text-dim">{title}</div>
      {detail && <div className="relative max-w-sm text-xs leading-relaxed text-mute">{detail}</div>}
      {action && <div className="relative mt-2">{action}</div>}
    </div>
  );
}
