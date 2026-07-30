"use client";

import { sanitizeLabel } from "@/lib/format";
import { collectionFloorConfig } from "@/lib/collectionFloors";
import type { CollectionInfo } from "@/protocol/types";

/**
 * The allowlist, shown as a shelf. A newcomer needs to know what they can
 * deposit before reading anything else, and the allowlist is on-chain truth:
 * this renders whatever the manifest whitelists, never a hardcoded list.
 * Thumbnails are self-hosted so the page never depends on a marketplace CDN.
 */
export function SupportedCollections({ collections }: { collections: CollectionInfo[] }) {
  const allowed = collections.filter((c) => c.whitelisted);
  if (allowed.length === 0) return null;

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
    </section>
  );
}
