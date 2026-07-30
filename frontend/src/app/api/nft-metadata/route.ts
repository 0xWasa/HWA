import { NextRequest, NextResponse } from "next/server";
import { lookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";

export const runtime = "nodejs";

const MAX_URI_LENGTH = 4_096;
const MAX_METADATA_BYTES = 512 * 1024;
const MAX_DATA_IMAGE_BYTES = 768 * 1024;
const FETCH_TIMEOUT_MS = 5_000;
const RATE_WINDOW_MS = 60_000;
const DEFAULT_RATE_LIMIT = 60;
const MAX_CONFIGURED_RATE_LIMIT = 5_000;
const MAX_RATE_BUCKETS = 4_096;
const rateBuckets = new Map<string, { startedAt: number; count: number }>();

function allowedHosts(): Set<string> {
  return new Set(
    (process.env.NFT_METADATA_ALLOWED_HOSTS ?? "")
      .split(",")
      .map((host) => host.trim().toLowerCase().replace(/^https:\/\//, "").replace(/\/$/, ""))
      .filter(Boolean),
  );
}

function ipfsGateway(): URL {
  const configured = process.env.NFT_IPFS_GATEWAY_BASE_URL ?? "https://ipfs.io/ipfs/";
  const url = new URL(configured);
  if (url.protocol !== "https:") throw new Error("NFT_IPFS_GATEWAY_BASE_URL must use HTTPS");
  if (!url.pathname.endsWith("/")) url.pathname += "/";
  return url;
}

function ipfsPath(value: string): string | null {
  if (!value.startsWith("ipfs://")) return null;
  const raw = value.slice("ipfs://".length).replace(/^ipfs\//, "").split(/[?#]/, 1)[0] ?? "";
  const segments = raw.split("/");
  if (!segments.length || segments.some((part) => !part || part === "." || part === ".." || !/^[A-Za-z0-9._~-]+$/.test(part))) {
    return null;
  }
  return segments.map(encodeURIComponent).join("/");
}

function ipfsURL(value: string): URL | null {
  const path = ipfsPath(value);
  if (!path) return null;
  return new URL(path, ipfsGateway());
}

function allowedHTTPSURL(value: string, hosts: Set<string>, forbiddenOrigin?: string): URL | null {
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      !hosts.has(url.host.toLowerCase()) ||
      (forbiddenOrigin && url.origin.toLowerCase() === forbiddenOrigin.toLowerCase())
    ) return null;
    return url;
  } catch {
    return null;
  }
}

function decodeDataJSON(uri: string): string | null {
  if (!uri.startsWith("data:application/json")) return null;
  if (uri.length > MAX_METADATA_BYTES * 2) return null;
  const comma = uri.indexOf(",");
  if (comma === -1) return null;
  const header = uri.slice(0, comma).toLowerCase();
  const payload = uri.slice(comma + 1);
  try {
    const decoded = header.includes(";base64") ? Buffer.from(payload, "base64").toString("utf8") : decodeURIComponent(payload);
    return Buffer.byteLength(decoded, "utf8") <= MAX_METADATA_BYTES ? decoded : null;
  } catch {
    return null;
  }
}

/**
 * A few established on-chain collections emit JSON with a trailing comma in
 * an attributes array. Browsers and JSON.parse reject it even though the
 * tokenURI is otherwise unambiguous. Repair only commas immediately followed
 * by a closing array/object token, and only while outside JSON strings; all
 * other malformed metadata still fails closed.
 */
function withoutTrailingJSONCommas(raw: string): string {
  let repaired = "";
  let inString = false;
  let escaped = false;

  for (let index = 0; index < raw.length; index += 1) {
    const character = raw[index]!;
    if (inString) {
      repaired += character;
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }

    if (character === '"') {
      inString = true;
      repaired += character;
      continue;
    }

    if (character === ",") {
      let next = index + 1;
      while (next < raw.length && /\s/.test(raw[next]!)) next += 1;
      if (raw[next] === "]" || raw[next] === "}") continue;
    }
    repaired += character;
  }

  return repaired;
}

function parseMetadataJSON(raw: string): { name?: unknown; image?: unknown; image_url?: unknown } {
  try {
    return JSON.parse(raw) as { name?: unknown; image?: unknown; image_url?: unknown };
  } catch (originalError) {
    const repaired = withoutTrailingJSONCommas(raw);
    if (repaired === raw) throw originalError;
    return JSON.parse(repaired) as { name?: unknown; image?: unknown; image_url?: unknown };
  }
}

function safeName(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const sanitized = value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);
  return sanitized || undefined;
}

function safeImageURL(value: unknown, hosts: Set<string>, forbiddenOrigin?: string): string | undefined {
  if (typeof value !== "string" || value.length > MAX_DATA_IMAGE_BYTES * 2) return undefined;
  const ipfs = ipfsURL(value);
  if (ipfs) return ipfs.toString();
  const remote = allowedHTTPSURL(value, hosts, forbiddenOrigin);
  if (remote) return remote.toString();
  const match = /^data:image\/(png|jpeg|gif|webp);base64,([A-Za-z0-9+/=]+)$/i.exec(value);
  if (match) return Buffer.byteLength(match[2] ?? "", "base64") <= MAX_DATA_IMAGE_BYTES ? value : undefined;

  // Fully on-chain collections commonly embed SVG artwork in tokenURI JSON. SVG stays in an
  // isolated <img> context, but reject active content and outbound references before returning it.
  const svgMatch = /^data:image\/svg\+xml;base64,([A-Za-z0-9+/=]+)$/i.exec(value);
  if (!svgMatch || Buffer.byteLength(svgMatch[1] ?? "", "base64") > MAX_DATA_IMAGE_BYTES) return undefined;
  try {
    const svg = Buffer.from(svgMatch[1] ?? "", "base64").toString("utf8");
    if (!/^\s*<svg(?:\s|>)/i.test(svg)) return undefined;
    if (
      /<\s*(?:script|foreignObject|iframe|object|embed|audio|video|style)\b/i.test(svg) ||
      /\bon[a-z]+\s*=/i.test(svg) ||
      /\b(?:href|xlink:href)\s*=/i.test(svg) ||
      /(?:url\s*\(|@import|<!doctype|<\?xml-stylesheet)/i.test(svg)
    ) return undefined;
    return value;
  } catch {
    return undefined;
  }
}

function isPrivateIPv4(address: string): boolean {
  const normalized = address.toLowerCase();
  const octets = normalized.split(".").map(Number);
  if (octets.length !== 4 || octets.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) return true;
  const a = octets[0]!;
  const b = octets[1]!;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && octets[2] === 0) ||
    (a === 192 && b === 0 && octets[2] === 2) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && octets[2] === 100) ||
    (a === 203 && b === 0 && octets[2] === 113) ||
    a >= 224
  );
}

function parseIPv6(address: string): bigint | null {
  let normalized = address.toLowerCase();
  if (normalized.includes("%")) return null;
  const ipv4Tail = /(?:^|:)(\d+\.\d+\.\d+\.\d+)$/.exec(normalized)?.[1];
  if (ipv4Tail) {
    const octets = ipv4Tail.split(".").map(Number);
    if (octets.length !== 4 || octets.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) return null;
    const replacement = `${((octets[0]! << 8) | octets[1]!).toString(16)}:${((octets[2]! << 8) | octets[3]!).toString(16)}`;
    normalized = normalized.slice(0, -ipv4Tail.length) + replacement;
  }
  const halves = normalized.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  if (halves.length === 1 && left.length !== 8) return null;
  const missing = 8 - left.length - right.length;
  if (missing < 0 || (halves.length === 2 && missing < 1)) return null;
  const words = [...left, ...Array.from({ length: missing }, () => "0"), ...right];
  if (words.length !== 8 || words.some((word) => !/^[0-9a-f]{1,4}$/.test(word))) return null;
  return words.reduce((value, word) => (value << 16n) | BigInt(`0x${word}`), 0n);
}

export function isPrivateAddress(address: string): boolean {
  if (isIP(address) === 4) return isPrivateIPv4(address);
  if (isIP(address) !== 6) return true;
  const value = parseIPv6(address);
  if (value === null) return true;
  const prefix96 = value >> 32n;
  // IPv4-compatible and IPv4-mapped addresses inherit the embedded IPv4 classification.
  if (prefix96 === 0n || prefix96 === 0xffffn) {
    const embedded = Number(value & 0xffff_ffffn);
    return isPrivateIPv4(
      `${(embedded >>> 24) & 255}.${(embedded >>> 16) & 255}.${(embedded >>> 8) & 255}.${embedded & 255}`,
    );
  }
  return (
    value === 0n ||
    value === 1n ||
    value >> 96n === 0x0064_ff9bn || // NAT64 well-known prefix 64:ff9b::/96
    value >> 80n === 0x0064_ff9b_0001n || // local-use NAT64 64:ff9b:1::/48
    value >> 112n === 0x2002n || // 6to4 embeds an unchecked IPv4 destination
    value >> 96n === 0x2001_0000n || // Teredo
    value >> 96n === 0x2001_0db8n || // documentation
    value >> 121n === 0x7en || // fc00::/7 unique-local
    value >> 118n === 0x3fan || // fe80::/10 link-local
    value >> 118n === 0x3fbn || // fec0::/10 deprecated site-local
    value >> 120n === 0xffn // multicast
  );
}

type ResolvedDestination = { address: string; family: 4 | 6 };

async function resolvePublicDestination(url: URL): Promise<ResolvedDestination> {
  if (isIP(url.hostname)) {
    if (isPrivateAddress(url.hostname)) throw new Error("private destination rejected");
    return { address: url.hostname, family: isIP(url.hostname) as 4 | 6 };
  }
  const addresses = await lookup(url.hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address))) {
    throw new Error("private or unresolved destination rejected");
  }
  const selected = addresses[0]!;
  return { address: selected.address, family: selected.family as 4 | 6 };
}

function fetchPinnedMetadata(url: URL, destination: ResolvedDestination): Promise<{ body: string; contentType: string }> {
  return new Promise((resolve, reject) => {
    const request = httpsRequest(
      url,
      {
        method: "GET",
        headers: { accept: "application/json" },
        servername: isIP(url.hostname) ? undefined : url.hostname,
        lookup: (_hostname, options, callback) => {
          // Node 20+ may request every candidate address (`all: true`) for its
          // family autoselection path. Preserve the DNS pin in both lookup
          // callback shapes instead of returning the scalar form unconditionally.
          if (options.all) callback(null, [destination]);
          else callback(null, destination.address, destination.family);
        },
      },
      (response) => {
        const status = response.statusCode ?? 0;
        if (status < 200 || status >= 300) {
          response.resume();
          reject(new Error(`metadata HTTP ${status}`));
          return;
        }
        const declared = Number(response.headers["content-length"] ?? 0);
        if (declared > MAX_METADATA_BYTES) {
          response.destroy(new Error("metadata too large"));
          return;
        }
        const chunks: Buffer[] = [];
        let total = 0;
        response.on("data", (chunk: Buffer) => {
          total += chunk.byteLength;
          if (total > MAX_METADATA_BYTES) response.destroy(new Error("metadata too large"));
          else chunks.push(chunk);
        });
        response.on("end", () =>
          resolve({ body: Buffer.concat(chunks).toString("utf8"), contentType: String(response.headers["content-type"] ?? "") }),
        );
        response.on("error", reject);
      },
    );
    request.setTimeout(FETCH_TIMEOUT_MS, () => request.destroy(new Error("metadata timeout")));
    request.on("error", reject);
    request.end();
  });
}

export function metadataRateLimit(): number {
  const configured = Number(process.env.NFT_METADATA_RATE_LIMIT_PER_MINUTE ?? DEFAULT_RATE_LIMIT);
  if (!Number.isSafeInteger(configured) || configured < 1) return DEFAULT_RATE_LIMIT;
  return Math.min(configured, MAX_CONFIGURED_RATE_LIMIT);
}

export function trustedClientKey(request: NextRequest): string {
  const configured = (process.env.NFT_METADATA_TRUSTED_CLIENT_IP_HEADER ?? "").trim().toLowerCase();
  // x-real-ip is safe only when the application is private behind a reverse
  // proxy that overwrites it. The production container binds to 127.0.0.1 and
  // Nginx sets this header from $remote_addr.
  const supported = new Set(["x-vercel-forwarded-for", "cf-connecting-ip", "fly-client-ip", "x-real-ip"]);
  if (!supported.has(configured)) return "untrusted-shared";
  const values = (request.headers.get(configured) ?? "").split(",").map((value) => value.trim()).filter(Boolean);
  const candidate = values.at(-1) ?? "";
  return isIP(candidate) ? candidate : "untrusted-shared";
}

function rateLimited(request: NextRequest): boolean {
  const key = trustedClientKey(request);
  const now = Date.now();
  const bucket = rateBuckets.get(key);
  if (!bucket || now - bucket.startedAt >= RATE_WINDOW_MS) {
    for (const [existingKey, existing] of rateBuckets) {
      if (now - existing.startedAt >= RATE_WINDOW_MS) rateBuckets.delete(existingKey);
    }
    while (rateBuckets.size >= MAX_RATE_BUCKETS) {
      const oldest = rateBuckets.keys().next().value as string | undefined;
      if (!oldest) break;
      rateBuckets.delete(oldest);
    }
    rateBuckets.set(key, { startedAt: now, count: 1 });
    return false;
  }
  bucket.count += 1;
  return bucket.count > metadataRateLimit();
}

async function metadataResponse(request: NextRequest, uri: string) {
  const maxURILength = uri.startsWith("data:application/json") ? MAX_METADATA_BYTES * 2 : MAX_URI_LENGTH;
  if (!uri || uri.length > maxURILength) {
    return NextResponse.json({ error: "invalid token URI" }, { status: 400, headers: { "cache-control": "no-store" } });
  }

  try {
    const hosts = allowedHosts();
    const gateway = ipfsGateway();
    hosts.add(gateway.host.toLowerCase());
    const inline = decodeDataJSON(uri);
    let raw: string;
    if (inline !== null) {
      raw = inline;
    } else {
      const source = ipfsURL(uri) ?? allowedHTTPSURL(uri, hosts, request.nextUrl.origin);
      if (!source) throw new Error("token URI host is not allowlisted");
      const destination = await resolvePublicDestination(source);
      const response = await fetchPinnedMetadata(source, destination);
      const contentType = response.contentType.toLowerCase();
      if (contentType && !contentType.includes("json") && !contentType.startsWith("text/plain")) {
        throw new Error("metadata is not JSON");
      }
      raw = response.body;
    }

    const parsed = parseMetadataJSON(raw);
    return NextResponse.json(
      { name: safeName(parsed.name), imageUrl: safeImageURL(parsed.image ?? parsed.image_url, hosts, request.nextUrl.origin) },
      {
        headers: {
          "cache-control": "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800",
          "x-content-type-options": "nosniff",
        },
      },
    );
  } catch {
    return NextResponse.json(
      { error: "metadata unavailable" },
      { status: 422, headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } },
    );
  }
}

function rateLimitResponse(request: NextRequest): NextResponse | null {
  return rateLimited(request)
    ? NextResponse.json(
        { error: "rate limit exceeded" },
        { status: 429, headers: { "cache-control": "no-store", "retry-after": "60" } },
      )
    : null;
}

export async function GET(request: NextRequest) {
  const limited = rateLimitResponse(request);
  if (limited) return limited;
  return metadataResponse(request, request.nextUrl.searchParams.get("uri") ?? "");
}

export async function POST(request: NextRequest) {
  const limited = rateLimitResponse(request);
  if (limited) return limited;
  try {
    const body = (await request.json()) as { uri?: unknown };
    return metadataResponse(request, typeof body.uri === "string" ? body.uri : "");
  } catch {
    return NextResponse.json({ error: "invalid token URI" }, { status: 400, headers: { "cache-control": "no-store" } });
  }
}
