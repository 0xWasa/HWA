# Abandoned HyperEVM mainnet deployments — 2026-07-29

These addresses are historical artifacts and must never be referenced by the active HWA manifests,
frontend, indexer, release scripts or future deployment phases.

- Abandoned Safe owner: `0x75818fd0a2Ff801F974C9a5d23616fbd38b15f4C`
- Abandoned empty Genesis: `0xdd22c320f2530502cDaDd4aAd2A873eDE9e44B7c`
- Genesis deployment transaction: `0x93d490880d63ffb313b78ecfa4bc9d1edf1669b6ab13285e19068f1034583604`
- Attested state at abandonment: `currentSupply = 0`, owner = abandoned Safe.

No NFT was minted from the abandoned collection. The active redeployment owner is the funded deployer
EOA `0x24398fc31899E2384E4E070fcdBF8Bb6D916FcD9`, accepted through the explicit
`MAINNET_EOA_OWNER_CONFIRMED` release gate. Public HWA buys, gameplay acquisitions and rewards emission
remain separately gated and closed during infrastructure deployment.

The obsolete, never-broadcast Safe mint payloads are retained for forensic history only under
`release/abandoned/gnosis-safe-20260729/`. They are not canonical launch instructions.
