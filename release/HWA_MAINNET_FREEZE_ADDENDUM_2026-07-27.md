# HWA mainnet freeze addendum — Safe, recipients and launch economics

Date: 27 July 2026  
Target: HyperEVM mainnet (`chainId=999`)  
Broadcast performed: **Safe deployment only**

## Frozen inputs

- Safe owners:
  - `0x645b7e2A32cfF5e131a3D6Cf16155e006fe74F5c`
  - `0x487F29A5C4eE0669D40d77Cd78F5b6A95046fECB`
  - `0x10B327d693F223399F2D8151B2B97a66818FF681`
- threshold: `2 of 3`;
- deployed Safe: `0x75818fd0a2Ff801F974C9a5d23616fbd38b15f4C`;
- Safe deployment transaction:
  `0x08388e69e7735803257ab78a8c53aa5e530fcbd8fc9983e28288bc27957625cc`;
- remaining-stack deployer: `0x24398fc31899E2384E4E070fcdBF8Bb6D916FcD9` (nonce 0,
  funded incrementally); the Safe deployment payer has no Safe or protocol role;
- operational ceiling: `20 HYPE`;
- HYPE contributed to the one-sided Project X LP: `0`;
- Splitter secondary recipient: explicit zero address;
- Project X fee recipient and 200 M HWA ecosystem recipient: the deployed Safe;
- HWA Genesis initial custody: 333 NFTs to the Safe in batches `100/100/100/33`.

The Safe is deployed and live-attested. The fee and ecosystem fields remain zero in the public
template but are set to the Safe in the ignored local environment only after the synchronizer's
live chain-999 check passes.

## Implementation delta

- added the minimum canonical Safe interfaces;
- added deterministic `DeployHWASafe` and read-only `VerifyHWASafe` scripts;
- pinned Safe v1.4.1 singleton, proxy factory and compatibility fallback-handler deployments and
  their chain-999 runtime code hashes;
- configured no setup delegatecall, no modules and a 2-of-3 threshold;
- aligned deployment/readiness scripts with the reference Splitter's documented optional secondary
  recipient instead of incorrectly requiring a non-zero address;
- added a zero-secondary payout regression;
- added an independent launch-FDV/tick calculation and regression for both token orderings;
- materialised the 333 Genesis custody recipients without freezing metadata prematurely.

## Validation performed

| Validation | Result |
|---|---:|
| Default Solidity suite | `168 passed, 0 failed` |
| Stateful/invariant campaigns | included in the 168; `256 × 64` per invariant campaign |
| Project X chain-999 fork | `3 passed, 0 failed` |
| Canonical Safe ephemeral chain-999 fork deployment | passed; predicted address matched |
| Safe deployment dry-run | passed before broadcast |
| Safe live deployment | receipt `1`; 306,207 gas; `0.0000612414 HYPE` |
| Safe post-deployment attestation | version 1.4.1, exact owners, threshold 2, zero modules |
| Release helper self-tests | passed |
| Genesis custody artifact | 4 batches, 333 recipients, one Safe, no broadcast |

The `hyperevm` Foundry profile contains both legacy HyperSwap chain-998 tests and Project X/Nest
chain-999 tests. It must not be run wholesale against a single RPC. The relevant Project X suite is
`hyperevm-fork-test/ProjectXDeployment.t.sol`; all three tests passed against chain 999.

## Irreversible items still blocked

1. final immutable HWA Genesis base URI and metadata review;
2. final HWA token ordering and exact `sqrtPriceX96`, derived from the launch deployer nonce;
3. credentialed production archive/log RPC qualification;
4. independent delta-audit bound to the regenerated audit-manifest hash.

No chain-999 protocol, NFT, pool or token deployment is authorized by this addendum. The Safe is
the sole completed mainnet deployment.
