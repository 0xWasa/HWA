# HWA mainnet canary handoff — chain 999

## Current state

Infrastructure is deployed and fail-closed. Do not enable public HWA buys during the gameplay
canary. Do not promote the frontend manifest until the exact on-chain canary succeeds and Goldsky is
within the accepted indexing lag.

## Joint decision before any transaction

- **Hypio canary:** use `0x63eb9d77d083ca10c304e28d5191321977fd0bfb`. The deployer owns none,
  so a separate wallet holding a Hypio must seed the pool.
- **Genesis canary:** use `0x89D52133B105E9548Df16dE4d7cf59c412daf191`. The deployer owns all 333,
  and a non-broadcast package is prepared at `release/mainnet-owner-actions-genesis-eoa.json`. It must
  still be regenerated against live state and reviewed immediately before execution.

## Mandatory preflight

1. Confirm Goldsky `_meta.hasIndexingErrors == false` and its indexed block is within the release
   gate's allowed lag from the current HyperEVM head.
2. Confirm `hwa-drand-relayer.service` is active, recent and `launchReady() == true`.
3. Re-run `scripts/TestReleaseCandidate.ps1` in mainnet mode with zero skips.
4. Re-run `scripts/PrepareMainnetOwnerActions.ps1` against the live RPC immediately before use.
5. Review every target, selector and collection address in the freshly generated JSON.
6. Confirm once more that `externalBuysEnabled() == false`.

## Canary activation actions

Execute only the freshly generated `activationBatch`, in order:

1. start the Splitter revenue clock;
2. allowlist exactly one canary collection;
3. enable acquisitions, which starts rewards emission.

The audited split is already frozen, so no duplicate freeze call is required. Public Project X buys
are a separate action and remain closed.

## Canary journey

1. Seed one NFT with a deliberately small HYPE backing.
2. Verify the listing appears through both direct logs and Goldsky.
3. Submit exactly one acquisition.
4. Observe the drand request, proof and strict in-order fulfillment.
5. Complete one settlement branch and confirm NFT/HYPE/reward accounting.
6. Confirm the frontend success flow, ownership, activity feed and recovery after refresh.
7. Run the post-canary attestation before adding any other collection.

## Abort conditions

Immediately stop and run the prepared emergency close actions if any invariant diverges, the drand
heartbeat becomes stale, indexing errors appear, expected balances differ, or the UI cannot reconcile
the transaction with canonical on-chain state. Never open public token buys as a troubleshooting step.
