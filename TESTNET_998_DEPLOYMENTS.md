# HyperEVM testnet 998 deployments

This registry contains public testnet data only. Private keys and mnemonics must never be added.

## Active Project X-compatible v2 release — 27 July 2026

This is the only active chain-998 application stack. It contains every security correction closed after the
second hostile review: atomic Project X pool launch, liability-aware reward rescue, immutable per-allocation
settlement windows, permissionless drand BN254 verification, frozen splitter snapshot and strict launch gates.
Project X has no official chain-998 deployment; the V3 pool below is an ABI-compatible test venue only.

| Component | Address | Creation transaction / block |
|---|---|---|
| HWA Genesis snapshot | `0x4023E79861D53bD82F9c4Eed6f994218a5067a62` | `0x707a515baaf5ca129ea6f66b3e025532b3e4e33f7080ce49433e7a9b99e1f8a5`, block 59973043 |
| Gameplay fixture | `0x82a4ebE1495dA7F59c189e0a0810C0e9D585eac2` | v2 fixture batch, block 59973049 |
| Hostile fixture | `0xFae055F6c3B181ba05a7cEfEcf97854E4A563F69` | v2 fixture batch |
| `SplitterHyperEVM` | `0x0d67daA431Db6AD54C4CC68f55BCB3d884392997` | `0x980a66581789db35d219271f777af8b2f88c13c724115bba0488911cbac72f6f`, block 59973097 |
| `DrandEvmnetRegistry` | `0xb6Eac59c08e0C8138aF917Ee77fD011Aa87CDc34` | core batch beginning block 59973273 |
| `DrandBN254Coordinator` | `0xFf9f4a730BC31a3b6C04CcFEcC6174027E66E078` | core batch |
| `FWAVRFService` | `0x5F60Bb3Dd8ba0EAA9954516F85F77A3F37C3029A` | core batch |
| `FWA` core | `0xC37f752aa37Aa697e3997394442fAA93C382cAC0` | core batch ending block 59974310 |
| `FWAWhitelist` | `0x1A23Cff53751DDdbe91eD0C6aC3a4281F4D8BD76` | core batch |
| `$HWA` | `0x663321C8b5C8DeB97013A9752b6af68B365d05dE` | atomic launch `0xd34cb15552d6db1362c7943050f3058503827c202c45f89e52961355d5b20c69`, block 59974371 |
| V3 compatibility pool | `0x06EA042adA62A01aD25554EE72C3d2aBF12bF5Db` | same atomic launch |
| Atomic launch factory | `0x93EfDA188f9C7f3aFDc2ba2247C1f323B0a79939` | same atomic launch |
| LP locker | `0x23AfC70f47f05504932fC64e3b2eDC324AC6d401` | same atomic launch; LP token ID 21298 |
| `FWAHyperSwapAdapter` | `0x7B724C01bb47b3bAf982305A99fF996b751d11a2` | `0x3ca642c08a593b54e64a399dd8bbac0750b8d19fa86aae0ec27cba296f7e0172`, block 59974425 |
| `FWARewardsHyperEVM` | `0x16BBa592c24803089360bbF211bD02dE9b6988F0` | `0xf765f55fa6c9a5a7ac106efb3e435eb08c2c8c9b14c2350affe6e660cd8f3f53` |

The token/pool/LP creation is atomic inside `FWATokenHyperEVMFactory`'s constructor: an initialization or LP mint
failure reverts the entire creation transaction. Supply is allocated as 500 M locked LP / 300 M rewards / 200 M
test legacy recipient. External HWA buys remain closed and can only be opened manually. The splitter is frozen at
70/30 against the four-token Genesis snapshot. The gameplay fixture is allowlisted; acquisitions were deliberately
closed again after E2E because no continuously supervised relayer is running.

### Live drand BN254 gameplay proof

Request `37048324755718835718626442381585318985017849012663041600115933379370109256045`
targeted public evmnet round `19,214,148`. Protocol Labs and Cloudflare returned the same signature before the
coordinator verified the BN254 BLS proof on-chain in transaction
`0x87036ced37f7682084cf9a3ad43af350eb05c440d972919870fc280b45545b39` at block 59975143.
Permissionless ordered processing succeeded in transaction
`0x16df80f883c101ab7722f08ceab9602449a9b051a9ca307aaff3b7be3e5a4efe`; purchaser
`0x6B3248cf1b82E6BD4c2AB955FF01f99c0ea03290` then settled listing 1 through `keepNFT` in transaction
`0x3880acce6107a80570f2cce9f3ad65f2a720a17bdc9584a16bd4ce1e8b5cd96a` at block 59975329.
The purchaser now owns gameplay token 1 and the unsettled-acquisition counter returned to zero.

Read-only core, drand, Project X module and post-E2E safe-state attestations pass together at fixed block
59976261. The Project X verifier was deliberately held until the 30-minute TWAP observation matured. Local
validation is 165 Solidity tests and 74 frontend tests, with frontend production, 36 browser E2E tests and the
deterministic indexer build passing.

All deployment sections dated before 27 July 2026 below are immutable history and are superseded by this v2 stack.

## Environment

- Chain ID: `998`
- RPC used: `https://rpc.hyperliquid-testnet.xyz/evm`
- Deployer and temporary owner: `0x681f4829b500b30fcc461cf523D8E213320Da574`
- Initial preflight balance: `0.15 HYPE`
- Balance after NFT fixture deployment: `0.149495661694956617 HYPE`
- Balance after the deployments and smoke tests below: `0.129710311859769829 HYPE`
- Balance after drand deployment, multi-wallet funding and gameplay E2E: `0.079544134639579375 HYPE`

## Current Project X-compatible release — 26 July 2026

This is the active chain-998 application stack. Project X has no official testnet deployment; the pool uses an ABI-compatible V3 venue and is validated against the real Project X contracts by mainnet-fork tests.

| Component | Address | Reference transaction/block |
|---|---|---|
| `DrandRelayCoordinator` | `0x5418888554Bf470ACc9000d3bC264B610a6a4f22` | `0x0ea6ef7db4577ad63c86a8f998a08f584858b42812a171c65f1d01226b8a2c9b`, block 59911482 |
| `FWAVRFService` | `0x2ae4e158eCDc3ee4b34420729485AD3b6aB43489` | `0xb2265d7727d5523c561d9026a85855f4da79deab67b0a59a32e00941c9bb14f0`, block 59911484 |
| `FWA` core | `0x1F844C01FDc5d25c3Bd84d55683ee187041b454c` | `0xca8e59c1f076f9ec4052b1faf8d31355ef53573ed484448b022287ee83ee6047`, block 59911690 |
| `FWAWhitelist` | `0xBfFA297Bd994E35ecE369c1fD0a77182707E1844` | `0xabbcd8cabc1663a087af95fcb06ba1bf72cf0e82d70f89b8297256377a6d1147`, block 59911751 |
| `$HWA` | `0x1678671eC35ed8B2c975Aa65874501CeECaf6E3D` | atomic launch `0x4f3272b94f42a2184b1fc6accdb9d440ef86e048b9653758a47f9f4a03494d1a`, block 59912056 |
| V3 compatibility pool | `0x3202eb021bD4e98fe5f2418A866cE3725207021B` | same atomic launch |
| LP locker | `0x2C20f682e3ede77Ba8FBaf46CBc3954049a58aBA` | same atomic launch; LP token ID 21296 |
| `FWAHyperSwapAdapter` | `0xf392Ae877155d9de44f9333E53ac6a0A6b24EFBD` | module batch, block 59912239 |
| `FWARewardsHyperEVM` | `0xd1bD3b39A876D61BeAf89F3d2f5557A9BA2525Bf` | module batch, block 59912239 |
| `SplitterHyperEVM` | `0x2c79f69877254BC78bBFD9d6be07bB528985452c` | reused verified 70/30 splitter |

On-chain attestation `VerifyProjectXModules.s.sol` passes. Supply is split 500 M locked LP / 300 M rewards / 200 M explicit legacy recipient. The fixture collection `0x0ACD941969228976Fc3FaE6c6560c1230d54F74a` is allowlisted. Both `acquisitionsEnabled` and `externalBuysEnabled` remain `false`.

## NFT fixtures

| Role | Contract address | Creation transaction | Block | Supply | Highest ID | State |
| --- | --- | --- | ---: | ---: | ---: | --- |
| Splitter snapshot | `0x8D7b23482FF6c81248727AE50f64f4b337dC0aa4` | `0x64b42a8f4bbe7da761b4b398fa01ccc0c5c0733fc8b977e98651d5724560c3f1` | 59799032 | 4 | 4 | minting closed |
| Gameplay | `0x0ACD941969228976Fc3FaE6c6560c1230d54F74a` | `0xb8fa3a6d18131fd6ea54ecf2ca60c5ee5ed91b20750c36356a076d8a1dd4d40b` | 59799046 | 6 | 6 | minting closed |
| Hostile gameplay | `0x75F13b6D8884e5fa7b03a74EF1c3964E9Ac38391` | `0xe68d75e48b95e7db02e2acac77d995bc81266e78091b1e24e57372e681291ad6` | 59799066 | 2 | 2 | minting closed; transfers blocked |

All three addresses returned 5,226 bytes of runtime code, the expected owner and successful on-chain supply/configuration checks.

The first smoke deployment minted all fixtures to the deployer because distinct actor accounts were not configured yet.
The normal and snapshot NFTs can be transferred to actor wallets later. Hostile transfers must be temporarily unblocked by
the owner for actor setup and blocked again before the negative custody test.

## External gates remaining

- Gelato VRF adapter/task/dedicated sender for production chain 999; Gelato's published list does not expose chain 998.
- Remaining multi-request, settlement-choice and hostile-collection rows after the completed drand smoke test below.
- Independent mainnet audit, drand BN254 canary and signed launch inputs remain production gates.

## Revenue Splitter

| Contract | Address | Creation transaction | Block | Runtime |
| --- | --- | --- | ---: | ---: |
| `SplitterHyperEVM` | `0x2c79f69877254BC78bBFD9d6be07bB528985452c` | `0x153b627cd5162430ae8ef6ab2209e24dbaecaea34fadc2dce5127324f4076eb3` | 59799695 | 4,062 bytes |

Verified state: owner `0x681f4829b500b30fcc461cf523D8E213320Da574`, secondary owner
`0x85a113AbC5b635D1DBF6B210b12853815897F0B0`, snapshot collection
`0x8D7b23482FF6c81248727AE50f64f4b337dC0aa4`, supply/cap `4/4`, split `70/30`.

## Historical core contracts — superseded

The first core broadcast stopped when the FWA creation exceeded the 2M fast-block gas limit. Two preceding
transactions were mined successfully and are intentionally reused by `ResumeHyperEVMCore.s.sol`:

| Contract | Address | Creation transaction | Block | Gas used |
| --- | --- | --- | ---: | ---: |
| `PoPRandomnessAdapter` | `0x77073140E0C9d34fDB6b2E08Ae647D826b974aca` | `0xb9c4729d417f616a3eb957fe26d1bfb58921d785f1d540e17a4fc76af28632f5` | 59799760 | 1,025,893 |
| `FWAVRFService` | `0x982A8CbafD79FbF36262873124830873e166Aa62` | `0xb8b829294ff997f34d1b794322daba8e95fa21b8ea5337e1109f275fc80cc94a` | 59799762 | 1,709,978 |
| `FWA` | `0xeE5D51211422606815A71B7b2aD73f732ee6630F` | `0x68d0fcdd1f72a1655f6f0bb77826634aa15d7e895816c9a62da49f384848f2d9` | 59800548 | 5,273,099 |
| `FWAWhitelist` | `0x6c74EE11F680Ef1503bc26115b85F44fDCA6F805` | `0x3668d1802b3d344b2261ddcdcf2de1cc79170c43d3dcb259603953cd466cc14a` | 59800548 | 689,923 |

The guarded resume completed in a HyperEVM big block. All eight transactions at deployer nonces 38 through 45
have successful receipts. `VerifyHyperEVMCore.s.sol` passed on-chain after deployment: ownership is aligned,
the adapter and VRF service point to FWA, the whitelist points to FWA, FWA points to the splitter, and the splitter
retains its verified 70/30 snapshot configuration. The adapter continues to point to the official Proof of Play
testnet provider `0xd14D984603b0b7Ade91bE52f3Fc4A917Dfa77bcD`.

## Historical drand-relay coordinator — superseded

Proof of Play remains preserved as the historical coordinator, but its manual registration flow no longer blocks
chain-998 tests. The active coordinator is now the explicitly testnet-only, offchain-verified drand relay:

| Contract | Address | Creation transaction | Block | Gas used | Runtime |
| --- | --- | --- | ---: | ---: | ---: |
| `DrandRelayCoordinator` | `0xC33993a5f27Ea62bca91D59D1a55E386cF1272CF` | `0x8a7d56d182c7d0835109f058d4f6879d359b77a6d7a980a895ea6fca8245a162` | 59810582 | 1,277,706 | 5,309 bytes |

Consumer binding succeeded in transaction
`0xf69c7c023956a3b8fcb60e29dc410d0991e2762018373ee7264733bd1769117e` at block 59810586.
FWA acquisitions were forced closed, then the coordinator changed in transactions
`0xea44b3dbd34180993ca25314f1bde97541c0d4a6c91f27936367d5c9c14a9c58` and
`0x00705dc39dce4e2610bb77c20a3e6cc0661c6da1022863c8db9d6e076641cb83` at blocks 59810655 and
59810659. `VerifyDrandRelayCoordinator.s.sol` passes against the active wiring.

Pinned state: owner and temporary relayer `0x681f4829b500b30fcc461cf523D8E213320Da574`, consumer FWA
`0xeE5D51211422606815A71B7b2aD73f732ee6630F`, subscription ID `1`, minimum future delay `6 s`,
evmnet period `3 s`, chain hash
`0x04f1e9062b8a81f848fded9c12306733282b2727ecced50032187751166ec8c3`.

Security boundary: the contract binds the request and round, authenticates the relayer, computes
`SHA-256(signature)` and emits the public signature, but does not verify the BLS proof on-chain. The local watcher
requires identical Protocol Labs and Cloudflare responses before broadcast. This coordinator is forbidden on
mainnet; Gelato remains the chain-999 target.

## Historical non-official Algebra harness for chain 998 — superseded

Nest publishes no official chain-998 deployment. The contracts in this table are therefore a clearly labelled,
non-production Algebra interface harness used only to execute FWA integration tests on HyperEVM testnet. They are
not represented as Nest contracts. Compatibility with the real Nest stack remains covered separately by the
mainnet-999 fork test.

| Component | Address | Creation transaction | Block | Gas used |
| --- | --- | --- | ---: | ---: |
| Test factory | `0x3afcdDa983c2152e559aA9DF1AcA45Ad98D44ed7` | `0x8742177026b7ab93e67371dc9926a727c45db4faea7249bac4bdfd573517e32f` | 59800948 | 1,334,077 |
| Test position manager | `0xc51DC96DA1E7EAB3c15770AFf2E01c312Bdf9397` | `0x4e33887fcfce6c2cf28fdcdb86c60441a46da776252952f90654102d8e38d348` | 59800950 | 594,877 |
| Test swap router | `0xECb548b47103a12e94E0C32222ABE4Cf49B52c76` | `0x1c9d8c364a9cda83772067e9122a0ea0862268c189fd94baf5f373b172bb0a17` | 59800952 | 279,237 |
| FWA/wHYPE test pool | `0x2A8aa2976EDc75d7248E04e69049Bfbb874f6e0f` | `0x99baeae2cb4c2d8075e2b7ba48974c0cfdc6036988b4bc0757c62e0318e112db` | 59801151 | 1,005,119 |

The harness is administered by the test deployer, uses the real chain-998 wHYPE contract
`0x5555555555555555555555555555555555555555`, exposes the Nest selectors consumed by FWA, restricts pool
configuration to its administrator, and keeps public pool creation disabled.

## Historical FWA token and Nest-compatible modules — superseded

> **Historique immuable.** Les adresses ci-dessous ont été déployées avec le symbole ERC-20 `FWA` avant que le nom produit final `$HWA` soit figé. Elles ne doivent pas être reprises dans un nouveau manifeste de release HWA. La répétition testnet finale doit redéployer le token et les modules qui référencent son adresse avec `name() = "Hyper World Assets"`, `symbol() = "HWA"` et `decimals() = 18`.

| Contract | Address | Creation transaction | Block | Gas used |
| --- | --- | --- | ---: | ---: |
| `FWATokenNest` | `0x41514C9043D7382088F3EEE5A6344dBc55879C5B` | `0x904a584934bd41381dde0092fc7fa28f15bf60c9341e4f40f101635a6bd24b2f` | 59801097 | 3,694,984 |
| `FWANestLiquidityLocker` | `0xF4b86F1BA485bE25F322df3eDF5E41d3a22e35b4` | `0xb8fa2844abd9b59a1127823726b11141140c0eda144570b59b3be576f75649c3` | 59801097 | 574,714 |
| `FWANestPlugin` | `0xa651d0569D80c7810dbe404faF6b4387E3a9f98D` | `0x9a883394a14e757dea05f532a6311d7b01b83b2b976896bda86fca5142e389ae` | 59801196 | 891,773 |
| `FWANestSwapAdapter` | `0xC7D0B6640cDe80816e43eF8a6D29d3F87e18A167` | `0xf557545eb22722dfd80a29b97c66f0ce5a01ce8eef9949e0c4f310a1c48348f9` | 59801496 | 984,030 |
| `FWARewardsHyperEVM` | `0x0abA952fC5abD9fdb67e57AE36F6C0E905FD7a3e` | `0x4b7d28da56f98d9e03f26d866f5d1ff8baea22c92fda05653160f7f16cd4c8f6` | 59801500 | 2,301,737 |

Lifecycle transactions all succeeded: pool/plugin pre-configuration
`0x8771080587edb4cab14da930bc5031051d2e0faf3b230681f554b190e8a453f7` and
`0x39b1d582d2fca25b7bb789da1665c97652c623bd530a99689d03b3642bf921a6`; initialization
`0x82ffee1133e7e2360fa86edb8db1220d042f9a452d3606038ff27ecdba634d47`; post-initialization fee configuration
`0x91d3aaf80263d8ce7e3359dd96c6e903aff82aa428f56886bf3027a20b5c10f7` and
`0xd8db23c5ad365e465fb686ccf3853a36bfc3fbb28d0c052142b63268ef73e93f`; LP launch
`0x1d235f61a1d58597e0c66812bee07b13ed27724fc4e4d9d3b951c0b48320b0b5`; rewards/core binding
`0x8a940e0b207a5fe88b5b2b6287abba6cf0501c4ae3fb3e2c6058c7ae36f2b8ef`.

`VerifyNestModules.s.sol` passes against the deployed state. The pool is initialized at `2^96`, configured with
fee `10,000` (1%), community fee `0`, tick spacing `60`, plugin config `7`, and the plugin above. LP token ID `1`
is held by the locker. External buys remain disabled. The fixed supply began at one billion FWA with 500 million
in the LP, 300 million assigned to rewards and 200 million retained by the test allocation recipient.

## On-chain smoke tests

- Closed-market protocol buyback: funding transaction
  `0x947a6ddf910f5742468c0a8ae6c906238232f450b6807292108dabb70015c0e0`; buyback transaction
  `0x4779e79bb7cca692e87971852b149935d0f7fa2faf3bce5a78c772f8f6c04a0c`. `0.000995 HYPE` was swapped for
  `0.00199 FWA` while external buys stayed closed. With no purchaser epoch active, Rewards burned the purchaser
  route; the resulting supply is `999999999998806000000000000` wei-FWA and the adapter retained no HYPE/wHYPE.
- Splitter: `0.001 HYPE` was allocated 70/30, the owner side paid its secondary-owner tenth, and snapshot token IDs
  1 through 4 were claimed by four distinct wallets. All six receipts from block 59801879 through 59801891
  succeeded; the Splitter now has zero residual HYPE and records `0.001 HYPE` total received.
- Local suite after adding the chain-998 harness: **69 passed, 0 failed, 0 skipped**, including 512-run fuzz cases.
- Local suite after the drand coordinator and integration tests: **82 passed, 0 failed, 0 skipped**.
- Fork verification after activation: **5/5 Ethereum forensic**, **5/5 Nest mainnet 999**, and **4/4 HyperSwap testnet 998** tests pass when each chain-specific file is run against its matching RPC.

## Drand gameplay smoke test

The first live request intentionally demonstrated the short block-window failure mode. Request `1` targeted drand
round `19,160,386`; fulfillment transaction
`0xd84936ce9c2012b63571e3e14f220a0389a34b3e5e0ea15cd44d47d2d8ddc199` delivered public digest
`0x664d69698a564875b052cea159a5d4859c6c8c76856ea77551d1e9a79a16fdb8`. It arrived after the Ethereum-derived
30-block window and FWA correctly classified it `TimedOut`, preserved the NFT and created a pull refund after
permissionless processing.

Because 30 Ethereum blocks represent approximately six minutes while 30 HyperEVM blocks are much shorter, the
testnet `SELECTION_TIMEOUT_BLOCKS` was adapted to `360` in transaction
`0x6bfa0ee0e433790527a0b2530124925acb30bd60baa39c43073cc70dbe51ab41`. Request `2` then targeted round
`19,160,470` and was fulfilled on time by transaction
`0x20a8c00f732954ff228c3cb09662672f2f31d30d6e5c402c27c49927d1280269` at block 59811478, with public digest
`0xf921db9c6c64193a303f18504a6fce775c3c16ba18dfe28cddb1c25e19081871`.

The resulting acquisition selected listing `1`. Purchaser
`0x6B3248cf1b82E6BD4c2AB955FF01f99c0ea03290` called `keepNFT` in transaction
`0xd9825f2ff560ff1dd1176633015a208fc9cd0a965e4f0cfd3737d5ecc69abf88` at block 59811538 and now owns gameplay
NFT `0x0ACD941969228976Fc3FaE6c6560c1230d54F74a` token `1`. Final checks: request 1 `Expired`, request 2
`Fulfilled`, listing 1 `Settled`, refund credit `0`, FWA counters `0/0`, coordinator pending `false`.

After recording the E2E result, acquisitions were closed again with config key `41 = false` in transaction
`0xb74a7324db40aeb1d93e910580b8144e25b09cc269c2e6766013943e67e5bd6a` at block 59812024. The relayer is not
currently a supervised continuous service, so reopening acquisitions remains an explicit operational gate.

## Proof of Play status (historical fallback)

The official HyperEVM testnet provider is `0xd14D984603b0b7Ade91bE52f3Fc4A917Dfa77bcD`. A read-only request
simulated from adapter `0x77073140E0C9d34fDB6b2E08Ae647D826b974aca` currently reverts with selector
`0x48f5c3ed`, decoded as `InvalidCaller()`. This is the expected early-access registration gate, not a wiring error.
`POP_REGISTRATION_CONFIRMED` remains false. The adapter and provider address are preserved, but FWA no longer points
to this coordinator.

## Current gates

- Keep the drand watcher supervised while acquisitions are open and disable acquisitions before any relayer/key
  rotation or coordinator migration.
- Complete concurrent requests, every settlement branch, hostile NFT and retry/restart rows before treating the
  chain-998 environment as fully tested. External market buys remain closed.
- For production Project X, use only the official chain-999 factory/router/NFPM and repeat the fork/live attestations.
  The chain-998 compatibility addresses must never be reused on mainnet.
