import type { Address } from "@/protocol/types";

export type CollectionFloorSource = "opensea" | "seed-reference" | "unavailable";

export interface CollectionFloorQuote {
  collection: Address;
  floorHype: string | null;
  source: CollectionFloorSource;
  sourceLabel: string;
  observedAt: string;
  stale: boolean;
  marketplaceUrl?: string;
}

type CollectionFloorConfig = {
  slug?: string;
  marketplaceUrl?: string;
  /** Used only when no market exists. It is never presented as a live floor. */
  seedReferenceHype?: string;
};

const COLLECTION_FLOORS: Record<string, CollectionFloorConfig> = {
  "0x63eb9d77d083ca10c304e28d5191321977fd0bfb": {
    slug: "hypio",
    marketplaceUrl: "https://opensea.io/collection/hypio",
  },
  "0xbc4a26ba78ce05e8bcbf069bbb87fb3e1dac8df8": {
    slug: "pip-friends",
    marketplaceUrl: "https://opensea.io/collection/pip-friends",
  },
  "0x43a9652e2b3ce8970e8d33d8c34252a59a6596aa": {
    slug: "odd-otties-hyperevm",
    marketplaceUrl: "https://opensea.io/collection/odd-otties-hyperevm",
  },
  "0x9125e2d6827a00b0f8330d6ef7bef07730bac685": {
    slug: "hypurr-hyperevm",
    marketplaceUrl: "https://opensea.io/collection/hypurr-hyperevm",
  },
  "0x89d52133b105e9548df16de4d7cf59c412daf191": {
    seedReferenceHype: "0.25",
  },
};

export function collectionFloorConfig(collection: string): CollectionFloorConfig | undefined {
  return COLLECTION_FLOORS[collection.toLowerCase()];
}

export function collectionFloorApiPath(collection: string): string {
  return `/api/collection-floor?collection=${encodeURIComponent(collection.toLowerCase())}`;
}

export function marketValueAtRisk(backing: bigint | null, floor: bigint | null): bigint | null {
  if (backing === null || floor === null) return null;
  return floor > backing ? floor - backing : 0n;
}
