"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { env } from "@/config/env";
import { chainLabel } from "@/config/chains";
import { useConnectionHealth } from "@/state/queries";
import { useProtocol } from "@/protocol/provider";
import { Button } from "@/components/ui/Button";
import { ThemeToggle } from "./ThemeToggle";
import { WalletButton } from "./WalletButton";

const NAV = [
  { href: "/", label: "Pool" },
  { href: "/token", label: "$HWA" },
  { href: "/acquisitions", label: "Acquisitions" },
  { href: "/positions", label: "Manage" },
  { href: "/activity", label: "Activity" },
  { href: "/rewards", label: "Rewards" },
] as const;

/**
 * Floating capsule navbar: wordmark + routes in one pill on the left, status
 * and wallet on the right — the bar hovers over the page rather than sitting
 * on a hard edge.
 */
export function TopBar() {
  const pathname = usePathname();
  const { prelaunch } = useProtocol();
  const { data: health } = useConnectionHealth();

  const sync = (() => {
    if (prelaunch) return { dot: "bg-amber", label: "Pre-launch", tone: "text-amber" };
    if (!health) return { dot: "bg-mute", label: "Syncing…", tone: "text-mute" };
    if (health.rpc === "down") return { dot: "bg-red", label: "RPC down", tone: "text-red" };
    if (health.indexer.status === "down")
      return { dot: "bg-amber", label: "History delayed", tone: "text-amber" };
    if (health.indexer.status === "lagging")
      return { dot: "bg-amber", label: `−${health.indexer.lagBlocks} blocks`, tone: "text-amber" };
    return { dot: "bg-green", label: "Synced", tone: "text-mute" };
  })();

  return (
    <header className="sticky top-0 z-40 px-3 pb-2 pt-3 sm:px-5">
      {/* Scrim: the bar floats, so page content must fade out beneath it
          instead of colliding with the capsules. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[calc(100%+1.5rem)] bg-gradient-to-b from-bg via-bg/92 to-transparent"
      />
      <div className="mx-auto flex w-full max-w-[1600px] items-center gap-2 sm:gap-3">
        {/* left capsule: brand + routes */}
        <div className="capsule flex min-w-0 items-center gap-1 p-1.5 sm:flex-1 xl:flex-none">
          <Link
            href="/"
            className="flex shrink-0 items-center gap-2 rounded-xl px-1.5 py-1"
            aria-label="HWA — home"
          >
            <span aria-hidden className="logo-squish grid h-8 w-[66px] shrink-0 place-items-center">
              <Image
                src="/brand/hwa-wordmark.png"
                alt=""
                width={132}
                height={58}
                priority
                className="h-8 w-auto object-contain drop-shadow-[0_5px_12px_color-mix(in_srgb,var(--hwa-accent)_22%,transparent)]"
              />
            </span>
          </Link>

          <MainNav pathname={pathname} className="hidden sm:flex" />
        </div>

        <div className="flex flex-1 items-center justify-end gap-2 sm:gap-3">
          {/* status capsule */}
          <div className="capsule hidden items-center gap-2.5 px-3 py-2 xl:flex">
            <span className={`flex items-center gap-1.5 text-2xs ${sync.tone}`}>
              <span aria-hidden className={`relative size-1.5 rounded-full ${sync.dot}`} />
              {sync.label}
            </span>
            <span aria-hidden className="h-3 w-px bg-line" />
            <span
              className={`mlabel ${env.chainId === 998 ? "text-amber" : "text-chain"}`}
              title="This app talks to HyperEVM only — not HyperCore."
            >
              {chainLabel(env.chainId)}
            </span>
          </div>

          <div className="capsule flex items-center gap-1.5 p-1.5">
            <ThemeToggle />
            <Link href="/deposit" className="hidden sm:block">
              <Button variant="violet" size="ctl" className="rounded-xl">
                Deposit
              </Button>
            </Link>
            <WalletButton />
          </div>
        </div>
      </div>

      {/* Mobile gets a full-width market navigation row: no clipped labels,
          and every destination remains one horizontal swipe away. */}
      <div className="mx-auto mt-2 w-full max-w-[1600px] sm:hidden">
        <MainNav pathname={pathname} className="capsule flex px-1.5 py-1" mobile />
      </div>
    </header>
  );
}

function MainNav({
  pathname,
  className,
  mobile = false,
}: {
  pathname: string;
  className: string;
  mobile?: boolean;
}) {
  return (
    <nav
      aria-label={mobile ? "Main mobile" : "Main"}
      className={`${className} min-w-0 items-center gap-0.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden`}
    >
      {NAV.map((item) => {
        const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`relative shrink-0 whitespace-nowrap rounded-xl px-3 py-2 text-sm font-semibold transition-all ${
              active
                ? "bg-secondary-deep text-ink shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--hwa-secondary)_28%,transparent)]"
                : "text-mute hover:bg-control/60 hover:text-dim"
            }`}
          >
            {item.label}
            {active && (
              <span
                aria-hidden
                className="absolute inset-x-3 -bottom-0.5 h-px rounded-full bg-accent shadow-[0_0_8px_var(--hwa-accent)]"
              />
            )}
          </Link>
        );
      })}
    </nav>
  );
}
