"use client";

import { useCallback, useRef, useState } from "react";
import { describeError } from "@/protocol/errors";
import { useProtocol } from "@/protocol/provider";
import type { ProtocolClient } from "@/protocol/client";
import type { TrackedTransaction } from "@/protocol/types";

export interface ActionError {
  title: string;
  detail?: string;
  raw?: string;
}

/**
 * Wraps a ProtocolClient write: pre-flight guard errors (wrong network, stale
 * quote, insufficient balance…) surface as inline, actionable errors; once a
 * TrackedTransaction exists, progress is followed through the tx store.
 */
export function useProtocolAction() {
  const { client } = useProtocol();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ActionError | null>(null);
  const [lastTxId, setLastTxId] = useState<string | null>(null);
  const runInFlightRef = useRef(false);

  const run = useCallback(
    async (fn: (client: ProtocolClient) => Promise<TrackedTransaction>): Promise<TrackedTransaction | null> => {
      if (!client) {
        setError({ title: "Protocol client not ready" });
        return null;
      }
      if (runInFlightRef.current) return null;
      runInFlightRef.current = true;
      setSubmitting(true);
      setError(null);
      try {
        const tx = await fn(client);
        setLastTxId(tx.id);
        return tx;
      } catch (err) {
        setError(describeError(err));
        return null;
      } finally {
        runInFlightRef.current = false;
        setSubmitting(false);
      }
    },
    [client],
  );

  const clearError = useCallback(() => setError(null), []);

  return { run, submitting, error, clearError, lastTxId };
}
