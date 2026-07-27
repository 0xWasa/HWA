import { Suspense } from "react";
import { TokenScreen } from "@/components/token/TokenScreen";

export default function TokenPage() {
  return (
    <Suspense>
      <TokenScreen />
    </Suspense>
  );
}
