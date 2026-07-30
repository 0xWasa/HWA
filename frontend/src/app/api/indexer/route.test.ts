import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "./route";

function request(query: string) {
  const body = JSON.stringify({ query });
  return new NextRequest("https://hwa.test/api/indexer", {
    method: "POST",
    headers: { "content-type": "application/json", "content-length": String(body.length) },
    body,
  });
}

describe("indexer cache proxy", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.HWA_INDEXER_UPSTREAM_URL;
  });

  it("fails closed without a configured HTTPS upstream", async () => {
    expect((await POST(request("{ _meta { block { number } } }"))).status).toBe(503);
  });

  it("rejects mutations and introspection", async () => {
    process.env.HWA_INDEXER_UPSTREAM_URL = "https://indexer.example/graphql";
    expect((await POST(request("mutation { pause }"))).status).toBe(400);
    expect((await POST(request("{ __schema { types { name } } }"))).status).toBe(400);
  });

  it("coalesces and caches identical queries", async () => {
    process.env.HWA_INDEXER_UPSTREAM_URL = "https://indexer.example/graphql";
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ data: { _meta: { block: { number: 42 }, hasIndexingErrors: false } } }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const query = `{ _meta { block { number } hasIndexingErrors } } # ${crypto.randomUUID()}`;

    const [first, second] = await Promise.all([POST(request(query)), POST(request(query))]);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect((await POST(request(query))).headers.get("x-hwa-indexer-cache")).toBe("hit");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("does not expose Goldsky rate limits as a successful GraphQL response", async () => {
    process.env.HWA_INDEXER_UPSTREAM_URL = "https://indexer.example/graphql";
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "query allowance surpassed" }), { status: 429 })));
    const response = await POST(request(`{ _meta { block { number } } } # ${crypto.randomUUID()}`));
    expect(response.status).toBe(503);
  });
});