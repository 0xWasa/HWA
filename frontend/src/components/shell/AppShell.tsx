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
      {/* pb clears the fixed ActivityTicker strip (h-9, lg only). */}
      <footer className="border-t border-line-subtle lg:pb-9">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-6 py-6 text-sm text-mute sm:flex-row sm:items-center sm:justify-between">
          <span className="font-display font-semibold text-dim">HWA</span>
          <nav aria-label="Footer" className="flex flex-wrap items-center gap-5">
            {FOOTER_LINKS.map((l) => (
              <Link key={l.href} href={l.href} className="hover:text-ink">
                {l.label}
              </Link>
            ))}
            <span className="num font-mono text-2xs text-mute">HyperEVM ≠ HyperCore · amounts in HYPE</span>
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
