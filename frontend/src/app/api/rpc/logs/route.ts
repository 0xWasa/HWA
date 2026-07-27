import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const MAX_BODY_BYTES = 64 * 1024;
const MAX_BATCH_SIZE = 20;
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const UPSTREAM_TIMEOUT_MS = 12_000;
const MAX_RATE_BUCKETS = 4_096;
const RATE_WINDOW_MS = 60_000;
const DEFAULT_RATE_LIMIT = 120;
const buckets = new Map<string, { startedAt: number; count: number }>();

type JsonRpcId = string | number | null;

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: JsonRpcId;
  method: "eth_getLogs";
  params: [Record<string, unknown>];
}

function noStore(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });
}

function envUint(name: string, fallback: number): number {
  const value = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function allowedAddresses(): Set<string> {
  return new Set(
    (process.env.HYPEREVM_LOG_RPC_ALLOWED_ADDRESSES ?? "")
      .split(",")
      .map((address) => address.trim().toLowerCase())
      .filter((address) => /^0x[a-f0-9]{40}$/.test(address)),
  );
}

function clientKey(request: NextRequest): string {
  const trustedHeader = (process.env.HYPEREVM_LOG_RPC_TRUSTED_CLIENT_IP_HEADER ?? "").trim().toLowerCase();
  if (!trustedHeader) return "shared";
  const candidate = request.headers.get(trustedHeader)?.split(",", 1)[0]?.trim();
  return candidate && candidate.length <= 128 ? candidate : "unknown";
}

function isRateLimited(request: NextRequest): boolean {
  const now = Date.now();
  const key = clientKey(request);
  const limit = envUint("HYPEREVM_LOG_RPC_RATE_LIMIT_PER_MINUTE", DEFAULT_RATE_LIMIT);
  let bucket = buckets.get(key);
  if (!bucket || now - bucket.startedAt >= RATE_WINDOW_MS) {
    if (buckets.size >= MAX_RATE_BUCKETS) {
      for (const [entryKey, entry] of buckets) {
        if (now - entry.startedAt >= RATE_WINDOW_MS) buckets.delete(entryKey);
      }
      if (buckets.size >= MAX_RATE_BUCKETS) buckets.delete(buckets.keys().next().value ?? "");
    }
    bucket = { startedAt: now, count: 0 };
    buckets.set(key, bucket);
  }
  bucket.count += 1;
  return bucket.count > limit;
}

function parseHexBlock(value: unknown): bigint | null {
  if (typeof value !== "string" || !/^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(value)) return null;
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

function isValidCall(value: unknown, addresses: Set<string>, maxRange: bigint): value is JsonRpcRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const request = value as Partial<JsonRpcRequest>;
  if (request.jsonrpc !== "2.0" || request.method !== "eth_getLogs" || !Array.isArray(request.params) || request.params.length !== 1) {
    return false;
  }
  const filter = request.params[0];
  if (!filter || typeof filter !== "object" || Array.isArray(filter) || "blockHash" in filter) return false;
  const address = filter.address;
  if (typeof address !== "string" || !addresses.has(address.toLowerCase())) return false;
  const fromBlock = parseHexBlock(filter.fromBlock);
  const toBlock = parseHexBlock(filter.toBlock);
  if (fromBlock === null || toBlock === null || toBlock < fromBlock || toBlock - fromBlock + 1n > maxRange) return false;
  if (filter.topics !== undefined && (!Array.isArray(filter.topics) || filter.topics.length > 4)) return false;
  return true;
}

function upstreamConfig(): { url: URL; headers: Record<string, string> } | null {
  try {
    const url = new URL(process.env.HYPEREVM_LOG_RPC_UPSTREAM_URL ?? "");
    if (url.protocol !== "https:" || url.username || url.password) return null;
    const apiKey = process.env.HYPEREVM_LOG_RPC_API_KEY?.trim();
    const headerName = (process.env.HYPEREVM_LOG_RPC_API_KEY_HEADER ?? "x-api-key").trim().toLowerCase();
    if (!/^[a-z0-9-]{1,64}$/.test(headerName)) return null;
    const headers: Record<string, string> = { "content-type": "application/json", accept: "application/json" };
    if (apiKey) headers[headerName] = apiKey;
    return { url, headers };
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest) {
  const contentLength = Number.parseInt(request.headers.get("content-length") ?? "0", 10);
  if (contentLength > MAX_BODY_BYTES) return noStore({ error: "request too large" }, 413);
  if (isRateLimited(request)) return noStore({ error: "rate limited" }, 429);

  const upstream = upstreamConfig();
  const addresses = allowedAddresses();
  const maxRange = BigInt(envUint("HYPEREVM_LOG_RPC_MAX_BLOCK_RANGE", 0));
  if (!upstream || addresses.size === 0 || maxRange === 0n) return noStore({ error: "log RPC unavailable" }, 503);

  let body: unknown;
  try {
    const raw = await request.text();
    if (Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) return noStore({ error: "request too large" }, 413);
    body = JSON.parse(raw);
  } catch {
    return noStore({ error: "invalid JSON" }, 400);
  }

  const calls = Array.isArray(body) ? body : [body];
  if (calls.length === 0 || calls.length > MAX_BATCH_SIZE || calls.some((call) => !isValidCall(call, addresses, maxRange))) {
    return noStore({ error: "unsupported JSON-RPC request" }, 400);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const response = await fetch(upstream.url, {
      method: "POST",
      headers: upstream.headers,
      body: JSON.stringify(body),
      cache: "no-store",
      signal: controller.signal,
    });
    const raw = await response.text();
    if (Buffer.byteLength(raw, "utf8") > MAX_RESPONSE_BYTES) return noStore({ error: "upstream response too large" }, 502);
    if (!response.ok) return noStore({ error: "upstream unavailable", status: response.status }, 502);
    try {
      return noStore(JSON.parse(raw));
    } catch {
      return noStore({ error: "invalid upstream response" }, 502);
    }
  } catch {
    return noStore({ error: "upstream unavailable" }, 502);
  } finally {
    clearTimeout(timer);
  }
}

