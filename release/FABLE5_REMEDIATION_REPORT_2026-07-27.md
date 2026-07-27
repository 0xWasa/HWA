# HWA — Remediation report

# REVISION 2

> Revision 1 (below the rule) is retained unedited for the audit trail. Its counts are superseded.

## R2.1 What changed

A hostile cross-check across all six mandated scope areas found three High findings that revision 1 missed — one of which revision 1 had affirmatively **mis-cleared**. Two are now fixed; one is escalated.

| Finding | Severity | Status |
|---|---|---|
| F5-001 — invariant campaign vacuous | High | fixed (revision 1) |
| **F5-005 — Project X launch price had no echo / FDV / confirmation gate** | **High** | **fixed** |
| **F5-006 — token settlement signed an unbounded-slippage trade** | **High** | **fixed** |
| **F5-007 — indexer-independent exit path non-functional** | **High** | **open — infrastructure decision** |
| F5-008 — reference bundle modified, undetectable by any gate | Medium | open |
| F5-009 — pre-open buy gate is recipient-keyed | Medium | open |
| F5-010 — secrets in the npm/build/test process environment | Medium | open |
| F5-011 — VRF fee gas-indexed vs fixed coverage | Medium | open |
| F5-012 — omitted gate steps not counted in `skippedSteps` | Low | open |

Closed during this audit by a third party and **independently verified rather than accepted on report**: `F5-002` (`MIN_DELAY_SECONDS` 3 → **30** in the contract, config 12 → **30**), `F5-003` (`broadcastCapableSteps` is now a real counter), `F5-004` (both files now anchored in the manifest).

## R2.2 F5-005 — fixed

`script/DeployProjectXToken.s.sol` now enforces, on chain 999 only:

- `PROJECTX_MARKET_PRICE_CONFIRMED` and `PROJECTX_LP_LOCK_CONFIRMED` must both be true — the two flags the env template already shipped and that nothing read;
- `FWA_INITIAL_SQRT_PRICE_X96_ECHO` must equal the price exactly — double-entry on the hand-transcribed 29-digit value, using the template's own variable name;
- the resulting fully-diluted valuation must fall inside `MAINNET_FWA_MIN/MAX_INITIAL_FDV_HYPE_WEI`.

The first three run **before** any broadcast. The FDV check necessarily runs after the factory deploys the token, because the token/wHYPE ordering decides whether the pool price is HWA-per-HYPE or its inverse and the address is unknown until then. `forge script` executes `run()` to completion in simulation before broadcasting, so reverting there aborts the entire launch — no transaction is sent with an out-of-band price.

Regression test: [`test/DeployProjectXTokenGuards.t.sol`](../test/DeployProjectXTokenGuards.t.sol), covering a missing price confirmation, a missing LP-lock confirmation, a one-digit echo mismatch, and an unfilled echo. All four cases live in **one** test function deliberately: `setEnv` mutates the process environment, which is outside the EVM snapshot and shared across concurrently executing test functions, so splitting them makes them race — a defect I hit and fixed while writing them.

## R2.3 F5-006 — fixed

`ViemProtocolClient.settle()` now rejects `minTokensOut <= 0` for `acceptBidTokens` as invalid input, at the head of the method **before a wallet is prompted**, so no settlement surface — present or future — can produce an unbounded-slippage order. Two regression tests in `ViemProtocolClient.test.ts` pin both the rejection and the absence of a false positive on a legitimate non-zero minimum.

## R2.4 F5-007 — not fixed, and why

The fallback issues `eth_getLogs` over 250,000-block windows against an RPC documented at **50 blocks**. This cannot be fixed by retuning the constant: 50-block windows across millions of blocks is not a viable discovery strategy. It requires a declared archival or log-capable endpoint, the window driven by that endpoint's documented limit, and an explicit surfaced error when discovery cannot complete. Provisioning that endpoint is an infrastructure decision, not an auditor's call — so it is escalated, in the same way `F5-002` was escalated in revision 1 rather than patched.

## R2.5 Verdict

**MAINNET NO-GO.** All gates are green and two of the three new Highs are closed with regression coverage, but the indexer-independent exit path does not work against the documented production RPC, and four Mediums remain open.

Note for readers of the Codex review of 2026-07-27: its "High ouverts : 0" rests on revision 1's mis-clearing of the launch-price finding and is superseded by this revision.

---


**Remediator:** Claude Fable 5
**Date:** 2026-07-27
**Source findings:** [FABLE5_SECURITY_AUDIT_2026-07-27.md](FABLE5_SECURITY_AUDIT_2026-07-27.md) · [fable5-security-findings-2026-07-27.json](fable5-security-findings-2026-07-27.json)
**Machine-readable remediation:** [fable5-remediation-findings-2026-07-27.json](fable5-remediation-findings-2026-07-27.json)

---

## 1. Summary

One High finding was found and fixed. No Critical findings existed. No Medium was fixed, because none was required to close a Critical or High — and the one Medium that matters changes a product-visible assumption, so it was escalated rather than patched.

| | Critical | High | Medium | Low | Info |
|---|---|---|---|---|---|
| Found | 0 | 1 | 1 | 1 | 1 |
| Fixed | 0 | **1** | 0 | 0 | 0 |
| Open | 0 | 0 | 1 | 1 | 1 |

**Protocol source was not modified.** The single High finding was a defect in the test evidence, not in the contracts. The remediation is entirely additive test code.

---

## 2. F5-001 — fixed

**The finding.** The stateful invariant campaign that the release gate presents as proof of custody and liability conservation never reaches the allocated state. Its acquisition queue head-of-line blocks at sequence 1 and stays there for the entire campaign, so all three invariants only ever evaluate staged and active listings.

**Why the protocol was not changed.** Two things had to be true for the block to be permanent, and neither is a protocol defect:

- `processAcquisitions` is a strict FIFO that stops while its head is `Pending`. That is correct — it is what guarantees acquisitions settle in request order and cannot be jumped.
- The protocol already has the escape hatch: a `Pending` head expires once its word deadline block passes. It works. The campaign simply never advanced the block height, so it never fired.

The bug was that the harness could neither fulfil a non-newest request nor move the clock. Changing the FIFO or the deadline to make the old harness reach further would have weakened a real check to satisfy a broken test — exactly what the mandate forbids.

**What changed.**

`test/FWASettlementInvariant.t.sol` — rewritten as a two-actor adversarial campaign, 14 handler selectors:

- tracks **every** outstanding randomness request and fulfils an arbitrary one, so callbacks genuinely arrive out of order;
- advances block height and timestamp on both short hops (word-deadline expiry) and window-length hops (settlement and finalize windows);
- exposes all eight settlement branches rather than two;
- toggles collection transfer failure, which is the only way to reach the stuck-NFT state — a purchaser that merely refuses the ERC-721 receiver hook cannot, because non-strict delivery uses plain `transferFrom`.

`test/FWASettlementBranches.t.sol` — new deterministic suite that drives listings to `Allocated` and walks each branch explicitly, asserting listing status, NFT ownership and full native solvency at every step. Reachability is now **asserted**, not inferred from a green fuzz run.

**What deliberately did not change.**

- `test/FWAStatefulInvariant.t.sol` — left byte-for-byte intact, so the original evidence stays auditable and no pre-existing test count moves.
- `vendor/fwa-reference-union/src/FWA.sol` — untouched.

**Regression tests added (12).**

| Test | Property proven |
|---|---|
| `testKeepNFTDeliversToPurchaser` | Strict delivery settles the listing and transfers the NFT to the purchaser. |
| `testAcceptDepositorBidReturnsNFTToDepositor` | The ETH-settlement branch returns the NFT to the depositor. |
| `testRelistKeepsCustodyAndOpensNewListing` | A relist settles the old listing, opens exactly one new one, and the NFT never leaves custody. |
| `testDepositorReclaimBackingAfterSettlementWindow` | After the purchaser window lapses the depositor keeps the backing; the NFT goes to the purchaser. |
| `testDepositorReclaimNFTAfterSettlementWindow` | The depositor can instead reclaim the NFT. |
| `testFinalizeUnsettledIsPermissionlessAfterFinalizeWindow` | Any third party can resolve the default once the finalize window lapses, so neither asset can lock. |
| `testRevertingCollectionLeavesNFTCustodiedThenRecoverable` | A reverting collection cannot lock a listing: ETH legs settle, the core retains custody, recovery reverts while the collection still fails and preserves entitlement, only the owed recipient can recover, and recovery succeeds once the collection behaves. |
| `testUnfulfilledAcquisitionExpiresAndRefunds` | An acquisition whose word never arrives expires, advances the head and credits a refund — the exact state the old campaign was stuck in. |
| `testOutOfOrderCallbackDoesNotJumpTheQueue` | Fulfilling the second request first leaves it `Ready` without advancing the head; both drain in order once the head is fulfilled. |
| `invariant_TreeAndRunningTotalsSurviveSettlement` | Weight tree and running totals agree with enumerated listings across all branches. |
| `invariant_CoreCustodiesEveryOwedNFT` | The core custodies every NFT it still owes, **including one awaiting stuck-NFT recovery** — a case the original custody invariant did not cover at all. |
| `invariant_NativeBalanceCoversAllLiabilities` | Native balance covers every enumerated liability, summed across both actors. |

**Outcome: the protocol held.** Across the newly reachable state space — all eight settlement branches, out-of-order callbacks, expiry and refund, stuck-NFT custody and recovery — every invariant and every branch test passes. No custody or solvency violation was found. The finding was about the evidence; the evidence is now real.

---

## 3. Not fixed, and why

**F5-002 (Medium) — randomness round-delay margin.** The target drand round is fixed from `block.timestamp + MIN_ROUND_DELAY_SECONDS`; the configured value is 12 seconds and the contract's own floor is 3 seconds, a single beacon period. If chain time lags wall-clock by more than the configured delay, the round's signature is already public at request time and the acquirer can compute the outcome before committing.

Not fixed because it is not required to close any Critical or High, and because the delay is directly visible to users as acquisition reveal latency — changing it is a product decision. **Recommendation: raise `FWA_RANDOMNESS_MIN_ROUND_DELAY_SECONDS` to at least 30, and consider raising the contract floor above one beacon period.** This is the item that blocks a clean mainnet verdict.

**F5-003 (Low) — `broadcastCapableSteps` is a literal.** Report fidelity only; `broadcastRequested` and `broadcastPerformed` are both genuinely measured and `--broadcast` is actively rejected.

**F5-004 (Informational) — manifest root coverage.** `fork-test/` is not among the generator's roots and `indexer/subgraph.yaml` is generated from a template that *is* anchored, so neither omission creates unreviewed production surface. Recorded so the completeness claim is not overstated.

---

## 4. Release gate — full replay

`scripts/TestReleaseCandidate.ps1 -VerifyLiveTestnet`, run after remediation. Report: [release-gate-last-run.json](release-gate-last-run.json), generated `2026-07-27T11:14:15Z`.

| Step | Result | Count |
|---|---|---|
| Solidity formatting | passed | — |
| Solidity full build | passed | — |
| Solidity production contract sizes | passed | — |
| Solidity full tests | passed | **135** (min 121) |
| Release helper self-tests | passed | — |
| Project X mainnet 999 fork simulation | passed | **2** (min 2) |
| V3 testnet 998 compatibility fork simulation | passed | **4** (min 4) |
| Frontend dependency audit | passed | — |
| Frontend typecheck | passed | — |
| Frontend lint | passed | — |
| Frontend unit tests | passed | **48** (min 46) |
| Frontend production build | passed | — |
| Frontend Playwright E2E | passed | **36** (min 32) |
| Indexer production dependency audit | passed | — |
| Indexer deterministic build | passed | — |
| Indexer mainnet deterministic build | **skipped** | pre-deployment: no chain-999 addresses or manifest exist yet |
| Live 998 core attestation | passed | — |
| Live 998 drand attestation | passed | — |
| Live 998 Project X-compatible attestation | passed | — |

**Overall status: `prepared`** — correctly not `passed`, because one step is legitimately skipped pre-deployment. That distinction working as designed is itself a positive signal.

```
broadcastPolicy     forbidden
broadcastRequested  false
broadcastPerformed  false   (measured from recorded step arguments, not asserted)
chainTarget         999
skippedSteps        1
```

### Test-count reconciliation

| Suite | Expected pre-audit | After | Delta |
|---|---|---|---|
| Solidity | 123 | **135** | +12 (the new regression tests) |
| Project X fork | 2 | 2 | 0 |
| V3 testnet fork | 4 | 4 | 0 |
| Frontend unit | 48 | 48 | 0 |
| Playwright | 36 | 36 | 0 |

No count dropped. No pre-existing test was removed, renamed, skipped or weakened.

### A note in the gate's favour

The first post-remediation run **failed**, on a Solidity formatting violation in one of my own new test files. The gate caught a real defect in a change made minutes earlier and refused to report success. That is worth more than a run that was clean the first time.

---

## 5. State after this work

- **Chain 999 (mainnet): nothing deployed.** No transaction was broadcast at any point.
- **Chain 998 (testnet): unchanged.** Only read-only attestations were executed. Acquisitions remain closed and public buys remain closed; neither was opened.
- **Nest:** untouched. No file, archive or legacy module was deleted. Nest remains historical; the active release path is Project X.
- **Secrets:** no private key or `.env` secret was read out, echoed or written to any deliverable.
- **Audit anchor:** verified 276/276 before any modification, then regenerated to cover the new test files and this audit's deliverables.

## 6. Verdict

**BLOCKED PENDING PRODUCT DECISION** — on `F5-002` alone. Every gate is green and the High finding is closed with regression coverage, but the acquisition round-delay margin is a fairness property whose mitigation changes user-visible latency, and that call is not mine to make.

Deploy nothing on the strength of this report. It authorises no deployment.
