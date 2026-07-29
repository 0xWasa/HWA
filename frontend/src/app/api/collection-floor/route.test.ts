import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "./route";

function request(collection: string) {
  return new NextRequest(`https://hwa.test/api/collection-floor?collection=${collection}`);
}

describe("collection floor API", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.OPENSEA_API_KEY;
  });

  it("rejects arbitrary collections before any upstream request", async () => {
    expect((await GET(request("0x0000000000000000000000000000000000000001"))).status).toBe(404);
  });

  it("returns the Genesis seed reference without calling a marketplace", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const result = await GET(request("0x89d52133b105e9548df16de4d7cf59c412daf191"));
    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({ floorHype: "0.25", source: "seed-reference" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps the OpenSea credential server-side and validates HYPE floors", async () => {
    process.env.OPENSEA_API_KEY = "server-secret";
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      expect(new Headers(init.headers).get("x-api-key")).toBe("server-secret");
      return new Response(JSON.stringify({ total: { floor_price: 2, floor_price_symbol: "HYPE" } }), {
        status: 200,
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await GET(request("0x63eb9d77d083ca10c304e28d5191321977fd0bfb"));
    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({ floorHype: "2", source: "opensea" });
  });

  it("can use OpenSea's public stats endpoint without exposing or requiring a key", async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      expect(new Headers(init.headers).get("x-api-key")).toBeNull();
      return new Response(JSON.stringify({ total: { floor_price: 0.8, floor_price_symbol: "HYPE" } }), {
        status: 200,
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await GET(request("0xbc4a26ba78ce05e8bcbf069bbb87fb3e1dac8df8"));
    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({ floorHype: "0.8", source: "opensea" });
  });

  it("fails visibly instead of substituting a fabricated floor", async () => {
    process.env.OPENSEA_API_KEY = "server-secret";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ total: { floor_price: 1, floor_price_symbol: "ETH" } }), { status: 200 }),
      ),
    );
    const result = await GET(request("0x63eb9d77d083ca10c304e28d5191321977fd0bfb"));
    expect(result.status).toBe(502);
    expect(await result.json()).toMatchObject({ floorHype: null, source: "unavailable" });
  });
});
