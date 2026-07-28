import { afterEach, describe, expect, it, vi } from "vitest";

import { loadManifest } from "./manifest";

describe("loadManifest", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("treats a missing deployment manifest as an explicit prelaunch absence", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 404 })));

    await expect(loadManifest("/deployments/hyperevm-mainnet-999.json", 999)).resolves.toEqual({
      status: "absent",
    });
  });

  it("does not disguise a provider or server failure as prelaunch", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 503 })));

    await expect(loadManifest("/deployments/hyperevm-mainnet-999.json", 999)).resolves.toEqual({
      status: "invalid",
      reason: "HTTP 503",
    });
  });
});
