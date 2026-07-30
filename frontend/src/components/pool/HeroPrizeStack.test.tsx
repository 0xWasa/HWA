import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import type { PoolSnapshot } from "@/protocol/types";
import { HeroPrizeStack } from "./HeroPrizeStack";

function snapshot(activeListingCount: number): PoolSnapshot {
  return { activeListingCount } as PoolSnapshot;
}

describe("HeroPrizeStack loading truthfulness", () => {
  it("keeps a loading shell when pool state arrives before active listings", () => {
    const markup = renderToStaticMarkup(
      <HeroPrizeStack listings={[]} snapshot={snapshot(93)} onOpen={() => undefined} />,
    );

    expect(markup).toContain("skeleton");
    expect(markup).not.toContain("No active NFT positions.");
  });

  it("shows the empty state only after the chain confirms zero active listings", () => {
    const markup = renderToStaticMarkup(
      <HeroPrizeStack listings={[]} snapshot={snapshot(0)} onOpen={() => undefined} />,
    );

    expect(markup).toContain("No active NFT positions.");
    expect(markup).not.toContain("The pool starts with one NFT.");
  });
});