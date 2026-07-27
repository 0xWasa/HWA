# HWA — Independent hostile security audit

**Auditor:** Claude Fable 5 (independent re-audit, no prior finding taken on trust)
**Date:** 2026-07-27
**Target:** HWA release candidate for HyperEVM mainnet 999 and Project X V3
**Machine-readable findings:** [fable5-security-findings-2026-07-27.json](fable5-security-findings-2026-07-27.json)

---

# REVISION 2 — correction and expanded findings

> **Revision 1 (everything below the horizontal rule in §R2.7) contained a material error and its counts must not be used.** It is retained unedited for the audit trail. This block supersedes it.

## R2.1 What revision 1 got wrong

Revision 1 declared the dangerous-launch-price finding **"genuinely closed."** It is not, and the reasoning behind that verdict was defective in a way worth naming: I concluded it from what `.env.mainnet.example` *contains*, without checking that any code on the active path *reads* those variables. A config template listing a safeguard is not a safeguard.

The facts, re-derived from source:

- `FWA_INITIAL_SQRT_PRICE_X96_ECHO` — defined in the template, read by **zero files repo-wide**.
- `PROJECTX_MARKET_PRICE_CONFIRMED`, `PROJECTX_LP_LOCK_CONFIRMED` — shipped as `false` in the template, read by **zero files repo-wide**.
- The echo and FDV-band guards **do** exist — in `script/InitializeNestMarket.s.sol`, the **legacy Nest** path, under different names (`MAINNET_FWA_INITIAL_SQRT_PRICE_X96_ECHO`, `NEST_MARKET_PRICE_CONFIRMED`) that the mainnet template does not define.
- `script/DeployProjectXToken.s.sol`, the **active** launch path, validated the price with a `uint160` bound and a tick-width check. Nothing else.

This is precisely the "Nest remnants in the active Project X path" risk the mandate named, and I filed it as closed. That error propagated: the downstream Codex review of 2026-07-27 inherited it and records **"High ouverts : 0."** That statement is incorrect as of this revision.

## R2.2 Revised counts

| Severity | Found | Fixed | Open |
|---|---|---|---|
| Critical | 0 | 0 | 0 |
| High | **3** | **2** | **1** |
| Medium | 4 | 0 | 4 |
| Low | 1 | 0 | 1 |

Separately closed during this audit and **independently verified** (not accepted on report): `F5-002` (round-delay floor now 30 s in both contract and config), `F5-003`, `F5-004`.

## R2.3 New High findings

**F5-005 — Project X launch price had no echo, no FDV band, no confirmation gate. *Fixed.*** The launch is atomic and irreversible: deploy + pool-create + LP-mint + permanent lock in one call. `FWA_INITIAL_SQRT_PRICE_X96` is a ~29-digit decimal transcribed by hand from a signed worksheet. One transposed digit produced a permanently mispriced market with the launch LP locked at that price, while the operator believed five controls were enforcing the worksheet. Fixed by adding the two confirmation gates and the echo double-entry before broadcast, plus an FDV band check after the factory deploys the token — the token/wHYPE ordering is unknown until then, and `forge script` runs `run()` to completion in simulation before broadcasting, so a revert there aborts the launch. Regression test: [`test/DeployProjectXTokenGuards.t.sol`](../test/DeployProjectXTokenGuards.t.sol).

**F5-006 — Token settlement signed an unbounded-slippage trade. *Fixed.*** `acceptBidAsTokens` spends the entire settlement payout buying HWA on the public Project X pool. Both settlement surfaces initialise the slippage guard to `0n` and nothing re-seeds it from a quote, so a user who does not manually type a minimum signs an order accepting any price — while the UI labels the option "minOut protected". Fixed by rejecting a zero minimum as invalid input at the head of `ViemProtocolClient.settle()`, before a wallet is prompted, so no surface can produce such a transaction. Regression tests in `ViemProtocolClient.test.ts`.

**F5-007 — Indexer-independent exit path is non-functional. *Open — infrastructure decision.*** The fallback that lets users find and exit positions when the indexer is down issues `eth_getLogs` with **250,000-block** windows. The project's own documentation — `FWA_PARITY_MANIFEST.md:37`, `indexer/README.md:10`, and a prior audit — records that the official HyperEVM RPC caps `eth_getLogs` at **50 blocks**. Every request in the emergency path is rejected, so it fails exactly when it is needed. This is not a constant to retune: 50-block windows over millions of blocks is not viable. It needs a declared archival/log-capable endpoint, with the window driven by that endpoint's limit and an explicit surfaced error when discovery cannot complete. Choosing and provisioning that endpoint is an infrastructure decision, so it is escalated rather than guessed.

## R2.4 New Medium findings

- **F5-008 — the immutable Ethereum reference bundle was modified and nothing can detect it.** Two of its 65 sources diverge from the bundle's own `etherscan-standard-input.json` (`src/FWA.sol`, `src/FWAConfigKeys.sol`), and `remappings.txt` maps `fwa-reference/` to that folder, so it is the code compiled for chain 999. **The code delta itself is hardening, not a weakness** — the new `setBool(ACQUISITIONS_ENABLED)` gate *fails closed*, the launch latch is genuinely one-way, `activeBackingTotal` is maintained symmetrically on all three mutation sites, the contract is a direct deploy (all EIP-1967 slots zero) so inserted storage carries no collision risk, and the behaviour is tested and disclosed in the 2026-07-26 remediation report. What is broken is the *assurance chain*: the folder's stated invariant ("never receives HyperEVM adaptations") is false, `FWA_PARITY_MANIFEST.md` records **none** of the five deltas, and `reference-index.json` — the one artefact that detects this — is executed by **no gate step**. My own "276/276 manifest match" in revision 1 could never have caught it, because the manifest hashes the tree against itself.
- **F5-009 — pre-open buy gate is recipient-keyed**, so any third party can buy on the canonical pool via the public router while `externalBuysEnabled == false`.
- **F5-010 — mainnet deployer, drand submitter and publish keys are exported into the process environment** inherited by `npm ci`, `next build`, vitest and playwright. `ImportEnvFile.ps1` validates only that a variable *name* matches a regex.
- **F5-011 — VRF fee scales with `tx.gasprice` while coverage and bounty are fixed wei.** Not adversarially exploitable; a sustained low-gas market drains the reserve and halts `acquire()`.

## R2.5 Claims I rejected

Two plausible-sounding findings did **not** survive adversarial verification, and are recorded as rejected rather than quietly dropped:

- *"Costless atomic re-rolls of the drand draw."* Refuted — the target round is fixed at request time and fulfilment is bound to it; there is no same-transaction abort of a revealed outcome. The genuine residual is transaction **withholding** under clock skew, which is `F5-002`, now closed at a 30 s floor.
- *"A Staged listing is locked until a third party activates it."* Refuted — `activateListings` is unrestricted and the depositor can call it themselves; `listNFT`, `_acquire` and `_acquireBatch` all self-drain staging; reserved batches release on all three terminal branches of the permissionless `processAcquisitions`, whose `Pending` expiry depends on block number alone. And `withdrawListing`'s first statement is `_requireExitUnlocked()`, so in the only window where staging cannot drain, Active depositors are blocked identically — Staged adds no incremental lock.

I also corrected one of my own drafts: an earlier version of F5-006 claimed the mock engine already rejected a zero minimum and that production was weaker than the mock. False — the mock test in question covers an inactive rewards module. Neither guarded zero before the fix.

## R2.6 Revised verdict

**MAINNET NO-GO**, on `F5-007` (indexer-independent exit path non-functional against the documented RPC) plus four open Mediums. This is a downgrade from revision 1's *BLOCKED PENDING PRODUCT DECISION*: the item that previously blocked (`F5-002`) is closed, but three Highs were found that revision 1 missed, one of which revision 1 had affirmatively mis-cleared.

## R2.7 Method note

The error in revision 1 was caught by a hostile cross-check across all six mandated scope areas, whose highest-impact claims — including the three that contradicted my own published conclusions — were then put through independent adversarial refutation. Two were killed. The rest I re-derived myself from source before adopting; where an agent's supporting detail was wrong (one cited the RPC cap as 50,000 rather than 50 blocks), I used the source, not the summary.

---

_Everything below is **revision 1**, retained unedited for the audit trail. Its "genuinely closed" verdict on the launch price is wrong — see §R2.1 — and its counts are superseded by §R2.2._

---

## 1. Verdict

**BLOCKED PENDING PRODUCT DECISION.**

The code is in materially better shape than the previous audit round left it, and every prior Critical and High I re-tested is genuinely closed — including the one I expected to find papered over. But two things stop me short of a clean *MAINNET CODE READY*:

1. I found one **High** finding that the previous rounds missed, because it is a defect in the *evidence* rather than in the code: the stateful invariant campaign that the release gate presents as proof of custody and liability conservation **never once reaches the allocated state**. I fixed it and the protocol survived the newly reachable state space intact — but that means the release's central safety claim was, until today, unproven rather than proven.
2. One **Medium** finding (`F5-002`) concerns randomness fairness under chain-clock skew. Its mitigation changes acquisition reveal latency, which is a product-visible assumption. Per the audit mandate I stopped rather than change it unilaterally. **This is the decision that unblocks the verdict.**

Nothing was deployed. No transaction was broadcast. No acquisition or public buy was opened on testnet.

### Counts

| Severity | Found | Fixed | Open |
|---|---|---|---|
| Critical | 0 | 0 | 0 |
| High | 1 | 1 | 0 |
| Medium | 1 | 0 | 1 |
| Low | 1 | 0 | 1 |
| Informational | 1 | 0 | 1 |

---

## 2. Method and trust posture

I treated every previous audit report, finding classification and closure claim as unverified assertion. Concretely:

- **Anchor first.** I recomputed SHA-256 for all 276 entries in `release/audit-manifest.json` before touching anything: **276/276 match, 0 drift, 0 missing**. The manifest was not regenerated to hide a change — it was verified against the tree as found.
- **Baseline replay.** I reproduced the release gate independently before modifying any code, recording it to `release/gate-phaseA-baseline.json`. It matched the declared pre-audit state exactly: 123 Solidity, 2 Project X fork, 4 V3 testnet fork, 48 frontend, 36 Playwright; status `prepared`; no broadcast.
- **Adversarial re-derivation.** For each prior finding I re-derived the property from source rather than reading the closure note. Where a claim rested on a test fixture, I verified the fixture itself against the outside world.
- **"A test exists" was never accepted as proof.** I instrumented the shipped test suite to measure what state space it actually reaches. This is what produced `F5-001`.

---

## 3. The High finding

### F5-001 — The stateful invariant campaign is vacuous over the entire post-allocation state space

**Severity: High · Status: fixed**

The release gate runs `test/FWAStatefulInvariant.t.sol` — three invariants asserting that the weight tree matches the running totals, that the core custodies every unsettled NFT, and that its native balance covers every enumerated liability. Those three invariants are the backbone of the release's safety story. They pass. They report 16 384 calls and zero reverts.

They also never observe a single allocated listing.

**How I found it.** I built a byte-for-byte replica of the shipped `setUp()`, targeting the shipped handler, and added an `afterInvariant` probe that reports how far the campaign actually gets. After 256 runs × 64 depth:

```
nextSequenceToProcess  1        <- the acquisition queue head never moved, ever
listings Allocated     0
listings Settled       0
acquisitions Pending   6
acquisitions Ready     3
acquisitions Fulfilled 0
block.number  setUp 1 -> end 1  <- the clock never advanced
```

**Root cause — two compounding defects.**

1. The handler's `fulfill()` can only ever target `provider.lastRequestId()` ([FWAStatefulInvariant.t.sol:59](../test/FWAStatefulInvariant.t.sol#L59)). Any request that is not the newest can never receive its word. Meanwhile `processAcquisitions` is a strict FIFO that `break`s while its head is `Pending` ([FWA.sol:1559-1560](../vendor/fwa-reference-union/src/FWA.sol#L1559)). So the moment two acquisitions are outstanding at once — which happens almost immediately — the queue is head-of-line blocked.

2. The protocol has an escape hatch for exactly this: a `Pending` head expires once `block.number > meta.wordDeadlineBlock`. But Foundry does not advance block height between invariant calls, and no handler advances it either. The head can therefore neither be fulfilled nor expire. The block is permanent.

The three `Ready` acquisitions in the sample above are the signature of the bug: they hold a valid cached word that can never be consumed, because the request ahead of them in the queue is stuck forever.

**Impact.** Purchaser liability accounting, all eight settlement branches, refund credit accounting, the 24-hour purchaser window, the 7-day permissionless window and stuck-NFT custody were *all* outside the tested state space. A custody or solvency defect living in any of them would have passed the gate silently. This is false assurance on the release's central claim.

**What I did not do.** I did not modify `FWAStatefulInvariant.t.sol`, so the original evidence stays auditable, and I changed nothing in the protocol — the FIFO behaviour is correct design and the expiry hatch works, as I now prove. The fix is entirely additive.

**What I did.** Two new files:

- [`test/FWASettlementInvariant.t.sol`](../test/FWASettlementInvariant.t.sol) — a two-actor adversarial campaign with 14 handler selectors that tracks *every* outstanding request and fulfils an arbitrary one (out-of-order callbacks), advances block height and timestamp on both short and window-length hops, exposes all eight settlement branches, and can toggle collection transfer failure so the stuck-NFT state is reachable.
- [`test/FWASettlementBranches.t.sol`](../test/FWASettlementBranches.t.sol) — nine deterministic tests that drive listings to `Allocated` and walk each branch explicitly, asserting listing status, NFT ownership and full native solvency at every step.

**Result: the protocol held.** Across the newly reachable state space, all three safety invariants pass and all nine branch tests pass. No custody or solvency violation was found. The finding is about the evidence, and the evidence is now real.

---

## 4. The Medium finding — the decision that blocks the verdict

### F5-002 — Randomness round-delay floor leaves no margin against chain-clock skew

**Severity: Medium · Status: open, product decision required**

`acquire()` fixes the target drand round from `block.timestamp + MIN_ROUND_DELAY_SECONDS` ([DrandBN254Coordinator.sol:156-157](../src/hyperevm/DrandBN254Coordinator.sol#L156)). drand evmnet publishes a signature every 3 seconds, and randomness is exactly `sha256(signature)` — computable off-chain by anyone the instant the signature is public.

The entire fairness margin is therefore the gap between chain time and wall-clock time. If HyperEVM block timestamps lag wall-clock by more than the configured delay, the signature for the target round is *already public* when the acquisition is mined. An acquirer watching the beacon can compute the selection outcome before committing, and simply withhold the transaction whenever the result is unfavourable — resubmitting only on favourable rounds. That defeats the property that the requester cannot choose the winner.

Two numbers matter:

- The configured value is `FWA_RANDOMNESS_MIN_ROUND_DELAY_SECONDS=12`. Twelve seconds of margin.
- The contract's own floor is `MIN_DELAY_SECONDS = DRAND_PERIOD_SECONDS` — **3 seconds**, a single beacon period ([DrandBN254Coordinator.sol:26](../src/hyperevm/DrandBN254Coordinator.sol#L26)). If that floor were ever used, there would be effectively no protection at all.

Under normal HyperEVM operation timestamps track wall-clock closely and 12 seconds holds, which is why this is Medium and not High. But the margin is thin, and it is the only thing standing between the current design and a selectively predictable draw.

**Recommendation:** raise `FWA_RANDOMNESS_MIN_ROUND_DELAY_SECONDS` to at least 30, and consider raising the contract floor above one beacon period.

**Why I stopped instead of fixing it.** The delay is directly visible to users as acquisition reveal latency. Changing it is a product decision, not a security patch, and the mandate is explicit that a fix which changes a product assumption must be escalated. **This is the open item to decide before mainnet.**

---

## 5. Remaining open findings

**F5-003 — `broadcastCapableSteps` is a hardcoded literal (Low).** `broadcastRequested` and `broadcastPerformed` are both genuinely measured from recorded step arguments, and `Invoke-GateStep` actively throws if `--broadcast` ever appears, so the no-broadcast guarantee itself holds and is enforced. But `broadcastCapableSteps` is emitted as a literal `0` and would not track a future step that gained broadcast capability. Report fidelity, not safety.

**F5-004 — Two files inside audited roots are absent from the manifest (Informational).** `fork-test/FWAEthereumDifferential.t.sol` and `indexer/subgraph.yaml`. Both are generated or test-only, so no unreviewed production surface exists. Recorded because a manifest that silently omits files inside its own declared roots cannot be used to prove completeness.

---

## 6. Prior findings independently re-verified

Each of these was re-derived from source. None was accepted on the strength of its closure note.

**HWA-001 (was Critical) — genuinely closed, and this one deserves detail.** The drand BLS verification path rests on a test fixture. A fabricated fixture would make the whole randomness suite meaningless while still passing, so I verified the fixture against the outside world rather than against the repo. The signature is a **real drand evmnet mainnet signature for round 19159982**, confirmed against `api.drand.sh`; `sha256(signature)` reproduces the asserted randomness exactly. Chain hash, genesis time, period, scheme and the pinned G2 public key all match the live beacon, with correct coordinate ordering. On the verifier itself: `BLS.verifySingle` builds the correct pairing input for `e(sig, -G2) · e(msg, pk) = 1`, and `isValidPointG1` checks field bounds followed by curve membership — BN254 G1 has cofactor 1, so on-curve implies in-subgroup and there is no small-subgroup surface; the point at infinity `(0,0)` fails the curve equation. Note the vendored verifier still carries its upstream "experimental and unaudited" disclosure, which is disclosed rather than hidden.

**HWA-002 (was High) — genuinely closed.** `expireRequest` is permissionless and decrements `pendingRequestCount`; `withdrawNative` is blocked while `pendingRequestCount != 0`.

**HWA-003 (was High) — genuinely closed.** `START_REQUEST_ID` is derived from `keccak256(DERIVATION_DOMAIN, chainid, address(this), registry)`, so a rotated coordinator cannot reuse IDs already consumed by FWA.

**Dangerous default initial price (was High) — genuinely closed.** `.env.mainnet.example` ships `FWA_INITIAL_SQRT_PRICE_X96` empty with a double-entry echo field, explicit FDV bounds, and both `PROJECTX_MARKET_PRICE_CONFIRMED` and `PROJECTX_LP_LOCK_CONFIRMED` set false.

**Owner fail-open (was High) — genuinely closed.** All mainnet randomness parameters use strict `vm.envUint` with cross-validation. The six remaining `envOr("FWA_OWNER", deployer)` call sites are each hard-gated by `if (block.chainid != 998) revert WrongChain`.

**Gate could silently broadcast (was High) — genuinely closed**, modulo `F5-003`. `broadcastPerformed` is measured; `--broadcast` is actively rejected; the invocation switch set is recorded; status is `prepared` rather than `passed` whenever any step is skipped.

**Project X launch atomicity (was High) — genuinely closed.** `FWATokenHyperEVMFactory.deployAndLaunch` performs token deploy, locker deploy, spacing-aligned tick computation, `launch`, allocation transfer and ownership transfer in a single external call. It is permissionless, so anyone can deploy a decoy — but the canonical address is pinned by the manifest, which is the documented mitigation.

---

## 7. Coverage, stated honestly

The mandate names six scope areas. My depth was not uniform across them, and pretending otherwise would be the same failure as `F5-001`.

| Area | Depth | Basis |
|---|---|---|
| 1 — Core FWA and liability conservation | **Deep** | Produced `F5-001`; all eight settlement branches now proven reachable with custody and solvency asserted; out-of-order callbacks and expiry/refund proven. |
| 2 — drand randomness | **Deep** | Fixture verified against the live beacon; pairing equation, point validation and subgroup surface re-derived; request↔round binding, confirmations, replay no-op and expiry re-read in source. Produced `F5-002`. |
| 3 — Project X and $HWA | **Moderate** | Launch atomicity verified in source; the two mainnet fork tests pass. Tier, spacing, distribution split and locker semantics were read, not independently fuzzed. |
| 4 — Rewards and Splitter | **Light** | Covered only by the existing suite. **Not independently audited.** |
| 5 — Deployment and release scripts | **Deep** | Owner fail-open, chain gating, price template, broadcast measurement and gate status semantics all re-derived. Produced `F5-003` and `F5-004`. |
| 6 — Frontend and indexer | **Light** | Covered by typecheck, lint, 48 unit tests, 36 Playwright tests and the production build. **The SSRF, redirect, private-IP, port, data-URI, size and timeout surface was not independently probed.** |

**Areas 4 and 6 should not be considered audited by this pass.** They are the natural targets for the next round.

One process disclosure: a parallel multi-lens analysis was launched at the start of this audit to widen coverage across all six areas. It never returned a result and was still running when this report was written, so **nothing in this report derives from it**. Every finding here comes from direct inspection, instrumentation and execution that I performed and can point at. The areas it was meant to reinforce — principally 3, 4 and 6 — are correspondingly thinner, and are marked as such above rather than credited to work that did not complete.

Known limits already documented by the team, which I confirmed are real and unfixable rather than oversights: third-party LPs cannot be forbidden; exact-output swaps cannot be blocked once public trading opens; Project X controls its own protocol fee share.

---

## 8. Release gate

Full replay of `scripts/TestReleaseCandidate.ps1 -VerifyLiveTestnet` after remediation. Results are recorded in [release-gate-last-run.json](release-gate-last-run.json) and summarised in the remediation report.

Test counts moved **123 → 135 Solidity** (+12, entirely the new regression tests). No pre-existing test was removed, renamed, weakened or skipped, and no other count dropped.

One note in the gate's favour: the first post-remediation run **failed**, on a Solidity formatting violation in my own new test file. That is the gate catching a real defect in a change made minutes earlier, which is worth more than a clean run.

---

## 9. What must happen before mainnet

1. **Decide `F5-002`** — raise the acquisition round delay to at least 30 seconds, accepting the reveal-latency change, or accept the documented clock-skew risk in writing. This is the blocking item.
2. Audit **Rewards/Splitter** and the **frontend/indexer SSRF surface** with the same hostility applied to areas 1, 2 and 5.
3. Optionally close `F5-003` and `F5-004` — both are cheap and both improve the integrity of the audit apparatus itself.

Even with all of the above green, deploy nothing without a separate, explicit deployment authorisation. This audit authorised none.
