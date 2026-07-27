import { Suspense } from "react";
import { DepositFlow } from "@/components/deposit/DepositFlow";

export default function DepositPage() {
  return (
    <Suspense>
      <DepositFlow />
    </Suspense>
  );
}
