import { z } from "zod";

/**
 * Deployment manifest — the single source of truth for contract addresses.
 *
 * The contracts pipeline publishes this JSON after each testnet/mainnet
 * deployment (see INTEGRATION_NEEDS.md). Addresses are never hardcoded in
 * components; if the manifest is missing, malformed, or targets another chain
 * id, writes stay disabled and the UI shows an explicit degraded state.
 */

const AddressSchema = z
  .string()
  .regex(/^0x[a-fA-F0-9]{40}$/, "invalid address")
  .transform((a) => a as `0x${string}`);

export const DeploymentManifestSchema = z.object({
  schemaVersion: z.literal(1),
  chainId: z.union([z.literal(998), z.literal(999)]),
  deployedAtBlock: z.number().int().nonnegative().optional(),
  contracts: z.object({
    fwa: AddressSchema,
    whitelist: AddressSchema,
    vrfService: AddressSchema,
    randomnessCoordinator: AddressSchema,
    randomnessRegistry: AddressSchema.optional(),
    splitter: AddressSchema,
    rewards: AddressSchema.optional(),
    token: AddressSchema.optional(),
    projectXAdapter: AddressSchema.optional(),
    projectXPool: AddressSchema.optional(),
    projectXLiquidityLocker: AddressSchema.optional(),
    ecosystemVesting: AddressSchema.optional(),
    snapshotNft: AddressSchema.optional(),
  }),
  features: z
    .object({
      writesEnabled: z.boolean().default(false),
      depositsEnabled: z.boolean().default(false),
      acquisitionsEnabled: z.boolean().default(false),
      rewardClaimsEnabled: z.boolean().default(false),
      externalBuysEnabled: z.boolean().default(false),
      randomnessMode: z.enum(["drand-relay-testnet", "drand-bn254"]).default("drand-relay-testnet"),
      dexMode: z.enum(["projectx-v3-compat-testnet", "projectx"]).default("projectx-v3-compat-testnet"),
    })
    .default({
      writesEnabled: false,
      depositsEnabled: false,
      acquisitionsEnabled: false,
      rewardClaimsEnabled: false,
      externalBuysEnabled: false,
      randomnessMode: "drand-relay-testnet",
      dexMode: "projectx-v3-compat-testnet",
    }),
  links: z
    .object({
      projectXTradeUrl: z.string().url().optional(),
    })
    .optional(),
  collections: z
    .array(
      z.object({
        address: AddressSchema,
        name: z.string().max(120),
        symbol: z.string().max(24).optional(),
        deploymentBlock: z.number().int().nonnegative().optional(),
        maxTokenId: z.number().int().positive().max(10_000).optional(),
        testnetFixture: z.boolean().default(false),
        snapshotCollection: z.boolean().default(false),
      }),
    )
    .default([]),
}).superRefine((manifest, context) => {
  if (manifest.chainId !== 999) return;
  const snapshot = manifest.contracts.snapshotNft;
  if (!snapshot) {
    context.addIssue({ code: "custom", path: ["contracts", "snapshotNft"], message: "mainnet snapshotNft is required" });
    return;
  }
  if (!manifest.collections.some((collection) => collection.address.toLowerCase() === snapshot.toLowerCase() && collection.snapshotCollection)) {
    context.addIssue({ code: "custom", path: ["collections"], message: "mainnet snapshot collection must be indexed" });
  }
});

export type DeploymentManifest = z.infer<typeof DeploymentManifestSchema>;

export type ManifestState =
  | { status: "absent" }
  | { status: "invalid"; reason: string }
  | { status: "wrong-chain"; manifestChainId: number; expected: number }
  | { status: "ready"; manifest: DeploymentManifest };

export async function loadManifest(url: string, expectedChainId: 998 | 999): Promise<ManifestState> {
  if (!url) return { status: "absent" };
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (res.status === 404) return { status: "absent" };
    if (!res.ok) return { status: "invalid", reason: `HTTP ${res.status}` };
    const json: unknown = await res.json();
    const parsed = DeploymentManifestSchema.safeParse(json);
    if (!parsed.success) {
      return { status: "invalid", reason: parsed.error.issues[0]?.message ?? "schema mismatch" };
    }
    if (parsed.data.chainId !== expectedChainId) {
      return { status: "wrong-chain", manifestChainId: parsed.data.chainId, expected: expectedChainId };
    }
    return { status: "ready", manifest: parsed.data };
  } catch (err) {
    return { status: "invalid", reason: err instanceof Error ? err.message : "fetch failed" };
  }
}
