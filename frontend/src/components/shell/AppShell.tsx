"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { TopBar } from "./TopBar";
import { ActivityTicker } from "./ActivityTicker";
import { EnvBanner } from "./EnvBanner";
import { TermsGate } from "@/components/legal/TermsGate";
import { RevealOverlay } from "@/components/tx/RevealOverlay";
import { TxDock } from "@/components/tx/TxDock";
import { DevPanel } from "@/components/dev/DevPanel";

const FOOTER_LINKS = [
  { href: "/activity", label: "Activity" },
  { href: "/docs", label: "Docs" },
  { href: "/terms", label: "Terms of Service" },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <TopBar />
      <EnvBanner />
      <main className="mx-auto w-full max-w-[1600px] flex-1">{children}</main>
      {/* pb clears the fixed ActivityTicker strip (h-9, lg only). Styled as a
          terminal status bar: mono, hairline, all facts static and honest. */}
      <footer className="border-t border-line-subtle lg:pb-9">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-3 px-6 py-4 font-mono text-2xs uppercase tracking-[0.08em] text-mute sm:flex-row sm:items-center sm:justify-between">
          <span className="flex items-center gap-2">
            <span aria-hidden className="size-1.5 rounded-full bg-chain" />
            <span className="font-display font-semibold normal-case tracking-normal text-dim">HWA</span>
            <span className="text-faint">· HyperEVM</span>
          </span>
          <nav aria-label="Footer" className="flex flex-wrap items-center gap-x-5 gap-y-2">
            {FOOTER_LINKS.map((l) => (
              <Link key={l.href} href={l.href} className="transition-colors hover:text-ink">
                {l.label}
              </Link>
            ))}
            <span className="num normal-case text-faint">HyperEVM ≠ HyperCore · amounts in HYPE</span>
          </nav>
        </div>
      </footer>
      <ActivityTicker />
      <TxDock />
      <RevealOverlay />
      <TermsGate />
      <DevPanel />
    </div>
  );
}
