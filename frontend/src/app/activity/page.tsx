import { Suspense } from "react";
import { ActivityScreen } from "@/components/activity/ActivityScreen";

export default function ActivityPage() {
  return (
    <Suspense>
      <ActivityScreen />
    </Suspense>
  );
}
