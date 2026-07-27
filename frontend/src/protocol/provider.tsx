"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAccount, useConnect, useDisconnect, useSwitchChain } from "wagmi";
import { env, isMockMode } from "@/config/env";
import { loadManifest, type ManifestState } from "@/config/manifest";
import type { Address } from "@/protocol/types";
import type { ProtocolClient, ProtocolEvent } from "./client";
import { MockEngine } from "./mock/engine";
import { MockProtocolClient } from "./mock/MockProtocolClient";
import { resolveScenarioId, SCENARIOS, type ScenarioConfig } from "./mock/scenarios";
import { ViemProtocolClient } from "./viem/ViemProtocolClient";

export interface AccountState {
  status: "disconnected" | "connecting" | "connected";
  address?: Address;
  chainId?: number;
  /** Connected on a chain other than the configured HyperEVM chain. */
  isWrongNetwork: boolean;
  /** Last switch request was refused by the wallet. */
  switchRefused: boolean;
  connect: () => void;
  disconnect: () => void;
  switchToAppNetwork: () => Promise<boolean>;
}

interface ProtocolContextValue {
  client: ProtocolClient | null;
  /** Present in mock mode only — powers the dev panel. */
  engine: MockEngine | null;
  scenario: ScenarioConfig | null;
  manifestState: ManifestState;
  account: AccountState;
  /** True when a valid manifest (or the mock) allows writes. */
  writesEnabled: boolean;
  /** Emergency-safe exits remain available when risk-increasing writes are disabled. */
  exitWritesEnabled: boolean;
}

const ProtocolContext = createContext<ProtocolContextValue | null>(null);

export function useProtocol(): ProtocolContextValue {
  const ctx = useContext(ProtocolContext);
  if (!ctx) throw new Error("useProtocol must be used inside <ProtocolProvider>");
  return ctx;
}

/** The client, asserted present. Screens behind loading guards use this. */
export function useProtocolClient(): ProtocolClient {
  const { client } = useProtocol();
  if (!client) throw new Error("Protocol client not ready");
  return client;
}

export function useAccountState(): AccountState {
  return useProtocol().account;
}

// ------------------------------------------------------------------ events

function useEventInvalidation(client: ProtocolClient | null, freezeQuote = false) {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!client) return;
    return client.subscribe((e: ProtocolEvent) => {
      switch (e.scope) {
        case "tx":
          void queryClient.invalidateQueries({ queryKey: ["txs"] });
          break;
        case "pool":
          void queryClient.invalidateQueries({ queryKey: ["pool"] });
          // In the staleQuote scenario the quote must be allowed to rot so the
          // stale state and pre-signature revalidation can be exercised.
          if (!freezeQuote) void queryClient.invalidateQueries({ queryKey: ["quote"] });
          break;
        case "listings":
          void queryClient.invalidateQueries({ queryKey: ["listings"] });
          void queryClient.invalidateQueries({ queryKey: ["listing"] });
          break;
        case "positions":
          void queryClient.invalidateQueries({ queryKey: ["purchaseStats"] });
          void queryClient.invalidateQueries({ queryKey: ["positions"] });
          void queryClient.invalidateQueries({ queryKey: ["ownedNfts"] });
          void queryClient.invalidateQueries({ queryKey: ["balance"] });
          void queryClient.invalidateQueries({ queryKey: ["settlement"] });
          break;
        case "activity":
          void queryClient.invalidateQueries({ queryKey: ["activity"] });
          break;
        case "rewards":
          void queryClient.invalidateQueries({ queryKey: ["rewards"] });
          void queryClient.invalidateQueries({ queryKey: ["tokenMarket"] });
          break;
        case "health":
          void queryClient.invalidateQueries({ queryKey: ["health"] });
          break;
        case "wallet":
          void queryClient.invalidateQueries({ queryKey: ["balance"] });
          void queryClient.invalidateQueries({ queryKey: ["positions"] });
          break;
      }
    });
  }, [client, queryClient, freezeQuote]);
}

// --------------------------------------------------------------- mock root

function MockProtocolRoot({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const engineRef = useRef<MockEngine | null>(null);
  const clientRef = useRef<MockProtocolClient | null>(null);
  const [scenario, setScenarioState] = useState<ScenarioConfig | null>(null);
  const [, forceRender] = useState(0);

  useEffect(() => {
    const sc = SCENARIOS[resolveScenarioId()];
    const engine = new MockEngine(sc);
    engineRef.current = engine;
    clientRef.current = new MockProtocolClient(engine);
    setScenarioState(sc);
    setReady(true);
    const unsub = engine.subscribe((e) => {
      if (e.scope === "wallet") forceRender((n) => n + 1);
    });
    return () => {
      unsub();
      engine.destroy();
      engineRef.current = null;
      clientRef.current = null;
    };
  }, []);

  useEventInvalidation(ready ? clientRef.current : null, scenario?.freezeQuote ?? false);

  const engine = engineRef.current;
  const wallet = engine?.world.wallet;
  const appChainId = env.chainId;

  const account: AccountState = useMemo(
    () => ({
      status: wallet?.status ?? "disconnected",
      address: wallet?.status === "connected" ? wallet.address : undefined,
      chainId: wallet?.status === "connected" ? wallet.chainId : undefined,
      isWrongNetwork: wallet?.status === "connected" && wallet.chainId !== appChainId,
      switchRefused: scenario?.refuseSwitch ?? false,
      connect: () => engine?.connectWallet(),
      disconnect: () => engine?.disconnectWallet(),
      switchToAppNetwork: async () => (engine ? engine.switchNetwork(appChainId) : false),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [engine, wallet?.status, wallet?.chainId, appChainId, scenario],
  );

  const value: ProtocolContextValue = useMemo(
    () => ({
      client: ready ? clientRef.current : null,
      engine: ready ? engineRef.current : null,
      scenario,
      // No manifest concept in mock mode; writes are enabled by construction.
      manifestState: { status: "absent" } satisfies ManifestState,
      account,
      writesEnabled: true,
      exitWritesEnabled: true,
    }),
    [ready, scenario, account],
  );

  return <ProtocolContext.Provider value={value}>{children}</ProtocolContext.Provider>;
}

// --------------------------------------------------------------- viem root

function ViemProtocolRoot({ children }: { children: ReactNode }) {
  const [manifestState, setManifestState] = useState<ManifestState>({ status: "absent" });
  const [client, setClient] = useState<ProtocolClient | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadManifest(env.manifestUrl, env.chainId).then((state) => {
      if (cancelled) return;
      setManifestState(state);
      if (state.status === "ready") {
        const liveClient = new ViemProtocolClient(
          state.manifest,
          env.rpcUrl,
          env.chainId,
          env.indexerUrl,
          env.logRpcUrl,
          env.logRpcMaxBlockRange,
        );
        liveClient.resumeTracking();
        setClient(liveClient);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEventInvalidation(client);

  const { address, chainId, status } = useAccount();
  const { connect, connectors } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChainAsync } = useSwitchChain();
  const [switchRefused, setSwitchRefused] = useState(false);

  const account: AccountState = useMemo(
    () => ({
      status: status === "connected" ? "connected" : status === "connecting" ? "connecting" : "disconnected",
      address: address as Address | undefined,
      chainId,
      isWrongNetwork: status === "connected" && chainId !== env.chainId,
      switchRefused,
      connect: () => {
        const injected = connectors[0];
        if (injected) connect({ connector: injected });
      },
      disconnect: () => disconnect(),
      switchToAppNetwork: async () => {
        try {
          await switchChainAsync({ chainId: env.chainId });
          setSwitchRefused(false);
          return true;
        } catch {
          setSwitchRefused(true);
          return false;
        }
      },
    }),
    [status, address, chainId, switchRefused, connect, connectors, disconnect, switchChainAsync],
  );

  const value: ProtocolContextValue = useMemo(
    () => ({
      client,
      engine: null,
      scenario: null,
      manifestState,
      account,
      writesEnabled: manifestState.status === "ready" && manifestState.manifest.features.writesEnabled,
      exitWritesEnabled: manifestState.status === "ready",
    }),
    [client, manifestState, account],
  );

  return <ProtocolContext.Provider value={value}>{children}</ProtocolContext.Provider>;
}

export function ProtocolProvider({ children }: { children: ReactNode }) {
  if (isMockMode) return <MockProtocolRoot>{children}</MockProtocolRoot>;
  return <ViemProtocolRoot>{children}</ViemProtocolRoot>;
}
