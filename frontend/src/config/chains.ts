import { defineChain, type Chain } from "viem";

/**
 * HyperEVM chain definitions. These are the EVM chains of Hyperliquid —
 * distinct from HyperCore (the L1 order-book state). This app talks to
 * HyperEVM only; every user-facing label must keep that distinction explicit.
 *
 * Verified parameters (FWA_PARITY_MANIFEST.md §2):
 *  - testnet chain id 998, primary RPC https://rpcs.chain.link/hyperevm/testnet
 *    with the Hyperliquid public endpoint kept as a fallback
 *  - mainnet chain id 999, RPC https://rpc.hyperliquid.xyz/evm
 *  - native asset HYPE, 18 decimals
 */

export const hyperevmTestnet: Chain = defineChain({
  id: 998,
  name: "HyperEVM Testnet",
  nativeCurrency: { name: "HYPE", symbol: "HYPE", decimals: 18 },
  rpcUrls: {
    default: {
      http: [
        "https://rpcs.chain.link/hyperevm/testnet",
        "https://rpc.hyperliquid-testnet.xyz/evm",
      ],
    },
  },
  testnet: true,
});

export const hyperevmMainnet: Chain = defineChain({
  id: 999,
  name: "HyperEVM",
  nativeCurrency: { name: "HYPE", symbol: "HYPE", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://rpc.hyperliquid.xyz/evm"] },
  },
});

export function chainById(id: 998 | 999): Chain {
  return id === 998 ? hyperevmTestnet : hyperevmMainnet;
}

export function chainLabel(id: number | undefined): string {
  if (id === 998) return "HyperEVM Testnet";
  if (id === 999) return "HyperEVM Mainnet";
  if (id === undefined) return "No network";
  return `Unsupported network (${id})`;
}
