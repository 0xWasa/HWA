import { describe, expect, it } from "vitest";
import { collectionFloorConfig, marketValueAtRisk } from "./collectionFloors";

describe("collection floor references", () => {
  it("maps reviewed HyperEVM collections to fixed OpenSea slugs", () => {
    expect(collectionFloorConfig("0x63EB9D77D083CA10C304E28D5191321977FD0BFB")?.slug).toBe("hypio");
    expect(collectionFloorConfig("0xbc4a26ba78ce05e8bcbf069bbb87fb3e1dac8df8")?.slug).toBe("pip-friends");
    expect(collectionFloorConfig("0xCC3D60fF11a268606C6a57bD6Db74b4208f1D30c")?.slug).toBe(
      "tiny-hyper-cats-hyperevm",
    );
    expect(collectionFloorConfig("0x822C4F30414299E003EF39E9ABA49D8F8D4445BA")?.slug).toBe("rekt-wolves-hype");
  });

  it("does not treat an unknown collection as a fetchable destination", () => {
    expect(collectionFloorConfig("0x0000000000000000000000000000000000000001")).toBeUndefined();
  });

  it("computes only downside below the observed floor", () => {
    expect(marketValueAtRisk(250n, 2_000n)).toBe(1_750n);
    expect(marketValueAtRisk(2_000n, 2_000n)).toBe(0n);
    expect(marketValueAtRisk(3_000n, 2_000n)).toBe(0n);
    expect(marketValueAtRisk(null, 2_000n)).toBeNull();
  });
});

