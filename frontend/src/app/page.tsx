import { Suspense } from "react";
import { PoolScreen } from "@/components/pool/PoolScreen";

export default function PoolPage() {
  return (
    <Suspense>
      <PoolScreen />
    </Suspense>
  );
}
