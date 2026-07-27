# Hyper World Assets

Hyper World Assets (`HWA`) is a HyperEVM-native NFT liquidity game inspired by the observable FWA
mechanics: NFT deposits backed by HYPE, weighted random acquisitions, explicit settlement choices,
`$HWA` rewards, a 70/30 revenue splitter and a manually opened Project X market.

This repository contains the Solidity protocol, deterministic Genesis collection, Next.js app,
subgraph/indexer, deployment scripts, forensic parity documentation and release gates.

## Current release state

- Target chain: HyperEVM mainnet (`999`), native asset HYPE.
- Mainnet Safe: `0x75818fd0a2Ff801F974C9a5d23616fbd38b15f4C`, Safe 1.4.1, 2-of-3.
- Genesis: 333 deterministic `Pressure Field` v3 NFTs, source-art aggregate
  `96b80e5c8a06b07407d92b58dbf7865aab242439bdfdb5d8436e370cd2915648`.
- Market: Project X V3, 1% pool, one-sided HWA LP permanently held by the protocol locker.
- Trading: external buys remain closed until a manual Safe action; there is no timed opening.
- Protocol deployment: **not performed**. Only the Safe exists on chain 999.

No script broadcasts by default. HyperEVM mainnet deployment requires the operator's explicit
authorization plus every fail-closed gate in the mainnet runbook.

## Local frontend

```powershell
Copy-Item frontend/.env.example frontend/.env.local
npm --prefix frontend ci
npm --prefix frontend run dev
```

Open `http://127.0.0.1:3900/`. The approved Genesis gallery is available at
`http://127.0.0.1:3900/genesis/v3/gallery.html`.

## Verification

Windows release gate, including live HyperEVM fork tests and Playwright:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\TestReleaseCandidate.ps1
```

Core checks can also be run separately:

```powershell
.\scripts\BuildReferenceUnion.ps1
.\.tools\foundry\forge.exe fmt --check
.\.tools\foundry\forge.exe build
.\.tools\foundry\forge.exe test -vv
npm --prefix frontend run typecheck
npm --prefix frontend run lint
npm --prefix frontend test
npm --prefix frontend run build
npm --prefix frontend run test:e2e
npm --prefix indexer run check
```

The latest complete local gate is recorded in `release/release-gate-last-run.json` and is always
generated without a broadcast-capable argument.

## Production preparation

The launch sequence and irreversible values are documented in:

- `MAINNET_RELEASE_RUNBOOK_2026-07-26.md`
- `HWA_MAINNET_CONFIGURATION_FREEZE_2026-07-27.md`
- `PROJECTX_DEPLOYMENT_RUNBOOK.md`
- `HWA_VPS_HOSTING_RUNBOOK_2026-07-27.md`
- `HWA_VPS_APP_RUNBOOK_2026-07-27.md`
- `DRAND_GELATO_RANDOMNESS_RUNBOOK.md`

Genesis media are prepared for a versioned HTTPS path on the production VPS. The mainnet gate will
not accept a placeholder host, mutable path or local-only verification. It requires byte-exact
remote verification of all 333 images and 333 metadata documents.

The final Project X price is selected immediately before deployment from the live deployer nonce:

```powershell
& .\scripts\SelectHWAProjectXLaunchPrice.ps1 -SyncEnv
```

That command does not broadcast. Any nonce change invalidates the selected factory/token addresses
and requires a fresh run.

After the Genesis contract exists, its four Safe mint batches and one-way freeze are generated from
live chain-999 state (never broadcast by the helper):

```powershell
& .\scripts\PrepareHWAGenesisSafeActions.ps1 `
  -Collection $env:FWA_SPLITTER_SNAPSHOT_NFT `
  -BaseUri $env:HWA_GENESIS_NFT_BASE_URI `
  -RpcUrl https://rpc.hyperliquid.xyz/evm
```

The production Next.js image is prepared by `frontend/Dockerfile` and
`docker-compose.production.yml`; its VPS deployment remains a separate operator action.

## Repository boundaries

Funded private keys, provider credentials, relayer state, build artifacts and local archives are
excluded from Git. Historical MemeBag and Robinhood experiments remain preserved locally but are
not part of the HWA release.

Security architecture and closed audit findings are in `release/`. Report potential security
issues privately; do not include private keys, seed phrases or production credentials in an issue.
