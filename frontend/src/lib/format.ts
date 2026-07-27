/** Presentation helpers with no money math (see units.ts for that). */

export function shortAddress(addr: string, chars = 4): string {
  if (!addr.startsWith("0x") || addr.length < 2 + chars * 2) return addr;
  return `${addr.slice(0, 2 + chars)}…${addr.slice(-chars)}`;
}

export function shortHash(hash: string): string {
  return shortAddress(hash, 6);
}

export function timeAgo(unixSec: number, nowSec = Math.floor(Date.now() / 1000)): string {
  if (!Number.isFinite(unixSec) || unixSec <= 0) return "time unavailable";
  const d = Math.max(0, nowSec - unixSec);
  if (d < 5) return "just now";
  if (d < 60) return `${d}s ago`;
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  if (d < 7 * 86400) return `${Math.floor(d / 86400)}d ago`;
  return new Date(unixSec * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Remaining time as "23h 12m" / "6d 4h" / "now". Used for settlement windows. */
export function timeLeft(untilSec: number, nowSec = Math.floor(Date.now() / 1000)): string {
  const d = untilSec - nowSec;
  if (d <= 0) return "now";
  if (d < 60) return `${d}s`;
  if (d < 3600) return `${Math.floor(d / 60)}m ${d % 60}s`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ${Math.floor((d % 3600) / 60)}m`;
  return `${Math.floor(d / 86400)}d ${Math.floor((d % 86400) / 3600)}h`;
}

export function fullDate(unixSec: number): string {
  if (!Number.isFinite(unixSec) || unixSec <= 0) return "Timestamp unavailable in direct RPC mode";
  return new Date(unixSec * 1000).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function clampText(s: string, max = 48): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/**
 * NFT names, collection names and symbols come from untrusted metadata.
 * They are rendered as text nodes only (never innerHTML); this scrubber
 * additionally strips control characters and zero-width tricks.
 */
export function sanitizeLabel(raw: string | undefined | null, fallback: string): string {
  if (!raw) return fallback;
  const cleaned = raw.replace(/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, "").trim();
  return cleaned.length === 0 ? fallback : clampText(cleaned, 64);
}
