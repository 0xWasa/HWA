"use client";

import { env, isMockMode } from "@/config/env";
import { chainLabel } from "@/config/chains";
import { useAccountState, useProtocol } from "@/protocol/provider";
import { useConnectionHealth } from "@/state/queries";

/**
 * Single slim status bar under the top bar. Shows the most important
 * environment condition; never blocks the UI. Mock data can never pass as
 * live data: the mock notice always wins.
 */
export function EnvBanner() {
  const { scenario, manifestState, writesEnabled, prelaunch } = useProtocol();
  const account = useAccountState();
  const { data: health } = useConnectionHealth();

  const items: { tone: "accent" | "amber" | "red" | "blue"; text: string; testid?: string }[] = [];

  if (isMockMode) {
    items.push({
      tone: "blue",
      text: `MOCK DATA — simulated protocol, no real transactions${
        scenario && scenario.id !== "default" ? ` · scenario: ${scenario.label}` : ""
      }`,
      testid: "banner-mock",
    });
  } else if (prelaunch) {
    items.push({
      tone: "amber",
      text: "PRE-LAUNCH — HyperEVM mainnet contracts are not deployed; transactions are locked",
      testid: "banner-prelaunch",
    });
  } else if (!writesEnabled) {
    const reason =
      manifestState.status === "wrong-chain"
        ? `manifest targets chain ${"manifestChainId" in manifestState ? manifestState.manifestChainId : "?"}, app expects ${env.chainId}`
        : manifestState.status === "invalid"
          ? "deployment manifest invalid"
          : manifestState.status === "ready"
            ? "deployment manifest has features.writesEnabled=false"
            : "no deployment manifest";
    const bannerText = manifestState.status === "ready" && env.chainId === 999
      ? "PROTOCOL PAUSED / LAUNCH PENDING - all public operations disabled"
      : `READ-ONLY - writes disabled (${reason})`;
    items.push({ tone: "amber", text: bannerText, testid: "banner-readonly" });
  } else if (env.chainId === 998) {
    items.push({ tone: "amber", text: "HyperEVM TESTNET — assets have no value", testid: "banner-testnet" });
  }

  if (account.status === "connected" && account.isWrongNetwork) {
    items.push({
      tone: "red",
      text: `Wallet on ${chainLabel(account.chainId)} — switch to ${chainLabel(env.chainId)} to transact`,
      testid: "banner-wrong-network",
    });
  }
  if (health?.rpc === "down") {
    items.push({
      tone: "red",
      text: "RPC unreachable — contract reads and quotes are paused; the wallet may still submit an emergency exit",
      testid: "banner-rpc-down",
    });
  } else if (health?.indexer.status === "down") {
    items.push({
      tone: "red",
      text: "Indexer unavailable — history and position discovery are paused; contract balances remain authoritative",
      testid: "banner-indexer-down",
    });
  } else if (health && health.indexer.status === "lagging") {
    items.push({
      tone: "amber",
      text: `Indexer ${health.indexer.lagBlocks} blocks behind — history may lag; prices and balances stay on-chain`,
      testid: "banner-indexer-lag",
    });
  }

  if (items.length === 0) return null;

  return (
    <div role="status" className="border-b border-line-subtle">
      {items.slice(0, 2).map((item) => (
        <div
          key={item.text}
          data-testid={item.testid}
          className={`flex h-7 items-center justify-center gap-2 px-3 text-2xs font-medium ${
            item.tone === "red"
              ? "bg-red/10 text-red"
              : item.tone === "amber"
                ? "bg-amber/10 text-amber"
                : item.tone === "blue"
                  ? "bg-blue/10 text-blue"
                  : "bg-accent/10 text-accent"
          }`}
        >
          <span aria-hidden className="size-1 rounded-full bg-current" />
          <span className="truncate">{item.text}</span>
        </div>
      ))}
    </div>
  );
}
