// `injected` comes from wagmi's core entry, NOT the `wagmi/connectors` barrel:
// the barrel drags in every third-party connector (Base account → cdp-sdk) and
// their optional dependencies, which breaks the build and bloats the bundle.
import { createConfig, injected } from "wagmi";
import { fallback, http } from "viem";
import { hyperevmMainnet, hyperevmTestnet } from "@/config/chains";
import { env } from "@/config/env";

/**
 * wagmi configuration for testnet/mainnet modes. Injected wallets only —
 * WalletConnect would require a project id and is out of scope until the
 * testnet deployment exists. Never auto-connects: connection is always an
 * explicit user action.
 */
export const wagmiConfig = createConfig({
  chains: env.chainId === 999 ? [hyperevmMainnet, hyperevmTestnet] : [hyperevmTestnet, hyperevmMainnet],
  connectors: [injected()],
  transports: {
    [hyperevmTestnet.id]: fallback([
      http(env.chainId === 998 && env.rpcUrl ? env.rpcUrl : "https://rpcs.chain.link/hyperevm/testnet", {
        batch: { batchSize: 40, wait: 20 },
        retryCount: 1,
        retryDelay: 500,
      }),
      http("https://rpc.hyperliquid-testnet.xyz/evm", {
        batch: { batchSize: 20, wait: 40 },
        retryCount: 1,
        retryDelay: 750,
      }),
    ]),
    [hyperevmMainnet.id]: http(env.chainId === 999 && env.rpcUrl ? env.rpcUrl : undefined, {
      batch: { batchSize: 40, wait: 20 },
      retryCount: 1,
      retryDelay: 500,
    }),
  },
  ssr: true,
});
