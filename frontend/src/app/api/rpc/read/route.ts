import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const MAX_BODY_BYTES = 64 * 1024;
const MAX_BATCH_SIZE = 50;
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const UPSTREAM_TIMEOUT_MS = 6_000;
const MAX_RATE_BUCKETS = 4_096;
const RATE_WINDOW_MS = 60_000;
const DEFAULT_RATE_LIMIT = 240;
const MAX_CALLDATA_HEX_LENGTH = 128 * 1024;
const buckets = new Map<string, { startedAt: number; count: number }>();

type JsonRpcId = string | number | null;

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: JsonRpcId;
  method: string;
  params?: unknown[];
}

const NO_PARAM_METHODS = new Set([
  "eth_blockNumber",
  "eth_chainId",
  "eth_gasPrice",
  "eth_maxPriorityFeePerGas",
]);

const READ_METHODS = new Set([
  ...NO_PARAM_METHODS,
  "eth_call",
  "eth_estimateGas",
  "eth_feeHistory",
  "eth_getBalance",
  "eth_getBlockByHash",
  "eth_getBlockByNumber",
  "eth_getBlockReceipts",
  "eth_getBlockTransactionCountByHash",
  "eth_getBlockTransactionCountByNumber",
  "eth_getCode",
  "eth_getStorageAt",
  "eth_getTransactionByHash",
  "eth_getTransactionCount",
  "eth_getTransactionReceipt",
]);

const ADDRESS_RE = /^0x[a-f0-9]{40}$/i;
const HASH_RE = /^0x[a-f0-9]{64}$/i;
const HEX_RE = /^0x(?:0|[1-9a-f][0-9a-f]*|[a-f0-9]{2,})$/i;
const BLOCK_TAGS = new Set(["latest", "safe", "finalized", "pending", "earliest"]);

function noStore(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });
}

function envUint(name: string, fallback: number): number {
  const value = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
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
  const limit = envUint("HYPEREVM_READ_RPC_RATE_LIMIT_PER_MINUTE", DEFAULT_RATE_LIMIT);
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

function isBlockId(value: unknown): boolean {
  return typeof value === "string" && (BLOCK_TAGS.has(value) || HEX_RE.test(value) || HASH_RE.test(value));
}

function isQuantity(value: unknown): boolean {
  return typeof value === "string" && HEX_RE.test(value);
}

function isTransaction(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const tx = value as Record<string, unknown>;
  const allowed = new Set(["accessList", "data", "from", "gas", "gasPrice", "maxFeePerGas", "maxPriorityFeePerGas", "to", "type", "value"]);
  if (Object.keys(tx).some((key) => !allowed.has(key))) return false;
  if (tx.to !== undefined && (typeof tx.to !== "string" || !ADDRESS_RE.test(tx.to))) return false;
  if (tx.from !== undefined && (typeof tx.from !== "string" || !ADDRESS_RE.test(tx.from))) return false;
  if (tx.data !== undefined && (typeof tx.data !== "string" || !/^0x(?:[a-f0-9]{2})*$/i.test(tx.data) || tx.data.length > MAX_CALLDATA_HEX_LENGTH)) return false;
  for (const key of ["gas", "gasPrice", "maxFeePerGas", "maxPriorityFeePerGas", "type", "value"]) {
    if (tx[key] !== undefined && !isQuantity(tx[key])) return false;
  }
  if (tx.accessList !== undefined && !Array.isArray(tx.accessList)) return false;
  return true;
}

function hasParams(params: unknown[], count: number): boolean {
  return params.length === count;
}

function isValidCall(value: unknown): value is JsonRpcRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const call = value as Partial<JsonRpcRequest>;
  if (call.jsonrpc !== "2.0" || typeof call.method !== "string" || !READ_METHODS.has(call.method)) return false;
  if (!(call.id === null || typeof call.id === "string" || (typeof call.id === "number" && Number.isSafeInteger(call.id)))) return false;
  const params = call.params ?? [];
  if (!Array.isArray(params)) return false;

  if (NO_PARAM_METHODS.has(call.method)) return hasParams(params, 0);
  if (["eth_getTransactionByHash", "eth_getTransactionReceipt", "eth_getBlockTransactionCountByHash"].includes(call.method)) {
    return hasParams(params, 1) && typeof params[0] === "string" && HASH_RE.test(params[0]);
  }
  if (["eth_getBlockTransactionCountByNumber", "eth_getBlockReceipts"].includes(call.method)) {
    return hasParams(params, 1) && isBlockId(params[0]);
  }
  if (["eth_getBalance", "eth_getCode", "eth_getTransactionCount"].includes(call.method)) {
    return hasParams(params, 2) && typeof params[0] === "string" && ADDRESS_RE.test(params[0]) && isBlockId(params[1]);
  }
  if (call.method === "eth_getStorageAt") {
    return hasParams(params, 3) && typeof params[0] === "string" && ADDRESS_RE.test(params[0]) && isQuantity(params[1]) && isBlockId(params[2]);
  }
  if (call.method === "eth_getBlockByHash") {
    return hasParams(params, 2) && typeof params[0] === "string" && HASH_RE.test(params[0]) && typeof params[1] === "boolean";
  }
  if (call.method === "eth_getBlockByNumber") {
    return hasParams(params, 2) && isBlockId(params[0]) && typeof params[1] === "boolean";
  }
  if (["eth_call", "eth_estimateGas"].includes(call.method)) {
    return (hasParams(params, 1) || hasParams(params, 2)) && isTransaction(params[0]) && (params[1] === undefined || isBlockId(params[1]));
  }
  if (call.method === "eth_feeHistory") {
    if (!hasParams(params, 3) || !isQuantity(params[0]) || !isBlockId(params[1]) || !Array.isArray(params[2]) || params[2].length > 100) return false;
    const count = Number.parseInt((params[0] as string).slice(2), 16);
    return Number.isSafeInteger(count) && count > 0 && count <= 256 && params[2].every((percentile) => typeof percentile === "number" && percentile >= 0 && percentile <= 100);
  }
  return false;
}

function parseUpstream(raw: string, headers: Record<string, string>): { url: URL; headers: Record<string, string> } | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    return { url, headers };
  } catch {
    return null;
  }
}

function upstreamConfigs(): { url: URL; headers: Record<string, string> }[] {
  const apiKey = process.env.HYPEREVM_LOG_RPC_API_KEY?.trim();
  const headerName = (process.env.HYPEREVM_LOG_RPC_API_KEY_HEADER ?? "x-api-key").trim().toLowerCase();
  if (!/^[a-z0-9-]{1,64}$/.test(headerName)) return [];

  const primaryHeaders: Record<string, string> = { "content-type": "application/json", accept: "application/json" };
  if (apiKey) primaryHeaders[headerName] = apiKey;
  const primary = parseUpstream(process.env.HYPEREVM_LOG_RPC_UPSTREAM_URL ?? "", primaryHeaders);
  const fallback = parseUpstream(process.env.HYPEREVM_READ_RPC_FALLBACK_URL ?? "", {
    "content-type": "application/json",
    accept: "application/json",
  });
  const upstreams = [primary, fallback].filter(
    (item): item is { url: URL; headers: Record<string, string> } => item !== null,
  );
  return upstreams.filter((item, index) => upstreams.findIndex((candidate) => candidate.url.href === item.url.href) === index);
}
export async function POST(request: NextRequest) {
  const contentLength = Number.parseInt(request.headers.get("content-length") ?? "0", 10);
  if (contentLength > MAX_BODY_BYTES) return noStore({ error: "request too large" }, 413);
  if (isRateLimited(request)) return noStore({ error: "rate limited" }, 429);

  const upstreams = upstreamConfigs();
  if (upstreams.length === 0) return noStore({ error: "read RPC unavailable" }, 503);

  let body: unknown;
  try {
    const raw = await request.text();
    if (Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) return noStore({ error: "request too large" }, 413);
    body = JSON.parse(raw);
  } catch {
    return noStore({ error: "invalid JSON" }, 400);
  }

  const calls = Array.isArray(body) ? body : [body];
  if (calls.length === 0 || calls.length > MAX_BATCH_SIZE || calls.some((call) => !isValidCall(call))) {
    return noStore({ error: "unsupported JSON-RPC request" }, 400);
  }

  for (const upstream of upstreams) {
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
      if (Buffer.byteLength(raw, "utf8") > MAX_RESPONSE_BYTES) continue;
      if (!response.ok) continue;
      try {
        return noStore(JSON.parse(raw));
      } catch {
        // Try the next reviewed read endpoint on malformed upstream output.
      }
    } catch {
      // Timeout/network failure: immediately fail over instead of making the
      // browser wait through viem's full retry cycle on one provider.
    } finally {
      clearTimeout(timer);
    }
  }
  return noStore({ error: "all read RPC upstreams unavailable" }, 502);
}