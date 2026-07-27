import { Suspense } from "react";
import { TermsScreen } from "@/components/legal/TermsScreen";

export default function TermsPage() {
  return (
    <Suspense>
      <TermsScreen />
    </Suspense>
  );
}
