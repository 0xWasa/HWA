import type { Metadata } from "next";
import { Suspense } from "react";
import { LegacyPositionsScreen } from "@/components/legacy/LegacyPositionsScreen";

export const metadata: Metadata = {
  title: "Legacy recovery",
  description: "Recover NFTs and HYPE backing from the frozen HWA v1 pool.",
};

export default function LegacyPage() {
  return <Suspense><LegacyPositionsScreen /></Suspense>;
}
