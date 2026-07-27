"use client";

import { env } from "@/config/env";
import { shortAddress, shortHash } from "@/lib/format";

/**
 * Tx hash / address rendering. Links to the configured explorer when one
 * exists; otherwise copies to clipboard (mock mode has no real explorer —
 * fake hashes must not link anywhere).
 */
export function HashLink({ value, kind }: { value: string; kind: "tx" | "address" }) {
  const label = kind === "tx" ? shortHash(value) : shortAddress(value);
  if (env.explorerUrl) {
    const path = kind === "tx" ? "tx" : "address";
    return (
      <a
        href={`${env.explorerUrl.replace(/\/$/, "")}/${path}/${value}`}
        target="_blank"
        rel="noopener noreferrer"
        className="num font-mono text-2xs text-blue hover:underline"
        title={value}
      >
        {label} ↗
      </a>
    );
  }
  return (
    <button
      type="button"
      title={`${value} — click to copy`}
      onClick={() => void navigator.clipboard?.writeText(value)}
      className="num font-mono text-2xs text-mute hover:text-dim"
    >
      {label}
    </button>
  );
}
