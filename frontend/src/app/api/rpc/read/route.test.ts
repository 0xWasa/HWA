import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "./route";

function request(body: unknown) {
  const raw = JSON.stringify(body);
  return new NextRequest("https://hwa.test/api/rpc/read", {
    method: "POST",
    headers: { "content-type": "application/json", "content-length": String(raw.length) },
    body: raw,
  });
}

function call(method: string, params: unknown[] = []) {
  return { jsonrpc: "2.0", id: 1, method, params };
}

describe("read RPC proxy", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.HYPEREVM_LOG_RPC_UPSTREAM_URL;
    delete process.env.HYPEREVM_LOG_RPC_API_KEY;
    delete process.env.HYPEREVM_READ_RPC_FALLBACK_URL;
  });

  it("fails closed without a server upstream", async () => {
    expect((await POST(request(call("eth_chainId")))).status).toBe(503);
  });

  it("rejects writes, log scans, malformed calls and oversized fee histories", async () => {
    process.env.HYPEREVM_LOG_RPC_UPSTREAM_URL = "https://rpc.example.test";
    expect((await POST(request(call("eth_sendRawTransaction", ["0x00"])))).status).toBe(400);
    expect((await POST(request(call("eth_getLogs", [{}])))).status).toBe(400);
    expect((await POST(request(call("eth_getBalance", ["0x1234", "latest"])))).status).toBe(400);
    expect((await POST(request(call("eth_feeHistory", ["0x101", "latest", []])))).status).toBe(400);
  });

  it("forwards bounded read batches without exposing the credential", async () => {
    process.env.HYPEREVM_LOG_RPC_UPSTREAM_URL = "https://rpc.example.test/v2/private";
    process.env.HYPEREVM_LOG_RPC_API_KEY = "secret-test-key";
    const fetchMock = vi.fn(async (_url: URL, init: RequestInit) => {
      expect(new Headers(init.headers).get("x-api-key")).toBe("secret-test-key");
      const forwarded = JSON.parse(String(init.body)) as unknown[];
      expect(forwarded).toHaveLength(2);
      return new Response(JSON.stringify([
        { jsonrpc: "2.0", id: 1, result: "0x3e7" },
        { jsonrpc: "2.0", id: 1, result: "0x1" },
      ]), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(request([
      call("eth_chainId"),
      call("eth_getBalance", ["0x1111111111111111111111111111111111111111", "latest"]),
    ]));
    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledOnce();
  });


  it("fails over transient read errors without forwarding the primary credential", async () => {
    process.env.HYPEREVM_LOG_RPC_UPSTREAM_URL = "https://primary.example.test";
    process.env.HYPEREVM_LOG_RPC_API_KEY = "secret-test-key";
    process.env.HYPEREVM_READ_RPC_FALLBACK_URL = "https://fallback.example.test";
    const fetchMock = vi.fn(async (url: URL, init: RequestInit) => {
      if (url.hostname === "primary.example.test") return new Response("unavailable", { status: 503 });
      expect(url.hostname).toBe("fallback.example.test");
      expect(new Headers(init.headers).has("x-api-key")).toBe(false);
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x3e7" }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(request(call("eth_chainId")));
    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });  it("accepts the contract reads used by viem", async () => {
    process.env.HYPEREVM_LOG_RPC_UPSTREAM_URL = "https://rpc.example.test";
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const response = await POST(request(call("eth_call", [{
      to: "0x1111111111111111111111111111111111111111",
      data: "0x12345678",
    }, "latest"])));
    expect(response.status).toBe(200);
  });
});
