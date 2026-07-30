"use client";

import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { QUOTE_FRESH_MS, QUOTE_REFRESH_MS } from "@/protocol/params";
import { useProtocol } from "@/protocol/provider";
import type { ActivityQuery, ListingsQuery } from "@/protocol/types";

/**
 * Data hooks — thin, typed wrappers over the ProtocolClient. Serialization of
 * bigint-bearing query keys goes through String() only; values stay bigint.
 */

export function usePoolSnapshot() {
  const { client } = useProtocol();
  return useQuery({
    queryKey: ["pool"],
    queryFn: () => client!.getPoolSnapshot(),
    enabled: !!client,
    refetchInterval: 6_000,
  });
}

export function useListings(query: ListingsQuery) {
  const { client } = useProtocol();
  return useQuery({
    queryKey: [
      "listings",
      query.view,
      query.search ?? "",
      (query.collections ?? []).join(","),
      (query.rarities ?? []).join(","),
      (query.statuses ?? []).join(","),
      query.sort,
      query.direction,
      query.cursor ?? "0",
      query.limit,
    ],
    queryFn: () => client!.getListings(query),
    enabled: !!client,
    placeholderData: (prev) => prev,
  });
}

export function useListing(id: bigint | null) {
  const { client } = useProtocol();
  return useQuery({
    queryKey: ["listing", id === null ? "" : id.toString()],
    queryFn: () => client!.getListing(id!),
    enabled: !!client && id !== null,
  });
}

export function useActivity(query: ActivityQuery) {
  const { client } = useProtocol();
  return useQuery({
    queryKey: [
      "activity",
      query.scope,
      query.account ?? "",
      (query.types ?? []).join(","),
      (query.collections ?? []).join(","),
      query.cursor ?? "0",
      query.limit,
    ],
    queryFn: () => client!.getActivity(query),
    enabled: !!client,
    refetchInterval: 30_000,
    staleTime: 15_000,
    placeholderData: (prev) => prev,
  });
}

export function usePositions() {
  const { client, account } = useProtocol();
  return useQuery({
    queryKey: ["positions", account.address ?? ""],
    queryFn: () => client!.getUserPositions(account.address!),
    enabled: !!client && account.status === "connected" && !!account.address,
  });
}

export function useRewards() {
  const { client, account } = useProtocol();
  return useQuery({
    queryKey: ["rewards", account.address ?? ""],
    queryFn: () => client!.getRewards(account.address),
    enabled: !!client,
  });
}

export function useOwnedNfts() {
  const { client, account } = useProtocol();
  return useQuery({
    queryKey: ["ownedNfts", account.address ?? ""],
    queryFn: () => client!.getOwnedEligibleNFTs(account.address!),
    enabled: !!client && account.status === "connected" && !!account.address,
  });
}

export function useCollections() {
  const { client } = useProtocol();
  return useQuery({
    queryKey: ["collections"],
    queryFn: () => client!.getCollections(),
    enabled: !!client,
    staleTime: 60_000,
  });
}

export function useNativeBalance() {
  const { client, account } = useProtocol();
  return useQuery({
    queryKey: ["balance", account.address ?? ""],
    queryFn: () => client!.getNativeBalance(account.address!),
    enabled: !!client && account.status === "connected" && !!account.address,
    refetchInterval: 8_000,
  });
}

export function useSettlementInfo(listingId: bigint | null) {
  const { client } = useProtocol();
  return useQuery({
    queryKey: ["settlement", listingId === null ? "" : listingId.toString()],
    queryFn: () => client!.getSettlementInfo(listingId!),
    enabled: !!client && listingId !== null,
    refetchInterval: 30_000,
  });
}

export function useTokenMarket() {
  const { client, account } = useProtocol();
  return useQuery({
    queryKey: ["tokenMarket", account.address ?? ""],
    queryFn: () => client!.getTokenMarket(account.address),
    enabled: !!client,
    refetchInterval: 15_000,
  });
}

export function usePurchaseStats() {
  const { client, account } = useProtocol();
  return useQuery({
    queryKey: ["purchaseStats", account.address ?? ""],
    queryFn: () => client!.getPurchaseStats(account.address!),
    enabled: !!client && account.status === "connected" && !!account.address,
  });
}

export function useSwapQuote(side: "buy" | "sell", amountIn: bigint | null, slippageBps: number) {
  const { client } = useProtocol();
  return useQuery({
    queryKey: ["swapQuote", side, amountIn?.toString() ?? "", slippageBps],
    queryFn: () => client!.quoteSwap({ side, amountIn: amountIn!, slippageBps }),
    enabled: !!client && amountIn !== null && amountIn > 0n,
    refetchInterval: 10_000,
    retry: 0,
  });
}

export function useConnectionHealth() {
  const { client } = useProtocol();
  return useQuery({
    queryKey: ["health"],
    queryFn: () => client!.getConnectionHealth(),
    enabled: !!client,
    refetchInterval: 30_000,
    staleTime: 15_000,
    retry: 1,
  });
}

export function useTrackedTxs() {
  const { client } = useProtocol();
  return useQuery({
    queryKey: ["txs"],
    queryFn: () => Promise.resolve(client!.getTrackedTransactions()),
    enabled: !!client,
  });
}

export type QuoteFreshness = "fresh" | "stale" | "refreshing";

/**
 * Acquisition quote with explicit freshness. Auto-refreshes while mounted
 * unless the scenario freezes it (staleQuote); manual refresh always works.
 */
export function useAcquisitionQuote(quantity: number, driftToleranceBps: number) {
  const { client, scenario } = useProtocol();
  const frozen = scenario?.freezeQuote ?? false;
  const query = useQuery({
    queryKey: ["quote", quantity, driftToleranceBps],
    queryFn: () => client!.quoteAcquisition({ quantity, driftToleranceBps }),
    enabled: !!client,
    refetchInterval: frozen ? false : QUOTE_REFRESH_MS,
    refetchOnWindowFocus: !frozen,
    retry: 0,
  });

  // Freshness clock — re-evaluated every second while a quote is on screen.
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1_000);
    return () => clearInterval(t);
  }, []);

  let freshness: QuoteFreshness = "fresh";
  if (query.isFetching) freshness = "refreshing";
  else if (query.data && Date.now() - query.data.quotedAt * 1000 > QUOTE_FRESH_MS) freshness = "stale";

  const refresh = useCallback(() => {
    void query.refetch();
  }, [query]);

  return { ...query, freshness, refresh };
}
