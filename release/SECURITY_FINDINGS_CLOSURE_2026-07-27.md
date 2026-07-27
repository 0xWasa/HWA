# HWA security findings closure

Date: 27 July 2026  
Scope: Project X launch path, FWA core, HWA rewards, Splitter, drand BN254, emergency log recovery

This is a remediation record, not an independent audit report. Prior auditor artifacts are preserved.

## Closure table

| Finding | Status | Remediation | Regression evidence |
|---|---|---|---|
| Project X pool pre-initialisation / non-atomic launch | **Fixed** | `FWATokenHyperEVMFactory` constructor now creates HWA, creates/initialises the canonical pool, mints the full launch position and binds the permanent locker in the same transaction. No public factory nonce exists between factory deployment and token launch. | `FWATokenHyperEVMTest.testFactoryDeploysAndLaunchesAtomically`; mainnet Project X fork atomic/adversarial launch test |
| Rewards rescue can consume participant rewards | **Fixed** | Token liabilities are enumerated and rescue is limited to `balance - liabilities`. Emergency native allowance recovery requires core wind-down and preserves solvency. Emission is one-shot; an empty listing pool pauses depositor emission and an empty purchaser epoch is burned exactly once. | `FWARewardsHyperEVMTest.testRescueOnlyTransfersSurplusAndPreservesParticipantLiability`; `testEmergencyAllowanceWithdrawalRequiresCoreWindDownAndPreservesSolvency`; rewards stateful invariants |
| Settlement/finalisation windows retroactively mutable | **Fixed** | Each allocation snapshots the purchaser settlement and public finalisation deadlines. Owner setters have explicit min/max and ordering bounds and affect future allocations only. Frontend derives deadlines per allocation instead of from current globals. | `FWASettlementBranchesTest.testWindowChangesOnlyAffectFutureAllocations`; `testSettlementWindowBoundsAreEnforced`; settlement stateful invariants |
| Drand attestation checks a decorative identifier only | **Fixed** | Production verification compares the deployed Registry, evmnet chain hash/DST and all four G2 public-key coordinates. Requests reject a target round already public at request time. Signatures are verified on-chain before a word can reach FWA. | `DrandBN254CoordinatorTest.testOfficialEvmnetFixtureIsVerifiedOnchain`; forged/on-curve wrong-signature tests; verifier script negative checks |
| Forced native balance trapped in coordinator | **Fixed** | Permissionless/accounted reserve is preserved and only forced surplus may be recovered by the owner. | `DrandBN254CoordinatorTest.testForcedNativeSurplusRecoveryPreservesSubscriptionReserve` |
| Splitter launch readiness and post-close ambiguity | **Fixed** | Split and snapshot must be frozen; revenue clock starts explicitly at launch; ownership cannot be renounced; post-close deposits emit a dedicated event. | 13 Splitter unit/fuzz tests including readiness, freeze, ownership and sweep |
| Emergency log recovery cannot operate on production providers | **Code fixed; infrastructure qualification pending** | Browser uses a same-origin, `eth_getLogs`-only proxy with contract allowlist, bounded ranges, rate/memory limits and server-only provider credentials. Release promotion requires a fresh chain-999 archive/range probe artifact. | 3 route tests; `scripts/TestLogRpc.ps1`; `scripts/TestReleaseCandidate.ps1 -MainnetMode` |

## Mechanical validation after remediation

- Solidity: `165 passed, 0 failed, 0 skipped`.
- Stateful invariants: settlement, core accounting and rewards liabilities passed with zero handler reverts.
- Frontend unit: `74 passed, 0 failed`.
- Frontend TypeScript, lint and production build: passed.
- Frontend Playwright: `36 passed, 0 failed` in the complete v2 gate.
- Indexer dependency audit and deterministic build: passed.
- Project X chain-999 fork: `2 passed, 0 failed` in the complete v2 gate.
- V3 chain-998 compatibility fork: `4 passed, 0 failed` in the complete v2 gate.
- Live chain-998 attestation at block `59976446`: core, drand BN254, Project X-compatible modules and post-E2E v2 state all passed.
- On-chain gameplay E2E: request, independently proven drand round, allocation processing and `keepNFT` settlement completed; the purchaser owns the selected NFT and the core returned to zero in-flight liabilities.
- Solidity build and production contract-size gate: passed.

Evidence is recorded in `release/release-gate-testnet-v2-2026-07-27.json`,
`release/release-gate-testnet-v2-live-2026-07-27.json` and
`release/testnet-attestation-projectx-998.json`.

The remaining required security action is an independent delta audit bound to the regenerated
`release/audit-manifest.json`. No Critical or High is knowingly open in the local remediation scope;
the production log provider remains an operational launch blocker until its credentialed probe passes.
