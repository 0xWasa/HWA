# HWA — Follow-up audit test matrix

**Date:** 2026-07-27 · **Auditor:** Claude Fable 5
**Baseline run (pre-change):** `release/gate-fable5-followup-phaseA.json`
**Revalidation run (post-change):** `release/gate-fable5-followup-phaseC.json`

No transaction was broadcast in either run. No chain-999 contract exists.

---

## 1. Release gate — reproduced, then revalidated

Command (identical for both runs):

```bash
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\TestReleaseCandidate.ps1 -VerifyLiveTestnet
```

| Step | Baseline | After remediation | Count (min) |
|---|---|---|---|
| Solidity formatting | passed | passed | — |
| Solidity full build | passed | passed | — |
| Solidity production contract sizes | passed | passed | — |
| Solidity full tests | passed | passed | **136 → 152** (min 121) |
| Release helper self-tests | passed | passed | — |
| Project X mainnet 999 fork simulation | passed | passed | 2 (min 2) |
| V3 testnet 998 compatibility fork simulation | passed | passed | 4 (min 4) |
| Frontend dependency audit | passed | passed | 0 high+ |
| Frontend typecheck | passed | passed | — |
| Frontend lint | passed | passed | — |
| Frontend unit tests | passed | passed | **48 → 50** (min 46) |
| Frontend production build | passed | passed | — |
| Frontend Playwright E2E | passed | passed | 36 (min 32) |
| Indexer production dependency audit | passed | passed | 0 high+ |
| Indexer deterministic build | passed | passed | — |
| Indexer mainnet deterministic build | **skipped** | **skipped** | pre-deployment: no chain-999 manifest exists |
| Live 998 core attestation | passed | passed | — |
| Live 998 drand attestation | passed | passed | — |
| Live 998 Project X-compatible attestation | passed | passed | — |

```
status                 prepared        (correctly not "passed": one legitimate pre-deployment skip)
chainTarget            999
broadcastPolicy        forbidden
broadcastRequested     false
broadcastCapableSteps  0
broadcastPerformed     false
skippedSteps           1
```

**Reconciliation.** No pre-existing test was removed, renamed, skipped or weakened; no count dropped.

| Suite | Declared | Baseline | After | Delta |
|---|---|---|---|---|
| Solidity | 136 | 136 | **152** | +16 |
| Project X mainnet fork | 2 | 2 | 2 | 0 |
| V3 testnet fork | 4 | 4 | 4 | 0 |
| Frontend unit | 48 | 48 | **50** | +2 |
| Playwright | 36 | 36 | 36 | 0 |

The +16 Solidity comprises 15 tests added by this audit and 1 added by the concurrent launch-price remediation (`F5F-024`). The +2 frontend unit tests also come from that concurrent work.

---

## 2. Tests added by this audit (15)

Both files are **additive**. No production Solidity was modified, and no existing test was touched.

### `test/FWARewardsIntegrationInvariant.t.sol` — stateful, 5 invariants

Two adversarial actors, 14 handler selectors, 256 runs × 64 depth = **16 384 calls, 0 reverts** per invariant. This is the first campaign in the repository in which `FWA.setRewards` is ever called — i.e. the first that runs the configuration mainnet mandates.

| Invariant | Property proven |
|---|---|
| `invariant_RewardsNativeBalanceEqualsPurchaserAllowance` | Rewards HYPE balance **equals** `tokenBuyAllowanceTotal` exactly. Equality is correct, not conservative: the module has no `receive`/`fallback`, so value can only enter via `settleAcquisition` (`msg.value == tokenSlice`) or `buyFor` (spent in-call). Any drift means a slice booked without funding or an allowance released without payment. |
| `invariant_RewardsTokenBalanceCoversTokenLiabilities` | HWA balance covers every recognised liability: both actors' `tokenCredit`, pending depositor emission on every listing, and every unclaimed closed-epoch purchaser share. |
| `invariant_AcquisitionRewardStateTracksCore` | Module bookkeeping never diverges from the core: every request the core opened is known to the module, a request the core resolved is never still `Pending`, and `pendingAcquisitionsInEpoch` equals the counted `Pending` requests per epoch. |
| `invariant_CoreCustodiesEveryOwedNFTWithRewardsBound` | The core still custodies every NFT it owes, including one awaiting stuck-NFT recovery, with rewards wired in. |
| `invariant_CoreNativeBalanceCoversLiabilitiesWithRewardsBound` | Core native solvency holds even though settlement now forwards a slice of every acquisition fee out to the rewards module. |

Handler coverage (calls per selector, one campaign): `acquire` 1183 · `advanceBlocks` 1214 · `advanceWindow` 1162 · `claimAccruedTokens` 1138 · `claimDepositorTokens` 1185 · `claimEpochTokens` 1188 · `depositorResolve` 1176 · `fulfillAny` 1150 · `list` 1127 · `process` 1174 · `purchaserSettle` 1217 · `updateBacking` 1152 · `withdraw` 1141 · `withdrawTokens` 1177.

`fulfillAny` fulfils an **arbitrary** outstanding request, so callbacks arrive out of order; `advanceWindow` crosses reward-epoch boundaries, which is what makes closed-epoch claims reachable at all; `purchaserSettle` branch 2 is `acceptBidAsTokens`, the only core path that calls `rewards.buyFor`.

### `test/FWARewardsIntegrationBranches.t.sol` — deterministic, 10 tests

Reachability is **asserted here**, not inferred from a green fuzz run.

| Test | Property proven |
|---|---|
| `testCoreIsBoundToRewardsAndStartedEmission` | The module really is bound and the core really started the emission clock. |
| `testRewardsRequiredForActivationLatchIsOneWayAndBlocksActivation` | The mainnet latch cannot be unset, and acquisitions cannot open with no module bound. |
| `testSettledAcquisitionFundsAndSpendsPurchaserAllowance` | A settled acquisition funds the purchaser allowance exactly, and it is spendable into HWA through the adapter, zeroing both the allowance and the module's HYPE balance. |
| `testPurchaserAllowanceCannotBeClaimedTwice` | A spent allowance cannot be claimed again. |
| `testExpiredAcquisitionRefundsRewardStateAndLeavesNoAllowance` | An acquisition whose word never arrives reaches `Refunded`, releases its epoch counter, and leaves no HYPE liability. |
| `testAcceptBidAsTokensBuysThroughTheRewardsModule` | The token-denominated settlement routes through `rewards.buyFor`, delivers HWA to the purchaser and the NFT to the depositor, without disturbing the allowance ledger. |
| `testDepositorEmissionAccruesAndIsClaimableExactlyOnce` | Emission accrues against a live listing, pays out once, and the same accrual cannot be harvested twice. |
| `testNonDepositorCannotHarvestAnotherListing` | Only the depositor can harvest a listing's emission. |
| `testClosedEpochPurchaserClaimIsSingleUse` | A closed epoch pays its purchaser exactly once. |
| `testEpochWithPendingAcquisitionCannotBeClaimed` | An epoch holding a pending request cannot be claimed, so the denominator can never grow underneath a claimant. |

**Harness honesty note.** The first version of the reachability guard was an `afterInvariant` assertion and it failed. That was the harness, not the protocol: `afterInvariant` is evaluated per run and short runs legitimately never open an acquisition. Isolating it (disabling only the guard) showed all five real invariants pass. It was replaced with the deterministic tests above, which are strictly stronger than the guard they replace.

---

## 3. Regression coverage for each fixed finding

| Finding | Fix | Regression test |
|---|---|---|
| `F5F-001` rewards boundary unexecuted | 2 additive test files | The 15 tests above |
| `F5F-002` manifest omitted deployed code | roots corrected; 286 → **441** hashed files | `scripts/TestReleaseScripts.ps1`: parses `remappings.txt`, resolves every target against the declared roots and throws on escape; plus a direct assertion that solady is hashed |
| `F5F-003` launch price unvalidated | echo + FDV + confirmation gates on the active path | `test/DeployProjectXTokenGuards.t.sol` (applied concurrently, executed here) |
| `F5F-004` deployer key exported to npm | secrets scrubbed after mainnet import, before any child process | `secretsScrubbedBeforeChildProcesses` recorded in every gate report |
| `F5F-005` skipped steps reported as passed | `-SkipFork` / `-SkipE2E` now record explicit skips | Any run with either switch now yields `skippedSteps > 0` and `status: prepared` |

---

## 4. Verification performed outside the test suite

| Check | Method | Result |
|---|---|---|
| Audit manifest integrity, pre-audit | recomputed SHA-256 for all 285 entries | 285/285 match, 0 drift, 0 missing |
| Audit manifest completeness | cross-referenced `remappings.txt` targets against generator roots | **4 remapping targets outside all roots** → `F5F-002` |
| drand chain constants | live fetch `api.drand.sh/<chainhash>/info` | hash, period 3, genesis 1727521075, scheme `bls-bn254-unchained-on-g1` all match |
| drand fixture authenticity | live fetch of round 19159982 | repo fixture signature is byte-identical to the live signature |
| randomness derivation | computed `sha256(signature)` locally | equals the published randomness exactly |
| G2 public key ordering | compared pinned coordinates to drand's serialisation | pairing input `x[1],x[0],y[1],y[0]` reconstructs it byte-for-byte |
| sha256 grindability | read `isValidPointG1` | rejects `x >= N \|\| y >= N`; non-canonical encodings impossible |
| Mainnet round-delay floor | read `DrandBN254Coordinator` | `MIN_DELAY_SECONDS = 30` is a contract constant enforced in the constructor — previous `F5-002` genuinely closed |
| Broadcast history | inspected `broadcast/` | chain **998 only**; no chain-999 broadcast has ever occurred |
| Rewards test wiring | `Select-String setRewards` over all test roots | **no matches** → `F5F-001` |
| Buyback price-limit reachability | read V3 `SPL` precondition against the stored limit; searched the mock router | mock ignores `sqrtPriceLimitX96`, so the defect is untestable in-repo → `F5F-006` |
| Existing settlement campaign depth | ran `test/FWASettlementInvariant.t.sol -vv` | 14 selectors, ~1 150 calls each, 0 reverts — broad, but reachability is carried by the deterministic branch suite, not the campaign |

---

## 5. Gaps this matrix does not close

Stated so the matrix is not read as more than it is.

- **Splitter has no stateful campaign.** Its conservation was re-derived from source and the headline agent finding against it was refuted, but it has only single-path unit tests. This is the natural next target, matching what Rewards now has.
- **The V3 mock does not model price limits or partial fills.** `sqrtPriceLimitX96` is ignored, so `F5F-006` cannot be caught by any in-repo test; adapter price behaviour is covered only by the two mainnet fork tests.
- **Hash-to-curve is not conformance-tested.** One official vector passes and one forgery is rejected, but the forgery test fails at the on-curve check and never reaches the pairing (`F5F-018`), so the pairing rejection path has no executed coverage.
- **No chain-999 attestation exists**, by design: nothing is deployed. The four live-999 gate steps have never run.
