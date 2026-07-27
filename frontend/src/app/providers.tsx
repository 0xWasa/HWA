"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { WagmiProvider } from "wagmi";
import { isMockMode } from "@/config/env";
import { ProtocolProvider } from "@/protocol/provider";
import { wagmiConfig } from "@/wallet/wagmi";

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 3_000,
            refetchOnWindowFocus: true,
            retry: 1,
          },
        },
      }),
  );

  const tree = <ProtocolProvider>{children}</ProtocolProvider>;

  return (
    <QueryClientProvider client={queryClient}>
      {isMockMode ? tree : <WagmiProvider config={wagmiConfig}>{tree}</WagmiProvider>}
    </QueryClientProvider>
  );
}
