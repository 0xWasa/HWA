import { RARITY_COLOR, RARITY_LABEL, rarityFromOdds } from "@/protocol/rarity";
import { Tag } from "@/components/ui/Tag";

export function RarityTag({ weight, totalWeight }: { weight: bigint; totalWeight: bigint }) {
  const tier = rarityFromOdds(weight, totalWeight);
  return (
    <Tag color={RARITY_COLOR[tier]} title="Rarity band derived from live selection odds">
      {RARITY_LABEL[tier]}
    </Tag>
  );
}
