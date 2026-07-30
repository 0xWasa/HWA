import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const MAX_BODY_BYTES = 64 * 1024;
const UPSTREAM_TIMEOUT_MS = 12_000;
const FRESH_TTL_MS = 15_000;
const STALE_TTL_MS = 5 * 60_000;
const RATE_LIMIT_COOLDOWN_MS = 10_000;
const MAX_CACHE_ENTRIES = 256;

type CachedResponse = { body: unknown; storedAt: number };

const cache = new Map<string, CachedResponse>();
const inFlight = new Map<string, Promise<unknown>>();
let upstreamBlockedUntil = 0;

function json(body: unknown, status = 200, cacheState = "none") {
  return NextResponse.json(body, {
    status,
    headers: { "cache-control": "no-store", "x-hwa-indexer-cache": cacheState },
  });
}

function upstreamUrl(): URL | null {
  try {
    const raw = process.env.HWA_INDEXER_UPSTREAM_URL ?? process.env.NEXT_PUBLIC_INDEXER_URL ?? "";
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    return url;
  } catch {
    return null;
  }
}

function isAllowedRequest(value: unknown): value is { query: string; variables?: Record<string, unknown> } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const body = value as Record<string, unknown>;
  if (Object.keys(body).some((key) => key !== "query" && key !== "variables")) return false;
  if (typeof body.query !== "string" || body.query.length === 0 || body.query.length > MAX_BODY_BYTES) return false;
  if (/\b(?:mutation|subscription|__schema|__type)\b/iu.test(body.query)) return false;
  return body.variables === undefined || (!!body.variables && typeof body.variables === "object" && !Array.isArray(body.variables));
}

function pruneCache(now: number) {
  for (const [key, entry] of cache) if (now - entry.storedAt > STALE_TTL_MS) cache.delete(key);
  while (cache.size > MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value ?? "");
}

async function fetchUpstream(url: URL, raw: string, key: string): Promise<unknown> {
  const existing = inFlight.get(key);
  if (existing) return existing;

  const pending = (async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: raw,
        cache: "no-store",
        signal: controller.signal,
      });
      const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
      if (response.status === 429 || (payload && typeof payload.error === "string" && /allowance|rate limit/iu.test(payload.error))) {
        upstreamBlockedUntil = Date.now() + RATE_LIMIT_COOLDOWN_MS;
        throw new Error("rate limited");
      }
      if (!response.ok || !payload || payload.errors) throw new Error(`upstream HTTP ${response.status}`);
      cache.set(key, { body: payload, storedAt: Date.now() });
      pruneCache(Date.now());
      return payload;
    } finally {
      clearTimeout(timer);
      inFlight.delete(key);
    }
  })();
  inFlight.set(key, pending);
  return pending;
}

export async function POST(request: NextRequest) {
  const length = Number.parseInt(request.headers.get("content-length") ?? "0", 10);
  if (length > MAX_BODY_BYTES) return json({ error: "request too large" }, 413);

  let raw: string;
  let body: unknown;
  try {
    raw = await request.text();
    if (Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) return json({ error: "request too large" }, 413);
    body = JSON.parse(raw);
  } catch {
    return json({ error: "invalid JSON" }, 400);
  }
  if (!isAllowedRequest(body)) return json({ error: "unsupported GraphQL request" }, 400);

  const upstream = upstreamUrl();
  if (!upstream) return json({ error: "indexer unavailable" }, 503);

  const canonical = JSON.stringify(body);
  const key = createHash("sha256").update(canonical).digest("hex");
  const now = Date.now();
  const cached = cache.get(key);
  if (cached && now - cached.storedAt <= FRESH_TTL_MS) return json(cached.body, 200, "hit");
  if (now < upstreamBlockedUntil) {
    return cached ? json(cached.body, 200, "stale") : json({ error: "indexer temporarily rate limited" }, 503);
  }

  try {
    const payload = await fetchUpstream(upstream, canonical, key);
    return json(payload, 200, "miss");
  } catch {
    return cached && now - cached.storedAt <= STALE_TTL_MS
      ? json(cached.body, 200, "stale")
      : json({ error: "indexer temporarily unavailable" }, 503);
  }
}