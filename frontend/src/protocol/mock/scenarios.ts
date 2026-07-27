/**
 * Mock scenarios — deterministic starting states for development, demos and
 * Playwright. Selected with `?scenario=<id>` (persisted for the session) or
 * from the local dev panel. Only available in mock data mode.
 */

export const SCENARIO_IDS = [
  "default",
  "fresh", // connected-capable wallet, zero positions
  "emptyPool",
  "wrongNetwork",
  "switchRefused",
  "indexerLag",
  "rpcDown",
  "staleQuote",
  "poorWallet",
  "slowRandomness",
  "randomnessTimeout",
  "depositorWindow",
  "finalizeReady",
  "rewardsActive",
] as const;

export type ScenarioId = (typeof SCENARIO_IDS)[number];

export interface ScenarioConfig {
  id: ScenarioId;
  label: string;
  description: string;
  emptyPool: boolean;
  /** Wallet chain at connect time (998 = correct). */
  walletChainId: number;
  /** Wallet refuses network switch requests. */
  refuseSwitch: boolean;
  /** HYPE balance of the mock account. */
  balanceHype: bigint;
  userHasHistory: boolean;
  indexerLagBlocks: number;
  rpcDown: boolean;
  /** Pause quote auto-refresh so staleness can be observed. */
  freezeQuote: boolean;
  /** Randomness fulfilment delay in ms; null = never (deadline expiry). */
  randomnessDelayMs: number | null;
  /** Age of the user's allocated listing, seconds (drives settlement windows). */
  allocatedAgeSec: number;
  rewardsActive: boolean;
}

const HYPE = 10n ** 18n;

const base: Omit<ScenarioConfig, "id" | "label" | "description"> = {
  emptyPool: false,
  walletChainId: 998,
  refuseSwitch: false,
  balanceHype: 25n * HYPE + HYPE / 3n,
  userHasHistory: true,
  indexerLagBlocks: 0,
  rpcDown: false,
  freezeQuote: false,
  randomnessDelayMs: 4_200,
  allocatedAgeSec: 3 * 3600, // allocated 3h ago → purchaser window open
  rewardsActive: false,
};

export const SCENARIOS: Record<ScenarioId, ScenarioConfig> = {
  default: {
    ...base,
    id: "default",
    label: "Default",
    description: "Populated pool, user has deposits, an allocation to settle, claimables and history.",
  },
  fresh: {
    ...base,
    id: "fresh",
    label: "Fresh wallet",
    description: "Connected wallet with no positions and no history.",
    userHasHistory: false,
  },
  emptyPool: {
    ...base,
    id: "emptyPool",
    label: "Empty pool",
    description: "No active listings; acquisitions unavailable.",
    emptyPool: true,
    userHasHistory: false,
  },
  wrongNetwork: {
    ...base,
    id: "wrongNetwork",
    label: "Wrong network",
    description: "Wallet connects on chain 1; app prompts to switch to HyperEVM.",
    walletChainId: 1,
  },
  switchRefused: {
    ...base,
    id: "switchRefused",
    label: "Switch refused",
    description: "Wallet on the wrong network and the switch request is refused.",
    walletChainId: 1,
    refuseSwitch: true,
  },
  indexerLag: {
    ...base,
    id: "indexerLag",
    label: "Indexer lagging",
    description: "Indexer 42 blocks behind head — history flagged, critical views stay on-chain.",
    indexerLagBlocks: 42,
  },
  rpcDown: {
    ...base,
    id: "rpcDown",
    label: "RPC down",
    description: "RPC unreachable: indexed data still browsable, writes and quotes paused.",
    rpcDown: true,
  },
  staleQuote: {
    ...base,
    id: "staleQuote",
    label: "Stale quote",
    description: "Quote refresh frozen so the stale state and manual refresh can be exercised.",
    freezeQuote: true,
  },
  poorWallet: {
    ...base,
    id: "poorWallet",
    label: "Insufficient HYPE",
    description: "Balance far below the acquisition price.",
    balanceHype: 4n * (HYPE / 1000n), // 0.004 HYPE
  },
  slowRandomness: {
    ...base,
    id: "slowRandomness",
    label: "Slow randomness",
    description: "Randomness fulfilment takes ~45s — long-pending state visible.",
    randomnessDelayMs: 45_000,
  },
  randomnessTimeout: {
    ...base,
    id: "randomnessTimeout",
    label: "Randomness timeout",
    description: "The word never arrives; the request expires and a refund is credited.",
    randomnessDelayMs: null,
  },
  depositorWindow: {
    ...base,
    id: "depositorWindow",
    label: "Depositor window",
    description: "User's allocation is older than 24h — the depositor may resolve.",
    allocatedAgeSec: 26 * 3600,
  },
  finalizeReady: {
    ...base,
    id: "finalizeReady",
    label: "Finalize ready",
    description: "Allocation older than 7 days — anyone can finalize the default outcome.",
    allocatedAgeSec: 8 * 24 * 3600,
  },
  rewardsActive: {
    ...base,
    id: "rewardsActive",
    label: "Rewards active",
    description: "HWA rewards module activated with live emissions and user balances.",
    rewardsActive: true,
  },
};

const STORAGE_KEY = "fwa.mock.scenario";

export function resolveScenarioId(): ScenarioId {
  if (typeof window === "undefined") return "default";
  const fromQuery = new URLSearchParams(window.location.search).get("scenario");
  if (fromQuery && (SCENARIO_IDS as readonly string[]).includes(fromQuery)) {
    sessionStorage.setItem(STORAGE_KEY, fromQuery);
    return fromQuery as ScenarioId;
  }
  const stored = sessionStorage.getItem(STORAGE_KEY);
  if (stored && (SCENARIO_IDS as readonly string[]).includes(stored)) return stored as ScenarioId;
  return "default";
}

export function setScenario(id: ScenarioId): void {
  sessionStorage.setItem(STORAGE_KEY, id);
  const url = new URL(window.location.href);
  url.searchParams.set("scenario", id);
  // Full reload: a scenario is a different world, not a state patch.
  window.location.href = url.toString();
}
