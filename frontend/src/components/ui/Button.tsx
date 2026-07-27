"use client";

import { forwardRef, type ButtonHTMLAttributes } from "react";

/**
 * fwa.fun-style pressable buttons: 1px border with a 4px bottom edge and a
 * colored glow; the button physically presses down on :active (see .btn3d in
 * globals.css). `outline` uses the flat connected-wallet styling (no glow/press).
 */
type Variant = "primary" | "violet" | "secondary" | "ghost" | "danger" | "outline";
type Size = "ctl" | "lg" | "xs";

const base =
  "inline-flex items-center justify-center gap-1.5 select-none whitespace-nowrap font-medium disabled:cursor-not-allowed disabled:opacity-60";

const variants: Record<Variant, string> = {
  primary: "btn3d btn3d--primary",
  violet: "btn3d btn3d--violet",
  secondary: "btn3d",
  danger: "btn3d btn3d--danger",
  outline: "btn3d btn3d--flat bg-transparent! text-accent [--btn-edge:var(--hwa-accent)]",
  ghost:
    "rounded-md bg-transparent text-mute transition-colors duration-150 hover:bg-control hover:text-ink",
};

const sizes: Record<Size, string> = {
  xs: "h-6 rounded-sm px-2 text-2xs",
  ctl: "h-ctl px-3 text-sm",
  lg: "h-ctl-lg rounded-lg px-5 text-xs font-semibold",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "ctl", loading = false, className = "", children, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      className={`${base} ${variants[variant]} ${sizes[size]} ${className}`}
      disabled={disabled || loading}
      {...rest}
    >
      {loading && (
        <span
          aria-hidden
          className="inline-block size-3 animate-spin rounded-full border-[1.5px] border-current border-t-transparent"
        />
      )}
      {children}
    </button>
  );
});
