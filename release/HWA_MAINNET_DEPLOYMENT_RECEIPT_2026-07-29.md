# HWA HyperEVM mainnet deployment receipt — 2026-07-29

This is the canonical receipt for the chain-999 infrastructure deployment. It does **not** attest a
public product launch. Gameplay acquisitions, public HWA buys and rewards emission remain closed.

## Authority and launch policy

- Chain: HyperEVM mainnet (`999`)
- Native asset: HYPE
- Deployer and owner: `0x24398fc31899E2384E4E070fcdBF8Bb6D916FcD9`
- Ownership mode: explicitly accepted single EOA
- Target initial FDV: `640 HYPE` (approved band: `600–700 HYPE`)
- Drand mode: BN254 with explicitly accepted single-relayer operational risk
- Public frontend: `https://hwa.fun`
- Genesis asset origin: `https://assets.hwa.fun`

## Canonical contracts

| Component | Address |
| --- | --- |
| HWA Genesis | `0x89D52133B105E9548Df16dE4d7cf59c412daf191` |
| Splitter | `0x1fA5613ff9Ecf177808B619B016f061bA6a20fAE` |
| Drand registry | `0x1911B5FC94A6884F4f2e5f00AfFc1B1538De74Fb` |
| Drand coordinator | `0x165AEb646C60EFF71dA4b0546Ee7F3747f6545D4` |
| VRF service | `0x1507F0c0EffD46dd5692425f58533aAF51b7A7e6` |
| FWA-compatible core | `0x4E010e44E6369A92c090069833144901a92bed5E` |
| Collection whitelist | `0x4261cE6B2F3352544D448609c3f5c61Ea9304428` |
| HWA token | `0x5457A903e0F388498AC8A1024B22487F730BB481` |
| Project X pool | `0x9e76749f864a07E1342622750EbBB9E22Fbda9cf` |
| Project X LP locker | `0xc8fAF2604675dCeE851aAF68536529C387B182d8` |
| Project X adapter | `0xBDE03ce21Dec56bcE57a2A09FBd666342EBc4B6e` |
| Rewards | `0x8f6C63F1eD141Af9FFb28a2CCb8A1bC58EfAF22F` |

## Canonical transactions

- Genesis deployment: `0x964673093fc9f2974838fd84356dcd45b8a392936478df867c3f03b38179c208`
- Genesis freeze: `0x0d92abcf9a1e9dabd64ff745da643d2ef7b82bcd18857679fe7227fe3020a30f`
- Splitter deployment: `0x05d21ff0dc5e5a1ba6a73aa5488a82580ce992a126c919286487f6825ec5a3d6`
- Splitter freeze: `0x4501b92afe0142c07013f8bf5de1a1f555021f0edfcc560d5fd078ad178b2cf5`
- Project X atomic launch: `0xa16ecd6f344fb732f21fbcd8c6eda60fad58d60e43cbafa90e3b2cdbf9ef517c`
- Protocol fee-to-token configuration: `0x522f47dcb2b3dcb362c5fce56a40792be20491b8d06d7dfe62fc73b54524a4ba`
- Rewards-required activation configuration: `0xb522f828425957a211827c8d1ca6651b916a9c302d9e401bb8543876a2a37e95`

The seven Genesis mint transaction hashes are retained in
`release/hwa-genesis-mainnet-20260729.json`. Supply is `333`, all tokens are held by the owner, and
the collection is frozen.

## Closed-state attestation

At handoff:

- `FWA.acquisitionsEnabled() == false`
- `HWA.externalBuysEnabled() == false`
- `Rewards.emissionStart() == 0`
- Splitter revenue clock is not started
- Pool contains no active or staged NFT positions
- Public manifest has `writesEnabled == false` and `acquisitionsEnabled == false`
- HyperEVM big-block routing for the deployer is disabled
- Project X LP token `522723` is owned by the immutable locker
- Drand relayer is active and maintains a sub-five-minute launch-ready heartbeat
- The relayer's transaction transport uses the private, reviewed Alchemy HyperEVM endpoint; the
  intermittently inconsistent public RPC is not used for heartbeat broadcasts

No canary activation calldata in `release/mainnet-owner-actions-eoa.json` has been broadcast.

## Runtime and verification

- Goldsky endpoint:
  `https://api.goldsky.com/api/public/project_cms593kc7twh201utetsgeqg9/subgraphs/hwa-hyperevm/mainnet/gn`
- Goldsky indexing errors at publication: none
- Frontend container health: healthy
- Public route smoke test: passed for `/`, `/token`, `/deposit`, `/acquisitions`, `/positions`,
  `/activity`, `/rewards`, `/docs` and `/terms`
- Public bounded log proxy probe: passed
- Public deployment manifest SHA-256:
  `21d75fc423d6082fbb23165d7333b54fa78dc601f1ef12fdb2c07773c765b84c`
- Final release gate: passed, 20/20 steps, zero skips, zero broadcasts
- Release-gate report SHA-256:
  `d6182d947de2913028f06951fc96399537e53e1705f79ba5c468752e50e393ba`

## Pre-canary hold

The indexer must reach the configured allowed distance from the chain head before writes are
promoted. The owner has `333` HWA Genesis NFTs and `0` Hypio NFTs. The existing canary package is
configured for Hypio; therefore the canary session must deliberately choose either:

1. a wallet that owns a Hypio, retaining the current canary package; or
2. HWA Genesis as the canary collection, using the prepared but unbroadcast
   `release/mainnet-owner-actions-genesis-eoa.json` after a fresh regeneration and review.

This choice is intentionally left unexecuted for the joint canary review.
