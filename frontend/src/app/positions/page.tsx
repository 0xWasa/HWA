import { Suspense } from "react";
import { PositionsScreen } from "@/components/positions/PositionsScreen";

export default function PositionsPage() {
  return (
    <Suspense>
      <PositionsScreen />
    </Suspense>
  );
}
