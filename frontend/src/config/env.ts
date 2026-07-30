import { z } from "zod";

/**
 * Public runtime configuration. Everything here ships to the browser; secrets
 * are forbidden by construction. Values are read once, validated with zod and
 * frozen — components never read process.env directly.
 */

const EnvSchema = z.object({
  appEnv: z
    .enum(["development", "staging", "production"])
    .default("development"),
  dataMode: z.enum(["mock", "testnet", "mainnet"]).default("mock"),
  chainId: z
    .string()
    .default("998")
    .transform((v) => Number.parseInt(v, 10))
    .pipe(z.union([z.literal(998), z.literal(999)])),
  rpcUrl: z
    .string()
    .refine(
      (value) => value === "" || value.startsWith("/") || URL.canParse(value),
      "invalid RPC URL",
    )
    .default(""),
  logRpcUrl: z
    .string()
    .refine(
      (value) => value === "" || value.startsWith("/") || URL.canParse(value),
      "invalid log RPC URL",
    )
    .default(""),
  logRpcMaxBlockRange: z.coerce.number().int().nonnegative().default(0),
  indexerUrl: z.string().url().or(z.literal("")).default(""),
  explorerUrl: z.string().url().or(z.literal("")).default(""),
  // A deployment manifest may be served by the app itself (`/deployments/...`)
  // or by an absolute URL in hosted environments.
  manifestUrl: z
    .string()
    .refine(
      (value) => value === "" || value.startsWith("/") || URL.canParse(value),
      "invalid manifest URL",
    )
    .default(""),
});

export type AppEnv = z.infer<typeof EnvSchema>;

function readEnv(): AppEnv {
  const parsed = EnvSchema.safeParse({
    appEnv: process.env.NEXT_PUBLIC_APP_ENV ?? undefined,
    dataMode: process.env.NEXT_PUBLIC_DATA_MODE ?? undefined,
    chainId: process.env.NEXT_PUBLIC_HYPEREVM_CHAIN_ID ?? undefined,
    rpcUrl: process.env.NEXT_PUBLIC_HYPEREVM_RPC_URL ?? undefined,
    logRpcUrl: process.env.NEXT_PUBLIC_HYPEREVM_LOG_RPC_URL ?? undefined,
    logRpcMaxBlockRange:
      process.env.NEXT_PUBLIC_HYPEREVM_LOG_RPC_MAX_BLOCK_RANGE ?? undefined,
    indexerUrl: process.env.NEXT_PUBLIC_INDEXER_URL ?? undefined,
    explorerUrl: process.env.NEXT_PUBLIC_EXPLORER_URL ?? undefined,
    manifestUrl: process.env.NEXT_PUBLIC_DEPLOYMENT_MANIFEST_URL ?? undefined,
  });
  if (!parsed.success) {
    // Misconfiguration must never silently enable writes: fall back to the
    // safest possible mode and surface the problem in the UI banner.
    return {
      appEnv: "development",
      dataMode: "mock",
      chainId: 998,
      rpcUrl: "",
      logRpcUrl: "",
      logRpcMaxBlockRange: 0,
      indexerUrl: "",
      explorerUrl: "",
      manifestUrl: "",
    };
  }
  return parsed.data;
}

export const env: Readonly<AppEnv> = Object.freeze(readEnv());

export const isMockMode = env.dataMode === "mock";
export const isDev = env.appEnv === "development";

/** Mock data must never masquerade as live mainnet data. */
export const dataModeLabel =
  env.dataMode === "mock"
    ? "MOCK DATA"
    : env.dataMode === "testnet"
      ? "HyperEVM Testnet"
      : "HyperEVM Mainnet";
