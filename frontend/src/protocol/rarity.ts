import type { RarityTier } from "./types";

/**
 * Display-only rarity derived from live selection odds, matching the docs'
 * framing: lightly-backed positions are common, heavily-backed ones are rare.
 * Buckets are "1 in N" selection odds. Never used in transaction parameters.
 */
export function rarityFromOdds(weight: bigint, totalWeight: bigint): RarityTier {
  if (weight <= 0n || totalWeight <= 0n) return "common";
  const oneIn = totalWeight / weight; // floor
  if (oneIn <= 15n) return "common";
  if (oneIn <= 40n) return "uncommon";
  if (oneIn <= 150n) return "rare";
  if (oneIn <= 600n) return "epic";
  return "grail";
}

export const RARITY_ORDER: RarityTier[] = ["common", "uncommon", "rare", "epic", "grail"];

export const RARITY_LABEL: Record<RarityTier, string> = {
  common: "Common",
  uncommon: "Uncommon",
  rare: "Rare",
  epic: "Epic",
  grail: "Grail",
};

/** Token color per tier — secondary, contained (see DESIGN_SYSTEM.md). */
export const RARITY_COLOR: Record<RarityTier, string> = {
  common: "var(--color-r-common)",
  uncommon: "var(--color-r-uncommon)",
  rare: "var(--color-r-rare)",
  epic: "var(--color-r-epic)",
  grail: "var(--color-r-grail)",
};
