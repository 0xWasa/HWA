import { NextRequest, NextResponse } from "next/server";
import { collectionFloorConfig, type CollectionFloorQuote } from "@/lib/collectionFloors";
import type { Address } from "@/protocol/types";

export const runtime = "nodejs";

const ADDRESS_RE = /^0x[0-9a-f]{40}$/;
const FETCH_TIMEOUT_MS = 4_000;

type OpenSeaStats = {
  total?: {
    floor_price?: unknown;
    floor_price_symbol?: unknown;
  };
};

function response(body: CollectionFloorQuote, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
    },
  });
}

function unavailable(collection: Address, marketplaceUrl?: string, status = 503) {
  return response(
    {
      collection,
      floorHype: null,
      source: "unavailable",
      sourceLabel: "Live floor unavailable",
      observedAt: new Date().toISOString(),
      stale: true,
      marketplaceUrl,
    },
    status,
  );
}

export async function GET(request: NextRequest) {
  const raw = (request.nextUrl.searchParams.get("collection") ?? "").toLowerCase();
  if (!ADDRESS_RE.test(raw)) {
    return NextResponse.json({ error: "invalid collection" }, { status: 400 });
  }

  const collection = raw as Address;
  const config = collectionFloorConfig(collection);
  if (!config) return NextResponse.json({ error: "unsupported collection" }, { status: 404 });

  // Genesis has no liquid marketplace yet. Keep its reviewed seed reference
  // clearly separated from a market floor instead of inventing one.
  if (!config.slug && config.seedReferenceHype) {
    return response({
      collection,
      floorHype: config.seedReferenceHype,
      source: "seed-reference",
      sourceLabel: "Genesis seed reference",
      observedAt: new Date().toISOString(),
      stale: false,
    });
  }

  const apiKey = (process.env.OPENSEA_API_KEY ?? "").trim();
  if (!config.slug) return unavailable(collection, config.marketplaceUrl);

  try {
    const headers = new Headers({ accept: "application/json" });
    if (apiKey) headers.set("x-api-key", apiKey);
    const upstream = await fetch(`https://api.opensea.io/api/v2/collections/${config.slug}/stats`, {
      headers,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      next: { revalidate: 60 },
    });
    if (!upstream.ok) return unavailable(collection, config.marketplaceUrl, 502);

    const stats = (await upstream.json()) as OpenSeaStats;
    const rawFloor = stats.total?.floor_price;
    const symbol = String(stats.total?.floor_price_symbol ?? "").toUpperCase();
    const floor = typeof rawFloor === "number" ? rawFloor : Number(rawFloor);
    if (!Number.isFinite(floor) || floor <= 0 || !["HYPE", "WHYPE"].includes(symbol)) {
      return unavailable(collection, config.marketplaceUrl, 502);
    }

    return response({
      collection,
      floorHype: floor.toString(),
      source: "opensea",
      sourceLabel: "OpenSea floor",
      observedAt: new Date().toISOString(),
      stale: false,
      marketplaceUrl: config.marketplaceUrl,
    });
  } catch {
    return unavailable(collection, config.marketplaceUrl, 502);
  }
}
