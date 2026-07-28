# HWA single-relayer and prelaunch UI delta audit

Date: 2026-07-29
Scope: explicit drand single-relayer risk acceptance, mainnet prelaunch rendering, visible HWA branding, and deterministic fork-gate stabilization.

## Executive result

No critical, high, or medium-severity finding was identified in this delta.

The release remains fail-closed:

- mainnet activation requires every existing release attestation;
- drand operations additionally require either confirmed relayer redundancy or the separately named single-relayer risk acknowledgement;
- a missing acknowledgement does not default to acceptance;
- a missing, malformed, or wrong-chain deployment manifest never enables writes;
- no frontend fallback invents live protocol data;
- the release gate forbids broadcast and did not submit any transaction.

## Security review

### Drand acknowledgement

`DRAND_SINGLE_RELAYER_RISK_ACCEPTED=true` is an operational risk acceptance, not a reduction of cryptographic verification.

The new condition is:

```text
DRAND_RELAYER_REDUNDANCY_CONFIRMED
OR
DRAND_SINGLE_RELAYER_RISK_ACCEPTED
```

All other activation conditions remain conjunctive. The single-relayer path therefore accepts availability and timing/fairness exposure only. The BN254 drand signature, round and liveness checks remain on-chain and unchanged. If the relayer becomes unavailable, acquisitions must be closed until fulfillment capacity is restored.

Four focused Solidity tests cover all Boolean combinations. Both values false rejects activation; either explicit acceptance path succeeds.

### Prelaunch UI and manifest handling

The indefinite grey placeholders were caused by disabled React Query reads remaining pending while no chain-999 deployment manifest existed. They were not a CSS blur.

The frontend now renders a deterministic prelaunch state when the mainnet manifest is genuinely absent. HTTP 404 maps to `absent`; server failures, malformed manifests and wrong-chain manifests retain their distinct fail-closed error states. Focused tests prevent provider failures from being disguised as prelaunch.

No mock listing, quote, balance, token market or activity is shown in mainnet mode.

### Branding

User-visible product copy, document metadata, header and footer now use `HWA`. The audited on-chain token name and frozen historical Genesis metadata were intentionally not renamed by this UI-only change.

### Fork reproducibility

HyperEVM providers can briefly advertise a head whose block body is not yet readable. Fork tests now resolve the provider head and pin execution twenty blocks behind it. The Project X mainnet fork uses the same-origin read proxy, which terminates the private provider credential outside the release report and command line.

## Residual accepted risk

The intentionally accepted single-relayer configuration has no independent liveness redundancy. A relayer outage can delay randomness fulfillment and an operator controlling the only relayer can influence submission timing, but cannot forge a valid drand result or choose the verified random output.

This risk must be revisited before material usage or treasury exposure. A second independently operated relayer remains the preferred production posture.

## Verification evidence

The authoritative machine-readable result is `release/release-gate-last-run.json`.

The complete gate covers:

- Solidity formatting, build, production sizes, unit, fuzz and invariant tests;
- focused activation-risk tests;
- Project X mainnet fork simulation;
- V3 testnet compatibility fork simulation;
- frontend dependency audit, typecheck, lint, unit tests, production build and Playwright E2E;
- indexer dependency audit and deterministic build;
- explicit no-broadcast assertions.

The mainnet indexer build is expected to remain skipped until chain-999 contract addresses exist. This pre-deployment skip does not permit activation or writes.
