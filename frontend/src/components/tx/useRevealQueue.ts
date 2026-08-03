"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAccountState } from "@/protocol/provider";
import { usePositions } from "@/state/queries";
import type { AcquisitionTicket } from "@/protocol/types";

/**
 * Queue of acquisition allocations that deserve a full-screen reveal.
 *
 * A reveal fires only for a ticket that *transitions* into `allocated` while
 * this session is watching. Two guards keep it from firing again:
 *  - the first observed positions snapshot only primes the seen-set (so
 *    positions allocated before the app opened never pop), and
 *  - every revealed requestId is written to sessionStorage, so a refetch, a
 *    remount or a page reload inside the same tab stays quiet.
 */

const STORAGE_KEY = "hwa.revealed";

/**
 * How recent an allocation has to be for the first snapshot to still open it.
 *
 * Priming used to swallow every allocation already present when the queue
 * mounted, and wrote those ids to sessionStorage, so a reload while the
 * randomness was still settling burned the reveal permanently. A draw the user
 * just paid for is theirs to see; only allocations old enough to belong to an
 * earlier visit are skipped.
 */
const PRIME_GRACE_SEC = 30 * 60;

export interface RevealQueue {
  /** Listing id to reveal, or null when nothing is queued. */
  current: bigint | null;
  currentRequestId: bigint | null;
  currentTicket: AcquisitionTicket | null;
  /** 1-based position in the current batch. */
  index: number;
  /** Size of the current batch (1 for a single allocation). */
  total: number;
  hasNext: boolean;
  /** Advance to the next allocation of the batch. */
  next: () => void;
  /** Close the reveal and drop everything still queued. */
  dismiss: () => void;
}

interface QueuedReveal {
  requestId: string;
  listingId: bigint;
  ticket: AcquisitionTicket;
}

function readSeen(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((v): v is string => typeof v === "string"));
  } catch {
    return new Set();
  }
}

function persistSeen(seen: Set<string>): void {
  if (typeof window === "undefined") return;
  try {
    // Bounded: only the tail matters, older ids can never come back in-flight.
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify([...seen].slice(-200)));
  } catch {
    /* private mode / quota — the in-memory ref still prevents repeats */
  }
}

export function useRevealQueue(): RevealQueue {
  const { data: positions } = usePositions();
  const account = useAccountState();
  const address = account.address ?? "";

  const seenRef = useRef<Set<string> | null>(null);
  const primedRef = useRef(false);
  const accountRef = useRef(address);
  const [queue, setQueue] = useState<QueuedReveal[]>([]);
  const [consumed, setConsumed] = useState(0);

  useEffect(() => {
    if (seenRef.current === null || accountRef.current !== address) {
      // First run, or the connected account changed: re-prime from scratch.
      // Done before the data guard so a disconnect drops anything still queued
      // rather than leaving another account's reveal on screen.
      accountRef.current = address;
      seenRef.current = readSeen();
      primedRef.current = false;
      setQueue([]);
    }
    const seen = seenRef.current;

    const tickets = positions?.pendingAcquisitions;
    if (!tickets) return;

    const fresh: QueuedReveal[] = [];
    let added = false;
    const nowSec = Math.floor(Date.now() / 1000);
    for (const t of tickets) {
      if (t.phase !== "allocated" || t.listingId === undefined) continue;
      const key = t.requestId.toString();
      if (seen.has(key)) continue;
      seen.add(key);
      added = true;
      const fromAnEarlierVisit = !primedRef.current && nowSec - t.requestedAt > PRIME_GRACE_SEC;
      if (!fromAnEarlierVisit) fresh.push({ requestId: key, listingId: t.listingId, ticket: { ...t } });
    }
    if (added) persistSeen(seen);
    primedRef.current = true;
    if (fresh.length > 0) setQueue((q) => [...q, ...fresh]);
  }, [positions, address]);

  // A finished batch restarts its "n of N" counter.
  useEffect(() => {
    if (queue.length === 0 && consumed !== 0) setConsumed(0);
  }, [queue.length, consumed]);

  const next = useCallback(() => {
    setQueue((q) => q.slice(1));
    setConsumed((c) => c + 1);
  }, []);

  const dismiss = useCallback(() => {
    setQueue([]);
    setConsumed(0);
  }, []);

  const head = queue[0];
  return {
    current: head?.listingId ?? null,
    currentRequestId: head ? BigInt(head.requestId) : null,
    currentTicket: head?.ticket ?? null,
    index: consumed + 1,
    total: consumed + queue.length,
    hasNext: queue.length > 1,
    next,
    dismiss,
  };
}
