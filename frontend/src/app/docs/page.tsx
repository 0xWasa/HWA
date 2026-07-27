import { Suspense } from "react";
import { DocsScreen } from "@/components/docs/DocsScreen";

export default function DocsPage() {
  return (
    <Suspense>
      <DocsScreen />
    </Suspense>
  );
}
