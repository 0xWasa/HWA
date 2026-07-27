import { Suspense } from "react";
import { RewardsScreen } from "@/components/rewards/RewardsScreen";

export default function RewardsPage() {
  return (
    <Suspense>
      <RewardsScreen />
    </Suspense>
  );
}
