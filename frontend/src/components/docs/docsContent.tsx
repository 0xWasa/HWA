"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { FWA_PARAMS } from "@/protocol/params";
import { useCollections } from "@/state/queries";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Hype } from "@/components/ui/Hype";
import { Skeleton } from "@/components/ui/Skeleton";

/**
 * Docs copy. Every number shown here is derived from FWA_PARAMS so the page
 * cannot drift from the parameters the app actually prices and settles with.
 */

const pct = (bps: number) => `${bps / 100}%`;
const HOURS = FWA_PARAMS.settlementWindowSec / 3_600;
const DAYS = FWA_PARAMS.finalizeWindowSec / 86_400;
const COLD_MIN = FWA_PARAMS.coldGapSec / 60;

// ------------------------------------------------------------ prose pieces

export function P({ children }: { children: ReactNode }) {
  return <p className="text-md leading-relaxed text-dim">{children}</p>;
}

export function H3({ children }: { children: ReactNode }) {
  return <h3 className="pt-2 text-base font-semibold text-ink">{children}</h3>;
}

/** Emphasised inline term — used sparingly, for the word a sentence turns on. */
function K({ children }: { children: ReactNode }) {
  return <span className="font-medium text-ink">{children}</span>;
}

/** Mono inline value. */
function V({ children }: { children: ReactNode }) {
  return <span className="num font-mono text-sm text-accent">{children}</span>;
}

function Formula({ children, caption }: { children: string; caption?: string }) {
  return (
    <figure className="space-y-1.5">
      <div className="overflow-x-auto rounded-md border border-line bg-inset px-4 py-3">
        <pre className="num w-max font-mono text-sm leading-relaxed text-dim">{children}</pre>
      </div>
      {caption && <figcaption className="text-xs text-mute">{caption}</figcaption>}
    </figure>
  );
}

function Bullets({ items }: { items: ReactNode[] }) {
  return (
    <ul className="space-y-2 text-md leading-relaxed text-dim">
      {items.map((item, i) => (
        <li key={i} className="flex gap-2.5">
          <span aria-hidden className="mt-2.5 size-1 shrink-0 rounded-full bg-accent/70" />
          <span className="min-w-0">{item}</span>
        </li>
      ))}
    </ul>
  );
}

/** Parameter table — label left, live mono value right. */
function Params({ rows }: { rows: [label: string, value: ReactNode][] }) {
  return (
    <dl className="divide-y divide-line-subtle overflow-hidden rounded-md border border-line bg-panel">
      {rows.map(([label, value]) => (
        <div key={label} className="flex items-center justify-between gap-4 px-3.5 py-2.5">
          <dt className="text-sm text-mute">{label}</dt>
          <dd className="num shrink-0 font-mono text-sm font-semibold text-ink">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * The allowlist is registry state, not copy — it is read through the same hook
 * the deposit and pool filters use, so the docs can never claim a collection
 * the contract does not accept.
 */
function CollectionAllowlist() {
  const { data, isLoading, isError, refetch } = useCollections();
  const allowed = data?.filter((c) => c.whitelisted) ?? [];

  if (isLoading && !data) {
    return (
      <div className="grid gap-2 sm:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-[42px] rounded-md" />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <EmptyState
        compact
        title="Allowlist unavailable"
        detail="The collection registry could not be read. The contract is the source of truth, not this page."
        action={
          <Button variant="outline" size="xs" onClick={() => void refetch()}>
            Retry
          </Button>
        }
      />
    );
  }

  if (allowed.length === 0) {
    return (
      <EmptyState
        compact
        title="No collections allowlisted"
        detail="Deposits stay closed until a collection is added to the registry."
      />
    );
  }

  return (
    <ul className="grid gap-2 sm:grid-cols-2">
      {allowed.map((c) => (
        <li
          key={c.address}
          className="flex items-center gap-2.5 rounded-md border border-line bg-panel px-3.5 py-2.5 text-sm text-ink"
        >
          <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-accent" />
          <span className="min-w-0 truncate">{c.name}</span>
        </li>
      ))}
    </ul>
  );
}

function Callout({ tone, title, children }: { tone: "amber" | "accent"; title: string; children: ReactNode }) {
  const amber = tone === "amber";
  return (
    <aside className={`rounded-md border p-4 ${amber ? "border-amber/30 bg-amber/6" : "border-accent/30 bg-accent/6"}`}>
      <div className={`mlabel mb-1.5 ${amber ? "text-amber" : "text-accent"}`}>{title}</div>
      <div className="space-y-2 text-sm leading-relaxed text-dim">{children}</div>
    </aside>
  );
}

// ---------------------------------------------------------------- sections

export type DocSection = {
  id: string;
  /** Sidebar + heading label. */
  title: string;
  /** One-line summary rendered under the heading. */
  lede: string;
  body: ReactNode;
};

export const DOCS_SECTIONS: DocSection[] = [
  // ------------------------------------------------------- how it works
  {
    id: "how-it-works",
    title: "How it works",
    lede: "A pool of NFTs, each backed by HYPE. Buyers pay the pool price and receive one randomly selected position.",
    body: (
      <>
        <P>
          A <K>depositor</K> puts an NFT into custody and pairs it with committed HYPE, called its <K>backing</K>. The
          backing does two things: it is a standing bid the depositor is willing to pay to get the NFT back, and it sets
          how often the position is selected.
        </P>
        <P>
          A <K>purchaser</K> does not choose an NFT. They pay the current pool price and receive one position picked at
          random, weighted so that heavily backed positions come up less often. Once a position is allocated, the
          purchaser decides what to do with it — keep the NFT, or hand it back and take most of its backing in HYPE.
        </P>
        <Formula caption="Every acquisition follows the same path; the randomness is requested before anyone can see the outcome.">
          {`deposit  →  staged  →  active  →  allocated  →  settled`}
        </Formula>
        <P>
          Depositors earn from every acquisition: the fee paid on top of the pool price is distributed across active
          listings. Purchasers get an NFT, or the HYPE that was standing behind it. Start at the{" "}
          <Link href="/" className="text-accent underline-offset-2 hover:underline">
            pool
          </Link>
          , deposit from{" "}
          <Link href="/deposit" className="text-accent underline-offset-2 hover:underline">
            /deposit
          </Link>
          , and track everything you own under{" "}
          <Link href="/positions" className="text-accent underline-offset-2 hover:underline">
            My Positions
          </Link>
          .
        </P>
      </>
    ),
  },

  // -------------------------------------------------- positions & weight
  {
    id: "positions",
    title: "Positions & weighting",
    lede: "Weight is the inverse of backing. More backing means the position is selected less often.",
    body: (
      <>
        <P>
          Each active listing holds a slot in a sum tree. Its weight is the inverse of its backing, so the relationship
          between what you commit and how exposed you are is exact, not approximate:
        </P>
        <Formula caption="All integer math in wei. A position backed twice as heavily is selected half as often.">
          {`weight = 1e36 / backing
odds   = weight / totalWeight`}
        </Formula>
        <P>
          Selection draws <V>randomWord % totalWeight</V> and walks the tree to the matching slot. Nothing else
          influences the draw — not deposit order, not rarity, not how long a position has been sitting in the pool.
        </P>
        <H3>What backing controls</H3>
        <Bullets
          items={[
            <>
              <K>Low backing</K> — cheap for a purchaser to take, so the position is selected often. You exit quickly and
              collect fewer fees along the way.
            </>,
            <>
              <K>High backing</K> — expensive to take, so the position is selected rarely. You stay in the pool longer
              and accrue a larger share of acquisition fees, but your HYPE stays committed.
            </>,
            <>
              Backing is committed at deposit time and is never commingled with another position&apos;s backing. You can
              withdraw a staged or active listing at any time, except while an acquisition request is in flight.
            </>,
          ]}
        />
        <Params
          rows={[
            ["Minimum backing", <Hype key="min" wei={FWA_PARAMS.minBacking} maxDecimals={4} />],
            ["Weight numerator", "1e36"],
            ["Max positions per acquisition", String(FWA_PARAMS.maxBatch)],
          ]}
        />
      </>
    ),
  },

  // ------------------------------------------------------------- pricing
  {
    id: "pricing",
    title: "Pricing & allocation",
    lede: "The pool price is its expected value plus a fixed surcharge, and requests settle strictly in order.",
    body: (
      <>
        <P>
          The pool has one price at a time, derived from the backing it holds. Expected value is the weighted mean of
          all active backings — the amount a random draw is worth on average:
        </P>
        <Formula caption={`Surcharge is fixed at ${pct(FWA_PARAMS.surchargeBps)}. The randomness service fee is charged separately, on top, and paid to the provider before the request.`}>
          {`EV          = weightedBackingTotal / totalWeight
pool price  = EV × (10000 + ${FWA_PARAMS.surchargeBps}) / 10000
total       = pool price + randomness service fee`}
        </Formula>
        <H3>Requests settle in order</H3>
        <P>
          Buying does not resolve in the same transaction. Your request reserves a batch of listings, freezes its drift
          tolerance, and asks the randomness provider for a word. Callbacks may arrive out of order — they only
          authenticate and cache the word. Requests are then processed <K>strictly in sequence</K>, permissionlessly, so
          an earlier buyer is always allocated before a later one.
        </P>
        <P>
          On mainnet, the verified drand coordinator locks a beacon round at least <V>30 seconds</V> in the future. This
          deliberate security buffer keeps the round unknowable when the request is recorded; it is part of the normal
          acquisition flow, not a stalled transaction.
        </P>
        <H3>Drift tolerance</H3>
        <P>
          Between your request and its processing, other deposits and withdrawals can move the pool price. Drift
          tolerance is the band you accept: if the price moves outside it, the request does not execute and your fee
          becomes a claimable refund instead. The default is <V>{pct(FWA_PARAMS.defaultDriftBps)}</V> in either
          direction. A missing random word past its deadline expires the same way — refund, no allocation.
        </P>
        <Callout tone="amber" title="No outcome is known in advance">
          <p>
            The random word is requested before it exists and decides the outcome afterwards. There is no preview, no
            reroll, and no way to see which position you will receive. An indexed request is not a confirmed
            allocation.
          </p>
        </Callout>
        <Params
          rows={[
            ["Acquisition surcharge", pct(FWA_PARAMS.surchargeBps)],
            ["Default drift tolerance", `± ${pct(FWA_PARAMS.defaultDriftBps)}`],
            ["Positions per request", `1 – ${FWA_PARAMS.maxBatch}`],
          ]}
        />
      </>
    ),
  },

  // --------------------------------------------------------- collections
  {
    id: "collections",
    title: "Collections",
    lede: "Deposits are restricted to an allowlist of HyperEVM collections.",
    body: (
      <>
        <P>
          Only collections on the allowlist can be deposited or relisted. This keeps the pool made of assets with a
          real market on HyperEVM — a random draw is only meaningful if every position in it is worth something.
        </P>
        <CollectionAllowlist />
        <P>
          The allowlist gates <K>new</K> listings only. Removing a collection never touches positions already in the
          pool: existing listings keep their backing, their odds and their settlement rights, and can always be
          withdrawn or settled normally.
        </P>
        <P>
          These are HyperEVM NFT contracts. HyperEVM is not HyperCore — assets and balances do not cross between them
          implicitly.
        </P>
      </>
    ),
  },

  // ---------------------------------------------------------- settlement
  {
    id: "settlement",
    title: "Settlement",
    lede: "Four choices for the purchaser, a bounded window, then the depositor, then anyone.",
    body: (
      <>
        <P>
          When a position is allocated, the purchaser owns the decision for the next {HOURS} hours. All four choices are
          available immediately:
        </P>
        <Bullets
          items={[
            <>
              <K>Keep</K> — the NFT transfers to the purchaser. The depositor receives the backing, minus the{" "}
              <V>{pct(FWA_PARAMS.ownerSettlementFeeBps)}</V> owner cut.
            </>,
            <>
              <K>Keep &amp; relist</K> — same payment to the depositor, and the NFT goes straight back into custody as a
              new listing with backing chosen by the purchaser, who becomes its depositor.
            </>,
            <>
              <K>Accept bid (HYPE)</K> — the purchaser hands the NFT back to the depositor and takes{" "}
              <V>{pct(FWA_PARAMS.bidPayoutBps)}</V> of the backing in HYPE. The remaining{" "}
              <V>{pct(10_000 - FWA_PARAMS.bidPayoutBps)}</V> is retained by the protocol.
            </>,
            <>
              <K>Accept bid as HWA</K> — identical economics, except the {pct(FWA_PARAMS.bidPayoutBps)} payout is used
              to buy HWA through the rewards module, with a minimum-out you set. Available only once that module is
              live.
            </>,
          ]}
        />
        <H3>If the purchaser does nothing</H3>
        <Bullets
          items={[
            <>
              After <V>{HOURS}h</V>, the depositor may resolve it, choosing the economic equivalent of either keep
              (they receive the backing payout) or accept-bid (the NFT returns to them).
            </>,
            <>
              After <V>{DAYS}d</V>, anyone can finalize. The default outcome is applied: NFT to the purchaser, net
              backing to the depositor.
            </>,
          ]}
        />
        <H3>Stuck NFTs</H3>
        <P>
          On the non-strict paths the NFT transfer is best-effort. If a recipient contract rejects it, the HYPE side
          still settles and the NFT is recorded against a recovery address — the rightful owner retries delivery from{" "}
          <Link href="/positions" className="text-accent underline-offset-2 hover:underline">
            My Positions
          </Link>{" "}
          whenever they like. A failed transfer never blocks or reverses the money.
        </P>
        <Params
          rows={[
            ["Purchaser-exclusive window", `${HOURS}h`],
            ["Permissionless finalize", `${DAYS}d`],
            ["Accept-bid payout", pct(FWA_PARAMS.bidPayoutBps)],
            ["Accept-bid penalty", pct(10_000 - FWA_PARAMS.bidPayoutBps)],
          ]}
        />
      </>
    ),
  },

  // ---------------------------------------------------------------- fees
  {
    id: "fees",
    title: "Fees & distribution",
    lede: "The surcharge is paid to depositors; the protocol takes 1% on acquisition and 1% on settlement.",
    body: (
      <>
        <P>
          The surcharge a purchaser pays on top of EV is what depositors earn for providing liquidity. From it, the
          rewards slice is taken first, then an owner cut of <V>{pct(FWA_PARAMS.ownerAcquisitionFeeBps)}</V>. The
          remainder is split <K>equally across every active listing</K> — not pro rata by backing. A small position
          collects the same fee as a large one.
        </P>
        <P>
          When a crown exists, <V>{pct(FWA_PARAMS.crownShareBps)}</V> of that remainder is diverted to the crown pot
          before the equal split. On settlement, the owner takes{" "}
          <V>{pct(FWA_PARAMS.ownerSettlementFeeBps)}</V> of the backing on the keep and relist paths. On accept-bid, the{" "}
          <V>{pct(10_000 - FWA_PARAMS.bidPayoutBps)}</V> penalty stays with the protocol.
        </P>
        <P>
          Fees accrue as claimable balances rather than being pushed to you. Claim listing fees, refunds and earnings
          from the Refunds &amp; Earnings tab of{" "}
          <Link href="/positions" className="text-accent underline-offset-2 hover:underline">
            My Positions
          </Link>
          .
        </P>
        <Params
          rows={[
            ["Owner cut — acquisition", pct(FWA_PARAMS.ownerAcquisitionFeeBps)],
            ["Owner cut — settlement", pct(FWA_PARAMS.ownerSettlementFeeBps)],
            ["Crown tithe", pct(FWA_PARAMS.crownShareBps)],
            ["Accept-bid penalty", pct(10_000 - FWA_PARAMS.bidPayoutBps)],
            ["Distribution to listings", "equal share"],
          ]}
        />
      </>
    ),
  },

  // --------------------------------------------------------------- crown
  {
    id: "crown",
    title: "Top deposit (crown)",
    lede: `The single highest-backed listing holds the crown and collects a ${pct(FWA_PARAMS.crownShareBps)} tithe on distributed fees.`,
    body: (
      <>
        <P>
          One listing at a time holds the crown: the one with the largest backing in the pool. While it does, it accrues
          a <V>{pct(FWA_PARAMS.crownShareBps)}</V> tithe on the fees distributed to listings, on top of its normal equal
          share.
        </P>
        <P>
          Taking the crown is not a tie: a new listing must beat the current crown&apos;s backing by{" "}
          <V>{pct(FWA_PARAMS.crownThresholdBps)}</V>. The pot is credited in full, once, when the crowned position
          leaves — by withdrawal or by being allocated.
        </P>
        <P>
          The crown is the most heavily backed position, which by construction is also the least likely to be selected.
          Holding it means committing a large amount of HYPE for a long time.
        </P>
        <Params
          rows={[
            ["Crown share of distributed fees", pct(FWA_PARAMS.crownShareBps)],
            ["Margin required to take the crown", `+ ${pct(FWA_PARAMS.crownThresholdBps)}`],
          ]}
        />
      </>
    ),
  },

  // ------------------------------------------------------------- rewards
  {
    id: "rewards",
    title: "$HWA rewards",
    lede: "Depositor emissions and purchaser epoch pots — a separate module that is not activated yet.",
    body: (
      <>
        <Callout tone="accent" title="Not activated">
          <p>
            The HWA token, emissions, epoch pots and the market pool ship as a module after the core protocol. Nothing
            accrues until it is deployed, and the app shows no reward figure while it is inactive.
          </p>
        </Callout>
        <H3>Depositor emissions</H3>
        <P>
          Positions are checkpointed on the <K>square root of their backing</K>, so emissions scale sub-linearly:
          doubling your backing does not double your share of the stream. It rewards keeping liquidity in the pool
          without handing the whole emission to the largest depositor.
        </P>
        <Formula caption="Share of the depositor stream, per active position.">
          {`share = sqrt(backing) / Σ sqrt(backing)`}
        </Formula>
        <H3>Purchaser epochs</H3>
        <P>
          Acquisitions are grouped into fixed <K>24-hour epochs</K> measured from emission start. Every successfully
          settled acquisition counts as one equal unit when that day&apos;s HWA pot is divided. The hot/cold gap does not
          close the epoch: it controls the fraction of acquisition surcharge reserved as the purchaser&apos;s HYPE
          allowance to buy HWA. That fraction is zero through <V>{FWA_PARAMS.hotGapSec}s</V>, ramps linearly, and reaches
          100% after <V>{COLD_MIN} min</V>. Within a batch, only the first request observes the pre-batch gap.
        </P>
        <H3>Market</H3>
        <P>
          HWA is intended to trade against wHYPE in a <V>1%</V> fee pool on Project X. Protocol revenue routes into
          permissionless buybacks protected by a 30-minute pool TWAP and dynamic price bounds. Buybacks fail closed
          until the oracle window is ready. None of this is live; when it is, it appears under{" "}
          <Link href="/token" className="text-accent underline-offset-2 hover:underline">
            $HWA
          </Link>
          .
        </P>
        <Params
          rows={[
            ["Emission weighting", "√ backing"],
            ["Hot gap", `${FWA_PARAMS.hotGapSec}s`],
            ["Cold gap", `${COLD_MIN} min`],
            ["Market pool fee", "1%"],
          ]}
        />
      </>
    ),
  },

  // -------------------------------------------------------------- safety
  {
    id: "safety",
    title: "Safety & risk",
    lede: "What the protocol guarantees, and what it explicitly does not.",
    body: (
      <>
        <H3>What is bounded</H3>
        <Bullets
          items={[
            <>
              <K>Windows are bounded.</K> A settlement cannot hang forever: the purchaser has {HOURS}h, the depositor
              gets the next stretch, and after {DAYS}d anyone can finalize.
            </>,
            <>
              <K>Backing is never commingled.</K> Each position&apos;s HYPE is its own liability. Backing, escrows,
              refunds and earnings are tracked separately, and payouts are claimed rather than pushed.
            </>,
            <>
              <K>Exits stay open.</K> Staged and active listings can be withdrawn, except during the short lock while an
              acquisition request is in flight and listings are reserved.
            </>,
            <>
              <K>Failed NFT delivery is recoverable.</K> The HYPE settles regardless, and the NFT stays claimable.
            </>,
          ]}
        />
        <H3>What is not guaranteed</H3>
        <Bullets
          items={[
            <>
              <K>Indexed is not confirmed.</K> The interface reads indexed data that can lag or be re-orged. A request
              is confirmed on-chain, not on this screen.
            </>,
            <>
              <K>Submitted is not settled.</K> Requests wait for randomness and are processed in order; expiry or drift
              outside tolerance produces a refund, not an allocation.
            </>,
            <>
              <K>Randomness decides after the fact.</K> There is no preview of which position you receive, and your NFT
              can be selected far earlier than its weight-implied average.
            </>,
          ]}
        />
        <Callout tone="amber" title="Risk disclosure">
          <p>
            Depositing is liquidity provision and carries risk of loss. Your NFT may be acquired at a moment and a price
            you would not have chosen, and the backing you receive can be worth less than the asset. Accepting a bid
            returns {pct(FWA_PARAMS.bidPayoutBps)} of backing, never all of it.
          </p>
          <p>
            HWA rewards have no guaranteed value and are not a yield. Nothing here is investment advice. Smart contracts
            can contain defects; use only what you can afford to lose.
          </p>
        </Callout>
      </>
    ),
  },
];

/** Live parameter summary shown at the top of the page. */
export const DOCS_PARAM_SUMMARY: [label: string, value: ReactNode][] = [
  ["Surcharge", pct(FWA_PARAMS.surchargeBps)],
  ["Default drift", `± ${pct(FWA_PARAMS.defaultDriftBps)}`],
  ["Min backing", <Hype key="min-backing" wei={FWA_PARAMS.minBacking} maxDecimals={4} />],
  ["Accept-bid payout", pct(FWA_PARAMS.bidPayoutBps)],
  ["Purchaser window", `${HOURS}h`],
  ["Finalize after", `${DAYS}d`],
];
