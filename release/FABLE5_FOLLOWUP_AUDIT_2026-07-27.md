# HWA — Independent hostile follow-up audit

**Auditor:** Claude Fable 5 (independent follow-up; no prior finding, closure note or gate result taken on trust)
**Date:** 2026-07-27
**Target:** HWA release candidate for HyperEVM mainnet 999 and Project X V3
**Machine-readable findings:** [FABLE5_FOLLOWUP_FINDINGS_2026-07-27.json](FABLE5_FOLLOWUP_FINDINGS_2026-07-27.json)
**Test matrix:** [FABLE5_FOLLOWUP_TEST_MATRIX_2026-07-27.md](FABLE5_FOLLOWUP_TEST_MATRIX_2026-07-27.md)
**Verdict:** [FABLE5_FOLLOWUP_MAINNET_VERDICT_2026-07-27.md](FABLE5_FOLLOWUP_MAINNET_VERDICT_2026-07-27.md)

Nothing was deployed. No transaction was broadcast. No acquisition and no public buy was opened on any chain.

---

## 1. Headline

**NO-GO**, on one open High.

The two subsystems the previous round explicitly declared unaudited — Rewards/Splitter and the frontend/indexer SSRF surface — turned out to have opposite profiles. The SSRF boundary is genuinely well built and I could not find an exploitable bypass. The Rewards subsystem is *probably* fine, but until today nothing proved it: **the FWA core to rewards boundary was executed by no test in the repository**, while mainnet cannot run without it. I fixed that, and the protocol held.

The blocking item is elsewhere and is new: `buyback()` predictably stops working shortly after a successful launch, and the token has no other exit for the protocol HYPE that keeps accruing.

### Counts

| Severity | Found | Fixed | Open |
|---|---|---|---|
| Critical | 0 | 0 | 0 |
| High | 5 | 3 | **2** |
| Medium | 10 | 2 | 8 |
| Low | 12 | 0 | 12 |
| Informational | 6 | 0 | 6 |

---

## 2. Method and trust posture

Every prior report was treated as an unverified assertion.

- **Anchor first.** I recomputed SHA-256 for all 285 entries of `release/audit-manifest.json` before touching anything: 285/285 matched, zero drift. Then I checked what the anchor *does not* cover, which produced `F5F-002`.
- **Gate reproduced, not quoted.** I re-ran `scripts/TestReleaseCandidate.ps1 -VerifyLiveTestnet` independently before changing anything and got exactly the declared state: 136 Solidity, 2 Project X mainnet fork, 4 V3 testnet fork, 48 Vitest, 36 Playwright, three live 998 attestations, `status: prepared`, `broadcastPerformed: false`, `broadcastCapableSteps: 0`.
- **Cryptography checked against the outside world, not against the repo.** I fetched drand evmnet's live chain info and round 19159982 from `api.drand.sh` and compared them to the pinned constants and the test fixture myself.
- **Coverage measured, not assumed.** "A test exists" was never accepted. The central High came from asking which configuration the tests actually construct.
- **Breadth via adversarial fan-out.** Nine hostile auditors covered the six mandated areas in parallel, each followed by an independent verifier rewarded for refuting it: 50 raw findings, 11 refuted outright and several severities corrected. I then re-derived every High myself from source before acting on it. Two agent findings that survived their verifier did not survive mine and are recorded as refuted below.

---

## 3. The fixed High findings

### F5F-001 — The rewards boundary was never executed (fixed)

The release gate's safety story rests on 136 Solidity tests and three stateful invariants. None of that evidence covers the configuration mainnet actually runs.

```
Select-String "setRewards" test/ fork-test/ hyperevm-fork-test/   ->  no matches
Select-String "setRewards" script/                               ->  3 matches
grep -c rewards  test/FWAStatefulInvariant.t.sol                 ->  0
grep -c rewards  test/FWASettlementInvariant.t.sol               ->  0
grep -c rewards  test/FWASettlementBranches.t.sol                ->  0
test/FWARewardsHyperEVM.t.sol:46  address internal constant CORE = address(0xF0A);
```

`FWA.setRewards` is called by no test. Both stateful campaigns build a core whose `rewards` is the zero address, so `_finishAcquisition` takes its `address(r) == 0` branch and never calls `settleAcquisition` or `refundAcquisition`. The rewards module's own suite impersonates the core with an EOA constant. Meanwhile `DeployHyperEVMMainnetCore` latches `REWARDS_REQUIRED_FOR_ACTIVATION` one-way, so on chain 999 acquisitions *cannot* open without a bound module.

Every reward hook reachable only through the core — `registerAcquisition`, `settleAcquisition`, `refundAcquisition`, `startEmission`, `buyFor` — was therefore unexecuted at the gate. This is the same class of defect as the previous round's `F5-001`, one subsystem over: not a bug in the code, a hole in the evidence.

**What I did.** Two additive files; no production source touched.

- `test/FWARewardsIntegrationInvariant.t.sol` — a real `FWARewardsHyperEVM` wired into a real `FWA` through `setRewards`, driven by a two-actor, 14-selector campaign (256 runs x 64 depth, 16 384 calls, zero reverts) that reaches all four settlement branches including `acceptBidAsTokens`, fulfils randomness out of order, advances the clock across reward-epoch boundaries, and exercises all four claim paths.
- `test/FWARewardsIntegrationBranches.t.sol` — 10 deterministic tests that **assert** reachability instead of inferring it.

The invariants are deliberately strict. Rewards native conservation is asserted as **equality**, not an inequality:

```solidity
assertEq(address(rewards).balance, rewards.tokenBuyAllowanceTotal());
```

That is the correct assertion because the module has no `receive` and no `fallback`, so HYPE can only enter through `settleAcquisition` (which requires `msg.value == tokenSlice`) or `buyFor` (spent within the call). Any drift means a slice was booked without funding or an allowance released without payment.

**Result: the protocol held.** All five invariants and all ten branch tests pass. No custody or solvency violation was found.

One process note, because it is the same trap this finding is about. My first version of the reachability guard was an `afterInvariant` assertion, and it failed. That was *my harness*, not the protocol: `afterInvariant` is evaluated per run, and short runs legitimately never open an acquisition. I verified that by disabling only the guard and confirming the five real invariants pass, then replaced it with deterministic reachability tests — which are strictly stronger. Weakening an invariant to get a green run is exactly the failure mode under audit here.

### F5F-002 — The audit anchor omitted deployed code (fixed)

`remappings.txt` resolves `solady/` to `vendor/fwa-reference-union/lib/solady/`. That tree was in no manifest root. Solady supplies **the entire ERC-20 implementation of the deployed HWA token**, plus `Ownable`, `ReentrancyGuard`, `SafeTransferLib` and `FixedPointMathLib` used by every HyperEVM contract; the same vendor tree supplies the Chainlink VRF interfaces and the Uniswap v4 `TickMath` the launch path uses. Four further reference trees behind the rewards, hook, claim and splitter remappings were also outside the roots.

So the manifest verified 285/285 while a modified solady would have shipped undetected. The previous round recorded a related omission as Informational because "no unreviewed production surface exists"; that assessment was wrong.

**Fixed:** roots corrected and regenerated — **286 → 441 files**, 155 previously unanchored production sources now hashed. A new self-test parses `remappings.txt`, resolves every target against the declared roots, and throws if any target escapes, plus a direct assertion that solady is hashed. The anchor can now be used for the thing it exists to prove.

### F5F-003 — Launch price was unvalidated on the active path (fixed)

The prior round closed a High called "dangerous default initial price" by citing `.env.mainnet.example`, which ships the price blank next to an echo field and FDV bounds. Those three variables were read by exactly one file: `script/InitializeNestMarket.s.sol` — the **legacy Nest path** — and under different names. The active `DeployProjectXToken.s.sol` validated only `rawSqrtPrice > type(uint160).max`.

Worse, a workspace-root `.env` exists and Foundry loads it automatically for every `forge script`. It contains:

```
FWA_TOKENOMICS_CONFIRMED=true
FWA_INITIAL_SQRT_PRICE_X96=79228162514264337593543950336     # exactly 2^96 -> 1 HWA = 1 HYPE
```

An operator launching from a shell that had not imported `.env.mainnet.local` would silently inherit both, instead of failing closed on the deliberately blank template value — and mint the entire 500M LP into an unwithdrawable locker at a 1e9 HYPE FDV, atomically and irreversibly. The closure had been verified against the wrong script.

**Fixed** (see the disclosure in §7): the active path now requires both confirmation flags, a double-entry echo match and an FDV band, with `test/DeployProjectXTokenGuards.t.sol` as regression. The echo requirement is also what defeats the implicit root `.env`: the stale testnet file defines no echo variable, so `vm.envUint` fails closed.

---

## 4. The open High — the item that blocks the verdict

### F5F-006 — `buyback()` self-disables after roughly +10%, and the token has no other HYPE exit

`launch()` derives the buyback price limit once, from the launch price:

```solidity
uint256 rawLimit = hwaIsToken0
    ? uint256(sqrtPriceX96) * TOTAL_BIPS / DEFAULT_BUYBACK_SQRT_LIMIT_BPS   // 10000/9535
    : uint256(sqrtPriceX96) * DEFAULT_BUYBACK_SQRT_LIMIT_BPS / TOTAL_BIPS;
buybackSqrtPriceLimitX96 = uint160(rawLimit);
```

`buyback()` then passes that stored value verbatim into `exactInputSingle`. A Uniswap V3 pool requires the limit to lie strictly beyond the current price in the swap direction and reverts with `SPL` otherwise. 9535 bps in sqrt space is about **+10% in price**. So once HWA appreciates ~10% above launch — the expected outcome of a successful launch — every `buyback()` call reverts.

Protocol HYPE keeps arriving at the token's `receive()`, and `buyback()` is the **only** way HYPE can ever leave it. A pattern search over `FWATokenHyperEVM.sol` for `rescue`, `withdrawNative` and `sweep` returns nothing.

The consequence is that the advertised buyback loop — permissionless, 0.5% caller bounty, 40/40/20 to depositors, purchasers and burn — stops functioning, and protocol revenue is immobilised until the owner calls `setBuybackSqrtPriceLimitX96`, and calls it again each time price moves. A permissionless mechanism becomes one that depends on continual privileged intervention; if the owner key is unavailable, the accrued HYPE is stranded.

**This is invisible to the gate by construction.** `test/mocks/MockHyperSwapV3.sol` ignores `sqrtPriceLimitX96` entirely, so no in-repo test can observe the `SPL` revert. 136 green tests say nothing about it.

**Why I did not fix it.** Every remedy either changes the buyback slippage policy (an economic parameter) or adds a new administrative power. The mandate forbids both without an explicit decision. **This is the decision that unblocks the verdict.**

---

## 5. Open Medium findings, in brief

Full detail in the JSON.

- **F5F-007 — draw fairness depends on submitter *liveness*, not just availability.** The target round publishes ~30 s after the request while FWA's word deadline is ~6 minutes, and the derived word is a pure keccak over public inputs. Submission is permissionless, so during a submitter outage an acquirer can fulfil favourable requests personally and let unfavourable ones lapse for a refund. This contradicts the runbook's claim that the relayer is "jamais une racine de confiance pour le résultat". Mitigation is the two-submitter requirement — which must now be treated as a **fairness** control.
- **F5F-008 — nothing fails closed if chain time has already passed the target round.** The 30-second floor is genuinely a contract constant (the previous `F5-002` is properly closed), but unpredictability still rests on an undocumented HyperEVM `block.timestamp` bound. A cheap non-economic hardening exists: reject a target round already proven in the registry.
- **F5F-009 — the atomic launch is pre-emptively brickable.** The factory is deployed in one transaction and `deployAndLaunch` in the next, so the token address is derivable at CREATE nonce 1; a third party can pre-initialise the canonical pool and make the launch revert indefinitely.
- **F5F-010 — metadata rate limiter** keyed on a spoofable `X-Forwarded-For`, backed by a map that is never evicted: bypassable and an unbounded-memory DoS.
- **F5F-011 — `rescueTokens` is gated on a freely reversible owner boolean.** `withdrawOnly` has no latch and no timelock, in deliberate contrast to `REWARDS_REQUIRED_FOR_ACTIVATION` in the same function, so drain-and-resume fits in one Safe multisend.
- **F5F-012 — Splitter snapshot holders cannot discover revenue in the UI** because the snapshot collection is never indexed; after 365 days `sweep()` routes it to the owner. The contract-level claim path is correct and open.
- **F5F-013 — settlement and finalize windows are read live**, so an owner can retroactively compress an already-allocated listing's purchaser window to zero.
- **F5F-014 — the drand attestation verifies a decorative constant** (`DRAND_CHAIN_HASH`, stored but unused in verification) instead of the G2 public key that actually defines the beacon.
(`F5F-015` was raised to High during final review — see below.)

### F5F-015 — the indexer-independent exit path is non-functional against the documented RPC (High, open)

I initially rated this Medium on the strength of request *volume*. Re-checking the source myself showed the problem is request *width*:

```ts
const LOG_DISCOVERY_CHUNK_BLOCKS = 250_000n;   // ViemProtocolClient.ts:63
```

`FWA_PARITY_MANIFEST.md:37` records that the official HyperEVM RPC caps `eth_getLogs` at **50 blocks**. Each discovery request is therefore 5 000× over the documented cap, so the fallback does not merely get throttled — it fails outright. This is the path users rely on to find and exit positions when the indexer is down, i.e. precisely the emergency case. Retuning the constant is not a sufficient fix on its own: at 50 blocks per request the scan is impractical, so this needs a declared archival/log-capable endpoint. The concurrent revision 2 reached the same conclusion independently and rated it High; on re-derivation I agree and have upgraded it.

---

## 6. What I checked hard and found genuinely sound

Stating this precisely matters as much as the findings.

**drand cryptography — verified against the live beacon, not the repo.**

```
live api.drand.sh          repo constant                 match
hash      04f1e906..ec8c3  DRAND_CHAIN_HASH              yes
period    3                DRAND_PERIOD_SECONDS = 3      yes
genesis   1727521075       DRAND_GENESIS_TIME            yes
scheme    bls-bn254-unchained-on-g1                      consistent (64-byte G1 sig, G2 key)
round 19159982 signature == repo fixture                 yes
sha256(signature) == published randomness                yes
```

The fixture is a genuine live drand signature, not a fabrication. The pinned G2 public key is byte-identical to drand's published serialisation, and the order passed to the pairing precompile (`x[1], x[0], y[1], y[0]`) reconstructs that serialisation exactly. `verifySingle` builds `e(sig, -G2)·e(H(m), pk) = 1` correctly.

The sharpest question here is whether `randomness = sha256(signature)` is grindable, since it hashes **raw bytes** rather than a canonical point: if a non-canonical encoding of a valid point were accepted, a submitter could choose among several hashes. It is not — `isValidPointG1` explicitly rejects `x >= N || y >= N` before any curve check. BN254 G1 has cofactor 1, so on-curve implies in-subgroup, and `(0,0)` fails the curve equation.

**Bounded residual crypto risk.** What a fixture cannot prove is that `hashToPoint` (keccak-based `expand_message_xmd` plus an SVDW map) is correct for *all* inputs; the vendored code is archived upstream and self-described as experimental. The risk is bounded, though: a wrong `hashToPoint` breaks liveness, not soundness — forging would require defeating the pairing check, which the EVM precompile performs. The dangerous class would be a hash-to-curve with a known discrete log, and even then the signer's key lives on G2 while signatures live on G1, so recovering a signature reduces to CDH. I did not perform a full RFC 9380 conformance review; that remains the one genuinely unproven cryptographic item, and it is Low-likelihood rather than unbounded.

**SSRF — no exploitable bypass found.** The metadata route uses a strict host **allowlist** (not a denylist), rejects userinfo, sets `redirect: "error"` so no redirect can reach a private address, caps the *decompressed* stream at 512 KB (so gzip bombs are caught), applies a 5-second timeout, permits no active SVG or HTML image type, validates IPFS path segments against traversal, and fails closed to the gateway alone when the allowlist is empty. The IPv6 gaps and the DNS TOCTOU I did find (`F5F-016`, `F5F-017`) sit behind that allowlist and are defence-in-depth, not bypasses.

**Splitter conservation is exact.** `nftAllocation + ownerAllocation == msg.value` always; per-token payout is bounded by `floor(nftAllocated / SNAPSHOT_SUPPLY)` so the residue is retained; duplicate token IDs in one claim array are idempotent because `claimed[tokenId]` is written before the delta is added; `forceSafeTransferETH` stops a reverting recipient from griefing others. The agent finding claiming Splitter solvency was unbounded was **refuted** — every concrete reachability path it rested on was wrong.

**No mainnet broadcast has ever occurred.** The `broadcast/` directory contains chain 998 only.

**`PrepareMainnetOwnerActions` is genuinely attesting**, not decorative: chain 999, deployed bytecode at every address, a contract Safe owner shared by all modules, acquisitions closed, withdraw-only clear, empty pool, emission not started, external buys closed, and `executable: false` unless RPC-validated.

### Coverage, stated honestly

| Area | Depth | Basis |
|---|---|---|
| 1 — Rewards and solvency | **Deep** | Produced `F5F-001`; boundary now executed and asserted by 15 new tests including an equality conservation invariant. |
| 2 — Splitter | **Moderate** | Conservation re-derived from source and the headline agent finding refuted. Still has **no stateful campaign of its own** — see prerequisites. |
| 3 — drand and BLS | **Deep** on protocol and constants, **partial** on hash-to-curve | Constants and fixture verified against the live beacon; RFC 9380 conformance not fully reviewed and explicitly bounded above. |
| 4 — Frontend/indexer SSRF | **Deep** | Whole boundary re-derived and attacked; no bypass found. |
| 5 — Project X and $HWA | **Deep** | Produced `F5F-006` and `F5F-009`; mainnet fork attestation re-run. |
| 6 — Release scripts | **Deep** | Produced `F5F-002`, `F5F-003`, `F5F-004`, `F5F-005`. |

---

## 7. Disclosure: the tree changed under the audit

At the start of this audit the manifest declared 285 files and verified 285/285 with zero drift. Partway through, it had been regenerated to 286 entries with a fresh timestamp, `script/DeployProjectXToken.s.sol` had changed, `test/utils/TestBase.sol` had grown, and a new `test/DeployProjectXTokenGuards.t.sol` had appeared — a remediation of `F5F-003` performed by a process other than this auditor, concurrently.

The same window also grew the **previous round's audit reports** — `FABLE5_SECURITY_AUDIT_2026-07-27.md` from 16 160 to 24 747 bytes and its findings JSON from 13 012 to 21 587 bytes. I initially read that as history being overwritten. **That reading was wrong and I am correcting it here:** the growth is a *revision 2* prepended above a horizontal rule, with revision 1 retained unedited below it for the audit trail. Nothing was destroyed, and the previous round explicitly flags which of its own counts must no longer be used. The concurrent writer was a prior session of this same engagement, not an unknown actor.

What remains a genuine process finding is narrower: the tree and its anchor mutated *while an audit was reading them*, so for part of this audit the anchor could not have distinguished authorised remediation from tampering. Freezing the tree for the duration of an audit remains the right control.

**Revision 2 reached NO-GO independently**, on `F5-007` (indexer-independent exit path) plus four Mediums, and raised one finding I did not make and have not independently verified: `F5-008`, that two sources inside the "immutable" `FWA_ETHEREUM_REFERENCE/FWA/sources` bundle diverge from that bundle's own `etherscan-standard-input.json`, while `remappings.txt` makes exactly that folder the code compiled for chain 999. It also correctly observes that my `F5F-002` manifest fix **cannot** detect this class of problem, because the manifest hashes the tree against itself rather than against the Etherscan-verified input. That is a fair limitation of my fix and I record it as such: the two controls are complementary, and `reference-index.json` needs to become a gate step.

I am recording this as `F5F-024` because an anchor regenerated mid-audit cannot distinguish authorised remediation from tampering. I reviewed the concurrent change, kept it because it is correct and better integrated than my own draft (which I reverted to avoid a duplicate-declaration conflict), executed its regression test as part of the final gate, and re-anchored the tree at the end. **Every finding and every gate result in this report is stated against the final tree state.**

---

## 8. Release gate

Reproduced in full before any change, and again after remediation. Detail in the test matrix. Solidity moved **136 → 152** (+15 from the new rewards-integration suites, +1 from the concurrent launch-price guard test) and frontend unit tests **48 → 50**. No pre-existing test was removed, renamed, weakened or skipped, and no count dropped. `broadcastPerformed: false` and `broadcastCapableSteps: 0` in both runs.

The gate again earned some credit: my first post-change run **failed** on a Solidity formatting violation in my own new test file. A gate that catches a defect in a change made minutes earlier is worth more than one that is clean the first time.

---

## 9. What must happen before mainnet

1. **Decide `F5F-006`** — the buyback price-limit policy. This is the blocking item.
2. Decide the Medium items that are administrative or economic rather than technical: `F5F-011` (rescue gate), `F5F-013` (window mutability), `F5F-021` (emission and empty-epoch routing).
3. Fix the cheap operational ones before launch: `F5F-012` (index the snapshot collection), `F5F-010` (rate limiter), `F5F-014` (attest the public key), `F5F-009` (single-transaction launch), `F5F-015` (bounded fallback).
4. Re-classify the two-submitter requirement as a **fairness** control and correct the runbook (`F5F-007`), and consider the cheap fail-closed check in `F5F-008`.
5. Give the Splitter its own stateful campaign, matching what Rewards now has.

Even with all of the above green, deploy nothing without a separate, explicit deployment authorisation. This audit authorises none.
