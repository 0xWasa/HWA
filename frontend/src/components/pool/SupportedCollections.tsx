"use client";

import Link from "next/link";
import { sanitizeLabel } from "@/lib/format";
import { collectionFloorConfig } from "@/lib/collectionFloors";
import { HWA_NFT_DEPOSITS_PAUSED } from "@/config/featureFlags";
import { Button } from "@/components/ui/Button";
import type { CollectionInfo } from "@/protocol/types";

const SECONDS_PER_DAY = 86_400n;

/** Rounded to the nearest readable unit: the emission budget is a headline
 *  figure, not an accounting number, and the exact wei is on /rewards. */
function compactTokens(wei: bigint): string {
  const whole = Number(wei / 10n ** 18n);
  if (whole >= 1_000_000) return `${trim(whole / 1_000_000)}M`;
  if (whole >= 1_000) return `${trim(whole / 1_000)}K`;
  return trim(whole);
}

function trim(n: number): string {
  return n.toFixed(1).replace(/\.0$/, "");
}

/**
 * The allowlist, shown as a shelf. A newcomer needs to know what they can
 * deposit before reading anything else, and the allowlist is on-chain truth:
 * this renders whatever the manifest whitelists, never a hardcoded list.
 * Thumbnails are self-hosted so the page never depends on a marketplace CDN.
 */
export function SupportedCollections({
  collections,
  depositorRatePerSec,
}: {
  collections: CollectionInfo[];
  /** Live emission rate. The daily figure is omitted rather than guessed when
   *  the rewards module has not reported one. */
  depositorRatePerSec?: bigint;
}) {
  const allowed = collections.filter((c) => c.whitelisted);
  if (allowed.length === 0) return null;

  const daily =
    depositorRatePerSec !== undefined && depositorRatePerSec > 0n
      ? compactTokens(depositorRatePerSec * SECONDS_PER_DAY)
      : null;

  return (
    <section className="flex flex-col gap-3" data-testid="supported-collections">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-xl font-semibold text-ink">Collections you can deposit</h2>
        <span className="mlabel text-faint">{allowed.length} allowlisted</span>
      </div>

      <div className="deck-tilt grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {allowed.map((collection) => {
          const config = collectionFloorConfig(collection.address);
          const name = sanitizeLabel(collection.name, "Unknown collection");
          const body = (
            <>
              <span className="relative block aspect-square overflow-hidden rounded-t-[inherit] bg-inset">
                {config?.image ? (
                  // Static, self-hosted, already sized: the plain tag avoids a
                  // loader round-trip for a 5 KB thumbnail.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={config.image}
                    alt=""
                    loading="lazy"
                    className="size-full object-cover transition-transform duration-300 ease-(--ease-swift) group-hover:scale-[1.06]"
                  />
                ) : (
                  <span className="nft-fallback grid size-full place-items-center">
                    <span className="mlabel text-faint">{collection.symbol ?? "NFT"}</span>
                  </span>
                )}
              </span>
              <span className="block px-2.5 py-2">
                <span className="block truncate text-sm font-semibold text-ink">{name}</span>
                <span className="mlabel block truncate text-faint">
                  {config?.marketplaceUrl ? "View on OpenSea →" : "HWA native"}
                </span>
              </span>
            </>
          );

          return config?.marketplaceUrl ? (
            <a
              key={collection.address}
              href={config.marketplaceUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="card group overflow-hidden rounded-lg no-underline"
            >
              {body}
            </a>
          ) : (
            <div key={collection.address} className="card group overflow-hidden rounded-lg">
              {body}
            </div>
          );
        })}
      </div>

      {/* The shelf answers "what can I deposit"; this answers "why would I".
          The link is unconditional in the open case because /deposit owns the
          fail-closed gate, but the label must not promise a flow that is shut. */}
      <div
        className="flex flex-col gap-3 rounded-xl border border-accent/30 bg-accent/8 p-4 sm:flex-row sm:items-center sm:justify-between sm:gap-5"
        data-testid="deposit-cta"
      >
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-ink">Deposit an NFT, earn $HWA</h3>
          <p className="mt-1 text-sm text-mute">
            {daily ? `${daily} $HWA a day is` : "$HWA is"} split across every active deposit, weighted by the
            square root of its HYPE backing. Smaller deposits earn more per HYPE.
          </p>
        </div>
        {HWA_NFT_DEPOSITS_PAUSED ? (
          <Button variant="primary" size="lg" className="shrink-0" disabled>
            Deposits paused
          </Button>
        ) : (
          <Link href="/deposit" className="shrink-0 no-underline">
            <Button variant="primary" size="lg" className="w-full sm:w-auto">
              Deposit an NFT
            </Button>
          </Link>
        )}
      </div>
    </section>
  );
}
