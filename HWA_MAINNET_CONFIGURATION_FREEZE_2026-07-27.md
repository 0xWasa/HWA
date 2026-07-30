# HWA mainnet configuration freeze

Reference date: 27 July 2026  
Target: HyperEVM mainnet (`chainId = 999`)  
Status: **Safe, treasury recipients and 20 HYPE ceiling frozen; launch price, final Genesis URI and production RPC credential still BLOCKED**

This file is the only launch worksheet for irreversible HWA mainnet values. A value marked
`BLOCKED` must be supplied and checksum-verified before any chain-999 broadcast. Testnet values,
the workspace root `.env`, and previously deployed addresses are never valid substitutes.

## 1. Frozen protocol identity and allocation

| Field | Frozen value |
|---|---:|
| Token name | `Hyper World Assets` |
| Token symbol | `HWA` |
| Decimals | `18` |
| Fixed supply | `1,000,000,000 HWA` |
| Permanently locked Project X LP allocation | `500,000,000 HWA` |
| Depositor rewards allocation | `150,000,000 HWA` |
| Purchaser rewards allocation | `150,000,000 HWA` |
| Ecosystem / historical allocation | `200,000,000 HWA` |
| External token buys at deployment | `false` |
| External token-buy activation | manual owner/Safe action only |

There is no timer and no automatic market opening. The canonical launch is constructor-atomic:
launch-factory deployment, token creation, canonical pool creation/initialisation, launch LP mint,
and permanent LP custody all happen in one transaction.

## 2. Frozen Project X integration

| Field | Frozen value |
|---|---:|
| Factory | `0xFf7B3e8C00e57ea31477c32A5B52a58Eea47b072` |
| Router | `0x1EbDFC75FfE3ba3de61E7138a3E8706aC841Af9B` |
| Nonfungible position manager | `0xeaD19AE861c29bBb2101E834922B2FEee69B9091` |
| wHYPE | `0x5555555555555555555555555555555555555555` |
| Pool fee tier | `10,000` (1%) |
| Tick spacing | `200` |
| Launch range width | `3,600` ticks |
| Buyback oracle | Project X pool TWAP, 30 minutes |
| Buyback minimum output | dynamic, at least 90% of the TWAP-derived post-fee quote |
| LP principal | permanently non-withdrawable |

Accepted Project X non-parities: third parties may add liquidity; exact-output buys cannot be
blocked after public trading opens; Project X controls its protocol fee share.

## 3. Frozen gameplay economics

| Field | Frozen value |
|---|---:|
| Acquisition surcharge | `1,000 bps` (10%) |
| Selection settlement drift | `1,000 bps` (10%) |
| HYPE settlement payout | `8,500 bps` (85%) |
| Owner acquisition fee | `100 bps` (1%) |
| Owner settlement fee | `100 bps` (1%) |
| Purchaser-only settlement window | `24 hours`, snapshotted per allocation |
| Public/depositor finalisation window | `7 days`, snapshotted per allocation |
| Top-listing share | `100 bps` (1%) |
| Top-listing threshold | `1,000 bps` (10%) |
| Protocol fee routed to HWA | `8,000 bps` (80%) |
| Maximum acquisitions per transaction | `1` |
| Maximum activations per acquisition | `1` |
| Rewards required before activation | `true`, one-way latch |
| Minimum backing | `0.25 HYPE` |

The 24-hour and 7-day values may only be changed within the contract bounds for future
allocations. Existing allocations retain their request-time snapshots.

## 4. Frozen randomness configuration

| Field | Frozen value |
|---|---:|
| Beacon | drand evmnet BN254 |
| Verification | BN254 BLS signature checked on-chain against all four public-key coordinates |
| Minimum target-round delay | `30 seconds` |
| Request expiry | `7,200 HyperEVM blocks` |
| Maximum verified-round age | `300 seconds` |
| Callback gas limit | `700,000` |
| Selection timeout | `360 HyperEVM blocks` |
| Minimum native reserve buffer | `0.0008 HYPE` |
| Maximum reserved fulfillment cost | `0.0002 HYPE` |
| Initial coordinator reserve | `0.001 HYPE` |
| Permission model | permissionless proof submission; two independent production submitters |

The registry address, coordinator address, deployment block and the two submitter addresses are
deployment outputs, not pre-filled configuration. The mainnet verifier must compare the Registry,
chain hash, DST and every public-key coordinate before activation.

## 5. Safe, recipients and operational budget

The administration baseline is a deterministic canonical Safe v1.4.1 proxy. It was deployed and
attested on chain 999. The preparation transaction and canonical code hashes are recorded in
`release/hwa-safe-mainnet-preparation.json`; the deployment transaction is
`0x08388e69e7735803257ab78a8c53aa5e530fcbd8fc9983e28288bc27957625cc`.

| Field | Frozen value / state |
|---|---|
| Deployed Safe | `0x75818fd0a2Ff801F974C9a5d23616fbd38b15f4C` |
| Signer 1 | `0x645b7e2A32cfF5e131a3D6Cf16155e006fe74F5c` |
| Signer 2 | `0x487F29A5C4eE0669D40d77Cd78F5b6A95046fECB` |
| Signer 3 | `0x10B327d693F223399F2D8151B2B97a66818FF681` |
| Threshold | `2 of 3` |
| Safe singleton | `0x41675C099F32341bf84BFc5382aF534df5C7461a` |
| Safe proxy factory | `0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67` |
| Compatibility fallback handler | `0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99` |
| Modules / guard / setup delegatecall | none / none / none |
| Safe deployment payer | `0xd565B4D357aF8e9e06dDb9b66008c868b03718AE`; no Safe ownership or protocol role |
| Remaining-stack deployer | `0x24398fc31899E2384E4E070fcdBF8Bb6D916FcD9` (EOA, nonce `0`, funded with `16.675 HYPE`) |
| Splitter secondary recipient | zero address; the complete 70% owner side goes to the Safe |
| Project X LP-fee recipient | the deployed Safe |
| Recipient of the `200,000,000 HWA` ecosystem allocation | the deployed Safe |
| Maximum operational budget | `20 HYPE` total |
| HYPE contributed to launch LP | `0 HYPE`; the Project X launch position is one-sided in HWA |

The deployed address is placed into `FWA_OWNER`, `FWA_PROJECTX_FEE_RECIPIENT` and
`FWA_LEGACY_ALLOCATION_RECIPIENT` only by the fail-closed synchronizer after `getOwners()`,
`getThreshold()` and bytecode have been re-attested on-chain.
All three signer addresses were checksum-verified, distinct and EOAs at preparation block
`41,593,962`; they had no mainnet HYPE at that block. The 20 HYPE number is a ceiling, not a
spending target. Every actual spend remains receipt-backed.

## 6. Splitter and HWA Genesis

| Field | Frozen value / state |
|---|---|
| Owner side | `70%` |
| Snapshot-NFT side | `30%` |
| Secondary recipient | disabled (`address(0)`); the complete owner-side allocation goes to the Safe |
| Claim period | 365 days, clock starts only after the separate `startRevenueClock()` action |
| Split mutability after activation | none; `freezeSplit()` is irreversible |
| HWA Genesis maximum supply | `333` |
| Canonical HWA Genesis art | `Pressure Field` v3, renderer `HWA-GEN-3.0.0` |
| Canonical art aggregate | `96b80e5c8a06b07407d92b58dbf7865aab242439bdfdb5d8436e370cd2915648` |
| Visual approval | **COMPLETE** — final v3, all five class masters and the three CROWNs approved |
| Initial mainnet Genesis custodian | all `333` tokens minted to the deployed Safe in four batches (`100/100/100/33`) |
| Community recipient list | may be executed later as reviewed Safe transfers; not embedded in the NFT contract |
| Mainnet Genesis base URI | **BLOCKED — immutable final URI required before snapshot freeze** |

Genesis is an identity/bootstrap collection and the revenue snapshot, not synthetic low-quality
loot. Minting all IDs to the Safe removes the need to invent public recipients before deployment;
the ERC-721s remain transferable and Splitter claim rights follow the current token owner. The Safe
must not claim the NFT-side allocation before the intended community distribution. Metadata review,
all 333 mints and supply checks must finish before `freezeSnapshot()`; the Splitter can only be
deployed against a frozen, non-empty snapshot. The exact four custody batches are materialised in
`release/hwa-genesis-custody-recipients.json`.

The final deterministic collection, exact five-class distribution and geometry-fingerprint checks
are documented in `HWA_GENESIS_COLLECTION_V3_SPEC.md`. v1/v2 are archived design history and are
not eligible for the mainnet base URI. Visual approval is complete; the base-URI blocker remains
until the versioned HTTPS package is served from the production VPS and all 666 resources pass the
remote hash/MIME/cache attestation. `release/hwa-genesis-canonical.json` is the fail-closed record.

## 7. Initial collection allowlist

The contracts below were re-attested on chain 999 at block `41,698,655` for code, ERC-721 support,
creation receipt, displayed supply and a representative `tokenURI`. Only Hypio is opened for the
first canary. PiP & Friends and Odd Otties require a separate post-canary Safe batch. Hypurr is
pre-indexed but remains closed. The exact legacy Catbal contract is deferred because its metadata
surface is empty. The machine-readable evidence is
`release/hwa-mainnet-collections-attestation.json`.

| Stage | Collection | Contract | Deployment block | Supply observed | Notes |
|---|---|---|---:|---:|---|
| Canary | Hypio | `0x63eb9d77d083ca10c304e28d5191321977fd0bfb` | 390,921 | 5,405 | first live listing/acquisition only; IPFS metadata |
| Wave 1 | PiP & Friends | `0xbc4a26ba78ce05e8bcbf069bbb87fb3e1dac8df8` | 3,727,372 | 7,777 | open after canary; `static.drip.trade` metadata |
| Wave 1 | Odd Otties | `0x43a9652e2b3ce8970e8d33d8c34252a59a6596aa` | 1,835,630 | 3,333 | open after canary; `otties.mypinata.cloud` metadata |
| Deferred | Catbal | `0x8027f4306f85aa03325574879170fbca365b9f52` | 13,231,668 | 1,755 | immutable EIP-1167 target `0x09a26f...dd6a`; `tokenURI(1)` is empty, so it is not indexed or allowlisted at launch |
| Indexed, closed | Hypurr | `0x9125e2d6827a00b0f8330d6ef7bef07730bac685` | 15,060,098 | 4,600 | higher-value collection; open later through a separate reviewed Safe action |

The production manifest records the deployment blocks above and every metadata hostname. The
ignored mainnet environment now contains Hypio as canary, PiP/Otties as the post-canary public
batch, and Hypurr as an indexed-but-closed collection. No frontend label, ticker or marketplace URL
is sufficient authority for an allowlist action. Catbal can be reconsidered after choosing a
metadata-bearing contract; the two Illumeownati contracts are not silently substituted.

## 8. Remaining mainnet blockers

The recipient choices no longer need to be invented. The following items remain intentionally
fail-closed and cannot be inferred safely by a deployment script.

| Required value | Status |
|---|---|
| Safe deployment | **COMPLETE** — deployed and attested 2-of-3 |
| Remaining-stack deployer | **FROZEN/FUNDED** — `0x2439…6FcD9`, nonce 0; each broadcast still needs its release gate |
| Safe signers and threshold | **FROZEN** — the three addresses above, `2 of 3` |
| Splitter secondary recipient | **FROZEN** — explicit zero-address decision |
| Project X fee and ecosystem recipients | **FROZEN** — deployed Safe |
| Operational HYPE budget | **FROZEN** — maximum `20 HYPE`, zero launch-LP HYPE |
| Launch target / signed band | **FROZEN** — `640 HYPE` target, `600–700 HYPE` band |
| Exact launch `sqrtPriceX96`, entered twice | **BLOCKED** — selected only after the final launch deployer nonce fixes HWA token ordering |
| HWA Genesis production origin | **BLOCKED** — final HTTPS VPS hostname required |
| HWA Genesis final base URI | **BLOCKED** — versioned HTTPS package and 666-resource remote attestation required; visual approval is complete |
| Genesis initial mint strategy | **FROZEN** — 333 tokens initially held by the Safe |
| Production logs/archive RPC | **BLOCKED** — qualified provider URL, credential and maximum log range required |

The prepared launch-price worksheet is `release/hwa-launch-economics-preparation.json`. At the
proposed 640 HYPE FDV it contains both ordering-dependent candidates:

| Ordering at launch | `sqrtPriceX96` | Launch range |
|---|---:|---:|
| HWA is token0 (`HWA < wHYPE`) | `63382530011411470074835160` | `[-142600, -139000]` |
| HWA is token1 (`HWA > wHYPE`) | `99035203142830421991929937920000` | `[139000, 142600]` |

Exactly one row will apply. The launch script must derive the HWA CREATE address from the funded
deployer nonce, select that row and reproduce the FDV independently before broadcast.

## 9. Freeze ceremony

Before any remaining chain-999 broadcast:

1. re-verify the already deployed Safe, its owners and its 2-of-3 threshold;
2. verify every address independently in two tools and confirm Safe threshold/signers on-chain;
3. publish and review the final Genesis metadata, mint all 333 IDs to the Safe, then freeze it;
4. confirm the launch FDV, calculate token ordering, price, tick, range and FDV twice independently;
5. populate `.env.mainnet.local` with the deployed Safe and reviewed recipients;
6. qualify the production log RPC and run `scripts/TestReleaseCandidate.ps1 -MainnetMode`;
7. regenerate `release/audit-manifest.json` and bind the independent audit to its root hash;
8. simulate every Safe batch against a fresh chain-999 fork;
9. broadcast only through the documented, acquisitions-closed sequence and within the 20 HYPE ceiling.
