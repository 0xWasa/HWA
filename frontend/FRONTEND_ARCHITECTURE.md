# Frontend architecture

Next.js 15 App Router · TypeScript strict (`noUncheckedIndexedAccess`) · Tailwind v4 tokens · TanStack Query · wagmi/viem · zod. Pages are thin server wrappers; all behavior lives in client components under `src/components`.

```
src/
  app/                      pages (/, /deposit, /positions, /activity, /rewards) + providers + globals.css
  config/                   env (zod-validated), HyperEVM chains, deployment-manifest schema+loader
  lib/                      units.ts (bigint HYPE math), format.ts (presentation, label sanitizer)
  protocol/                 THE BOUNDARY
    types.ts                domain types (bigint wei, unix seconds, bps ints)
    client.ts               ProtocolClient interface + ProtocolEvent
    params.ts               FWA baseline params (mock/display fallbacks — chain wins)
    errors.ts               ProtocolError codes + user-facing decoding
    rarity.ts               odds → display-only rarity bands
    provider.tsx            ProtocolProvider: picks the client, account abstraction, event→query invalidation
    mock/                   engine.ts (world simulation), fixtures.ts, scenarios.ts, nftArt.ts, MockProtocolClient.ts
    viem/                   abi.ts (minimal fragments from the verified reference), ViemProtocolClient.ts
  state/                    queries.ts (typed hooks), actions.ts (write wrapper with decoded errors)
  wallet/                   wagmi config (injected only, never auto-connect)
  components/               ui/ primitives · shell/ · pool/ · deposit/ · positions/ · activity/ · rewards/ · nft/ · tx/ · dev/
e2e/                        Playwright journeys + screenshots.capture.ts
```

## The protocol boundary

Components and hooks depend **only** on `ProtocolClient` (`src/protocol/client.ts`). Implementations swap by configuration (`NEXT_PUBLIC_DATA_MODE`), never by editing components:

- **MockProtocolClient** wraps `MockEngine` — a deterministic-enough in-memory world: listings staged→active→allocated→settled, ordered acquisition tickets with randomness delays/timeouts, settlement windows (24h purchaser / 7d finalize), refunds/earnings/fees/crown accounting, ambient third-party flow, full tx lifecycles, and localStorage persistence for resume-after-reload. Scenarios (`?scenario=`) freeze that world into every UX state we must demonstrate.
- **ViemProtocolClient** implements direct on-chain reads against the stable core ABI (quotes, snapshot views, per-listing state, settlement windows) and refuses to invent anything it cannot know: indexer-backed reads and writes throw typed `ProtocolError`s until the pieces in `INTEGRATION_NEEDS.md` exist. Writes are additionally hard-gated on a valid deployment manifest for the configured chain id.

Domain types are business-shaped (`Listing`, `AcquisitionTicket`, `SettlementInfo`…), not ABI tuples; the viem/indexer adapters translate at the edge. On-chain enums are mapped explicitly (`viem/abi.ts`).

### Read paths

- **Explore/history** (listings, activity, positions history): indexer-class data — allowed to lag, flagged by `ConnectionHealth` and the `indexed`/`confirmed` finality on every activity item.
- **Transaction-critical** (quote, balances, allowance, position state): direct on-chain reads, revalidated *again* inside the client right before the wallet prompt (`acquire` re-checks the live fee against the quote's guarded max; a drift beyond tolerance surfaces `PRICE_DRIFTED` instead of signing).

### Events → cache

The client pushes `ProtocolEvent`s (`pool`, `listings`, `positions`, `activity`, `rewards`, `tx`, `wallet`, `health`); `ProtocolProvider` maps them to TanStack Query invalidations. Polling stays as a fallback cadence (6–10s) so testnet works before websockets/indexer push exist.

## Account abstraction

`useAccountState()` exposes `{status, address, chainId, isWrongNetwork, connect, disconnect, switchToAppNetwork}`. Mock mode implements it on the engine (including refused switches); viem mode implements it with wagmi (injected connector, `ssr: true`, no auto-connect). Components never import wagmi directly.

## Transaction machine

Every write returns a `TrackedTransaction` following

```
review → wallet → submitted → confirming → indexed → completed
            ↘ rejected      ↘ reverted        ↘ (lagging indexer delays "indexed")
                     ↘ replaced / timeout (stale — retryable)
```

- `TxDock` renders the machine globally (stepper, hash link, decoded error + raw details, dismiss); `submitted` is never presented as success.
- Guard failures **before** a tx exists (wrong network, stale price, insufficient balance, window closed, not allowlisted…) surface as inline `ActionError`s at the call site via `useProtocolAction`.
- Pending txs and acquisition tickets persist to localStorage (public data only: ids, hashes, phases, meta strings). On reload, `resumeTracking()` re-arms in-flight items; a tx interrupted at the wallet phase becomes `timeout` with an explicit "nothing was sent — retry" message.

## Money math

`src/lib/units.ts` is the only place HYPE amounts are formatted/parsed. Everything is `bigint` wei; bps math uses integer floor semantics like the contract; odds are computed in ppm from bigint weights. Floats never touch on-chain values.

## Security posture (UI)

- NFT names/URLs are untrusted: `sanitizeLabel` strips control/bidi/zero-width characters, rendering is text-only, `NFTImage` sandboxes images (plain `img`, `referrerPolicy=no-referrer`, error fallback, hard timeout).
- No contract address exists outside the deployment manifest; manifest absent/invalid/wrong-chain ⇒ writes disabled + explicit banner.
- No signature or connection is ever triggered on load; the review step always shows network / action / amount / guards.
- Mock hashes never link to an explorer; mock mode is permanently labeled.

## Testing

- **Vitest** (`src/**/*.test.ts`): money math, sanitizer, and the mock engine treated as a reference implementation (pricing from the harmonic mean, drift guards, ordered lifecycle, window gating, refunds, reverts).
- **Playwright** (`e2e/*.spec.ts`): the critical journeys in mock mode — pool exploration and deep links, the full acquire flow with reveal, deposit approve→list→staged→active, settlement choices, claims, degraded states (wrong network, RPC down, indexer lag, stale quote, randomness timeout, reload-resume).
- `e2e/screenshots.capture.ts` produces the desktop/tablet/mobile control captures in `artifacts/screenshots/`.
