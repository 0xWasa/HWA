import type { CSSProperties, ReactNode } from "react";

type Tone = "neutral" | "accent" | "red" | "amber" | "blue" | "custom";

const tones: Record<Exclude<Tone, "custom">, string> = {
  neutral: "bg-control text-dim",
  accent: "bg-accent/12 text-accent",
  red: "bg-red/12 text-red",
  amber: "bg-amber/12 text-amber",
  blue: "bg-blue/12 text-blue",
};

export function Tag({
  tone = "neutral",
  color,
  children,
  className = "",
  title,
}: {
  tone?: Tone;
  /** For rarity colors — pass a CSS color, rendered as tinted chip. */
  color?: string;
  children: ReactNode;
  className?: string;
  title?: string;
}) {
  const style: CSSProperties | undefined = color
    ? { color, backgroundColor: "color-mix(in srgb, " + color + " 13%, transparent)" }
    : undefined;
  return (
    <span
      title={title}
      style={style}
      className={`inline-flex h-[18px] items-center gap-1 rounded-xs px-1.5 text-2xs font-medium leading-none ${
        color ? "" : tones[tone as Exclude<Tone, "custom">] ?? tones.neutral
      } ${className}`}
    >
      {children}
    </span>
  );
}

/** Small dot + label status indicator. */
export function StatusDot({ tone, label }: { tone: "accent" | "red" | "amber" | "neutral"; label: string }) {
  const colors = { accent: "bg-accent", red: "bg-red", amber: "bg-amber", neutral: "bg-mute" };
  return (
    <span className="inline-flex items-center gap-1.5 text-2xs text-dim">
      <span aria-hidden className={`size-1.5 rounded-full ${colors[tone]}`} />
      {label}
    </span>
  );
}
