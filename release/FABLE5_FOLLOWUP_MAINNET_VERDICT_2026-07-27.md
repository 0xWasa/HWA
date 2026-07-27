# HWA — Mainnet verdict

**Date:** 2026-07-27 · **Auditor:** Claude Fable 5 · **Target:** HyperEVM mainnet 999, Project X V3

---

# NO-GO

---

## Why

Two **High** findings are open. Neither is a documentation or evidence problem: both are mechanisms that do not work when they are needed.

**`F5F-015` — the indexer-independent exit path is non-functional against the documented RPC.** `LOG_DISCOVERY_CHUNK_BLOCKS = 250_000n` (`ViemProtocolClient.ts:63`) while `FWA_PARITY_MANIFEST.md:37` records the official HyperEVM RPC capping `eth_getLogs` at **50 blocks** — 5 000× over. The path users rely on to find and exit positions when the indexer is down therefore fails outright rather than degrading. Retuning the constant is not sufficient: at 50 blocks per request the scan is impractical, so this needs a declared archival/log-capable endpoint. I first rated this Medium on request volume and raised it to High after re-deriving it from source on request width; the concurrent revision 2 reached the same conclusion independently.

**`F5F-006` — `buyback()` self-disables after roughly +10% price appreciation, and the token has no other HYPE exit.**

The buyback price limit is derived once at launch, at about +10% in price terms, and passed verbatim into every subsequent swap. A Uniswap V3 pool reverts (`SPL`) when the limit has already been crossed. So once HWA appreciates ~10% above its launch price — the expected outcome of a successful launch — every permissionless `buyback()` call reverts, while protocol HYPE keeps accruing to a contract that exposes no rescue, sweep or withdraw path. The advertised loop (permissionless execution, 0.5% caller bounty, 40/40/20 routing) stops functioning, and restoring it requires the owner to reset the limit and to keep resetting it as price moves.

The repository's V3 mock ignores `sqrtPriceLimitX96` entirely, so **no in-repo test can observe this**. The 152 passing Solidity tests say nothing about it.

Every available remedy changes the buyback slippage policy or adds a new administrative power. Both are outside what an audit may change unilaterally, so this is escalated rather than patched.

## The GO criteria, assessed one by one

| Criterion | Status |
|---|---|
| No open Critical or High | **FAILED** — `F5F-006` and `F5F-015` are open |
| Rewards/Splitter solvency demonstrated by useful invariants | **Partially met.** Rewards is now genuinely proven, including an exact-equality HYPE conservation invariant, across a state space that no test reached before today. Splitter conservation was re-derived from source and the headline claim against it refuted, but it still has **no stateful campaign** |
| No exploitable SSRF bypass open | **MET** — the boundary was attacked directly and no bypass was found |
| drand cryptographic risk clearly bounded | **MET** — see below |
| Full gate passes | **MET** — `status: prepared`, the single skip being the legitimate pre-deployment indexer build |
| No broadcast occurred | **MET** — `broadcastPerformed: false`, `broadcastCapableSteps: 0`; `broadcast/` contains chain 998 only |
| Residual risks and operational prerequisites listed | **MET** — below |

Because the mandate permits GO only when **no Critical or High is open**, GO is unavailable. I record NO-GO rather than CONDITIONAL GO because both open items require code changes — one of them alongside a product decision and the other alongside an infrastructure decision — not merely operational mitigations.

## What converts this to CONDITIONAL GO

1. Decide and implement `F5F-006` (buyback price-limit policy), with a regression test that models the V3 `SPL` precondition — the current mock cannot.
2. Declare an archival/log-capable RPC endpoint and rework the discovery scan so `F5F-015` actually functions, with the working window asserted against the endpoint's documented cap.
3. Decide the administrative and economic Mediums: `F5F-011` (reversible rescue gate), `F5F-013` (retroactively mutable settlement windows), `F5F-021` (stranded emission, empty-epoch routing).

## What then converts it to GO

4. Fix the cheap operational Mediums: `F5F-012` (index the Splitter snapshot collection, or the 365-day sweep will route holder revenue to the owner), `F5F-010` (rate limiter), `F5F-014` (attest the BN254 public key rather than a decorative constant), `F5F-009` (single-transaction launch).
5. Make `reference-index.json` a gate step, so a divergence between `FWA_ETHEREUM_REFERENCE` and its Etherscan-verified standard input is detectable. My `F5F-002` manifest fix cannot catch that class of problem — it hashes the tree against itself — and the concurrent revision 2 reports exactly such a divergence as its `F5-008`.
6. Give the Splitter a stateful campaign matching the one Rewards now has.
7. Re-classify the two-submitter requirement as a **fairness** control, not just availability (`F5F-007`), and correct the runbook statement that the relayer is never a root of trust for the result.
8. Close the remaining launch gates that were already open before this audit: Safe and signers, Genesis snapshot and recipients, canary and public collections, signed launch-price worksheet, two independent monitored drand submitters, source verification, closed-market E2E then a real canary.

## Cryptographic risk — bounded, as required

Verified first-hand against the live beacon rather than against the repository:

- chain hash, period (3 s), genesis (1727521075) and scheme (`bls-bn254-unchained-on-g1`) all match the pinned constants;
- the test fixture is a **genuine live drand signature** for round 19159982, not a fabrication;
- `sha256(signature)` reproduces the published randomness exactly;
- the pinned G2 public key is byte-identical to drand's serialisation, and the coordinate order passed to the pairing precompile reconstructs it exactly;
- `randomness = sha256(signature)` is **not grindable**: `isValidPointG1` rejects `x >= N || y >= N`, so no non-canonical encoding of a valid point can yield an alternative hash. BN254 G1 has cofactor 1, so on-curve implies in-subgroup, and `(0,0)` fails the curve equation;
- the mainnet 30-second round-delay margin is a **contract constant enforced in the constructor**, not merely configuration.

**What remains unproven:** full RFC 9380 conformance of the vendored keccak-based `expand_message_xmd` and SVDW map, whose upstream is archived and self-described as experimental. The risk is bounded rather than open-ended: an incorrect hash-to-curve breaks liveness, not soundness, because forgery would have to defeat the pairing check performed by the EVM precompile, and the signer's key lives on G2 while signatures live on G1, so recovering a signature reduces to CDH. Residual likelihood: low. Residual impact if wrong: randomness fails closed rather than becoming forgeable.

The unbounded assumption is **not** cryptographic but temporal: `F5F-008`, the absence of any published bound on HyperEVM's `block.timestamp` divergence from wall-clock time. That is what the 30-second margin is buying, and it is an assumption rather than a proof.

## Residual risks accepted or open at this verdict

- Draw fairness depends on submitter **liveness**, not merely availability (`F5F-007`).
- Randomness unpredictability rests on an undocumented HyperEVM timestamp bound (`F5F-008`).
- The owner Safe can drain earned, unclaimed HWA and resume operation in a single multisend (`F5F-011`), and can retroactively compress an allocated listing's settlement window (`F5F-013`). Both reduce to trust in the Safe and its signers, and both intersect the still-open timelock decision.
- The launch can be griefed indefinitely by pre-initialising the canonical pool at a predictable token address (`F5F-009`).
- Project X constraints already accepted and re-confirmed: third-party LPs cannot be forbidden, exact-output cannot be blocked once trading opens, and Project X retains control of its protocol fee share.
- Splitter has no stateful coverage.
- The V3 mock models neither price limits nor partial fills.

## Audit-integrity disclosure

The audit anchor verified 285/285 with zero drift at the start of this audit. Partway through it had been regenerated and several production files changed, by a remediation process running concurrently with the audit (`F5F-024`). I reviewed the concurrent change, kept it, executed its regression test in the final gate, and re-anchored the tree at the end. **All findings and gate results here are stated against the final tree state.**

The same window also edited the previous round's reports in place — `FABLE5_SECURITY_AUDIT_2026-07-27.md` and its findings JSON both grew by roughly 50% — despite the mandate requiring them to be preserved as immutable history. This auditor modified neither. The practical consequence is that the previous round's audit trail is now weaker than it was when this audit started.

An anchor regenerated mid-audit cannot by itself distinguish authorised remediation from tampering. Future audits should freeze the tree for their duration, and remediation should supersede prior reports with new files rather than rewriting them.

---

**This document authorises no deployment, no activation and no broadcast.** Nothing was deployed and nothing was broadcast in producing it.
