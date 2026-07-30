import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "./route";

const CORE = "0x1111111111111111111111111111111111111111";

function request(body: unknown) {
  const raw = JSON.stringify(body);
  return new NextRequest("https://hwa.test/api/rpc/logs", {
    method: "POST",
    headers: { "content-type": "application/json", "content-length": String(raw.length) },
    body: raw,
  });
}

function call(overrides: Record<string, unknown> = {}) {
  return {
    jsonrpc: "2.0",
    id: 1,
    method: "eth_getLogs",
    params: [{ address: CORE, fromBlock: "0x64", toBlock: "0xc7", topics: [], ...overrides }],
  };
}

describe("log RPC proxy", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.HYPEREVM_LOG_RPC_UPSTREAM_URL;
    delete process.env.HYPEREVM_LOG_RPC_API_KEY;
    delete process.env.HYPEREVM_LOG_RPC_ALLOWED_ADDRESSES;
    delete process.env.HYPEREVM_LOG_RPC_MAX_BLOCK_RANGE;
  });

  it("fails closed without server configuration", async () => {
    const response = await POST(request(call()));
    expect(response.status).toBe(503);
  });

  it("rejects methods, addresses and ranges outside the policy", async () => {
    process.env.HYPEREVM_LOG_RPC_UPSTREAM_URL = "https://rpc.example.test";
    process.env.HYPEREVM_LOG_RPC_ALLOWED_ADDRESSES = CORE;
    process.env.HYPEREVM_LOG_RPC_MAX_BLOCK_RANGE = "100";
    expect((await POST(request({ ...call(), method: "eth_call" }))).status).toBe(400);
    expect((await POST(request(call({ address: "0x2222222222222222222222222222222222222222" })))).status).toBe(400);
    expect((await POST(request(call({ toBlock: "0xc8" })))).status).toBe(400);
  });

  it("forwards a bounded eth_getLogs call with the server-only credential", async () => {
    process.env.HYPEREVM_LOG_RPC_UPSTREAM_URL = "https://rpc.example.test";
    process.env.HYPEREVM_LOG_RPC_API_KEY = "secret-test-key";
    process.env.HYPEREVM_LOG_RPC_ALLOWED_ADDRESSES = CORE;
    process.env.HYPEREVM_LOG_RPC_MAX_BLOCK_RANGE = "100";
    const fetchMock = vi.fn(async (_url: URL, init: RequestInit) => {
      expect(new Headers(init.headers).get("x-api-key")).toBe("secret-test-key");
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: [] }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const response = await POST(request(call()));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ jsonrpc: "2.0", id: 1, result: [] });
    expect(fetchMock).toHaveBeenCalledOnce();
    const cached = await POST(request({ ...call(), id: 9 }));
    expect(cached.status).toBe(200);
    expect(await cached.json()).toEqual({ jsonrpc: "2.0", id: 9, result: [] });
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});

