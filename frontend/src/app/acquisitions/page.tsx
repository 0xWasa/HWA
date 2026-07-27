import { Suspense } from "react";
import { AcquisitionsScreen } from "@/components/acquisitions/AcquisitionsScreen";

export default function AcquisitionsPage() {
  return (
    <Suspense>
      <AcquisitionsScreen />
    </Suspense>
  );
}
