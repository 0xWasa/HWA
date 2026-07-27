"use client";

import { useEffect, useMemo, useState } from "react";
import { formatHype } from "@/lib/units";
import { useProtocol } from "@/protocol/provider";
import type { PoolSnapshot } from "@/protocol/types";
import { usePoolSnapshot } from "@/state/queries";
import { Hype } from "@/components/ui/Hype";
import type { SparkTone } from "@/components/ui/Sparkline";
import { StatCard, type StatSpark } from "@/components/ui/StatCard";

/**
 * The Pool headline stats. The sparklines are built from a rolling history of
 * snapshots observed *by this browser tab since it loaded* — there is no
 * historical series in the data contract (see INTEGRATION_NEEDS.md), so the
 * plot is withheld until enough real samples exist rather than invented.
 */

const HISTORY_CAP = 40;
/** Two points is a straight line between two readings — not yet a trend. */
const MIN_POINTS = 3;

interface HistoryPoint {
  t: number;
  backing: bigint;
  price: bigint;
  crownPot: bigint;
  active: bigint;
}

function sample(s: PoolSnapshot): HistoryPoint {
  return {
    t: s.timestamp,
    backing: s.totalBacking,
    price: s.totalPrice,
    crownPot: s.crown?.pot ?? 0n,
    active: BigInt(s.activeListingCount),
  };
}

function same(a: HistoryPoint, b: HistoryPoint): boolean {
  return (
    a.t === b.t &&
    a.backing === b.backing &&
    a.price === b.price &&
    a.crownPot === b.crownPot &&
    a.active === b.active
  );
}

/** Rolling client-side history of pool snapshots, capped and reset per scenario. */
export function useSnapshotHistory(snapshot: PoolSnapshot | undefined, resetKey: string): HistoryPoint[] {
  const [history, setHistory] = useState<HistoryPoint[]>([]);

  useEffect(() => {
    setHistory([]);
  }, [resetKey]);

  useEffect(() => {
    if (!snapshot) return;
    const next = sample(snapshot);
    setHistory((prev) => {
      const last = prev[prev.length - 1];
      if (last && same(last, next)) return prev;
      const out = [...prev, next];
      return out.length > HISTORY_CAP ? out.slice(out.length - HISTORY_CAP) : out;
    });
  }, [snapshot]);

  return history;
}

/** Change between the first and last sample, in integer bps. */
function changeBps(series: readonly bigint[]): number | undefined {
  const first = series[0];
  const last = series[series.length - 1];
  if (first === undefined || last === undefined || first <= 0n) return undefined;
  return Number(((last - first) * 10_000n) / first);
}

function describe(name: string, series: readonly bigint[], fmt: (v: bigint) => string): string {
  const first = series[0];
  const last = series[series.length - 1];
  if (first === undefined || last === undefined) return name;
  return `${name} since page load: ${series.length} samples, from ${fmt(first)} to ${fmt(last)}.`;
}

const hype = (max: number) => (v: bigint) => `${formatHype(v, { maxDecimals: max })} HYPE`;
const count = (v: bigint) => v.toString();

const NO_SERIES: readonly bigint[] = [];

/** Reserves the plot slot before a trend exists, so the row never jumps and no
 *  series is implied — Sparkline draws a dashed baseline for an empty series. */
function waiting(tone: SparkTone, caption: string): StatSpark {
  return { series: NO_SERIES, tone, caption };
}

export function PoolStatCards({
  snapshot: provided,
  className = "",
}: {
  /** Optional: the caller's already-fetched snapshot (same query key). */
  snapshot?: PoolSnapshot;
  className?: string;
}) {
  const { data: fetched } = usePoolSnapshot();
  const snapshot = provided ?? fetched;
  const { scenario } = useProtocol();
  const history = useSnapshotHistory(snapshot, scenario?.id ?? "live");

  const series = useMemo(
    () => ({
      backing: history.map((p) => p.backing),
      price: history.map((p) => p.price),
      crownPot: history.map((p) => p.crownPot),
      active: history.map((p) => p.active),
    }),
    [history],
  );

  const enough = history.length >= MIN_POINTS;
  const caption = `Since page load · ${history.length} samples`;
  const pending = `Collecting samples · ${history.length}/${MIN_POINTS}`;

  return (
    <div
      className={`grid w-full gap-3 sm:grid-cols-2 xl:grid-cols-4 ${className}`}
      data-testid="pool-stat-cards"
    >
      <StatCard
        label="Total backing"
        testId="stat-total-backing"
        value={snapshot ? <Hype wei={snapshot.totalBacking} maxDecimals={1} /> : undefined}
        sub="HYPE committed across active positions"
        deltaBps={enough ? changeBps(series.backing) : undefined}
        deltaNote="since load"
        spark={
          enough
            ? {
                series: series.backing,
                tone: "accent",
                caption,
                ariaLabel: describe("Total backing", series.backing, hype(1)),
              }
            : waiting("accent", pending)
        }
      />

      <StatCard
        label="Pool price"
        testId="stat-pool-price"
        tone="accent"
        value={snapshot ? <Hype wei={snapshot.totalPrice} /> : undefined}
        sub={
          snapshot
            ? `${formatHype(snapshot.acquisitionFee)} pool + ${formatHype(snapshot.serviceFee)} service`
            : undefined
        }
        deltaBps={enough ? changeBps(series.price) : undefined}
        deltaNote="since load"
        spark={
          enough
            ? {
                series: series.price,
                tone: "accent",
                caption,
                ariaLabel: describe("Pool price", series.price, hype(4)),
              }
            : waiting("accent", pending)
        }
      />

      <StatCard
        label="Crown pot"
        testId="stat-crown-pot"
        tone="amber"
        value={
          snapshot ? (
            snapshot.crown ? (
              <Hype wei={snapshot.crown.pot} maxDecimals={2} />
            ) : (
              "—"
            )
          ) : undefined
        }
        sub={
          snapshot?.crown
            ? `Held by listing #${snapshot.crown.listingId.toString()}`
            : snapshot
              ? "No top deposit yet"
              : undefined
        }
        spark={
          enough && snapshot?.crown
            ? {
                series: series.crownPot,
                tone: "amber",
                caption,
                ariaLabel: describe("Crown pot", series.crownPot, hype(2)),
              }
            : waiting("amber", snapshot && !snapshot.crown ? "No crown activity yet" : pending)
        }
      />

      <StatCard
        label="Active NFTs"
        testId="stat-active-nfts"
        value={snapshot ? snapshot.activeListingCount.toString() : undefined}
        sub={
          snapshot
            ? `${snapshot.stagedListingCount} staged · ${snapshot.pendingAcquisitions} in flight`
            : undefined
        }
        spark={
          enough
            ? {
                series: series.active,
                tone: "blue",
                caption,
                ariaLabel: describe("Active positions", series.active, count),
              }
            : waiting("blue", pending)
        }
      />
    </div>
  );
}
