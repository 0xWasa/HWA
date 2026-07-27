# Handoff d'audit indépendant — Hyper World Assets / Project X

## Mandat

Auditer la release candidate `$HWA` ciblant HyperEVM mainnet 999 et Project X V3. Le juridique est hors périmètre. Aucun contrat 999 n'a été déployé, aucun manifeste 999 n'a été promu et aucune transaction mainnet n'a été diffusée.

Ne pas considérer les rapports de remédiation comme une preuve. Rejouer les scénarios, vérifier les hashes de `release/audit-manifest.json` et signaler tout écart entre le code, les scripts, les manifests et les hypothèses externes.

## Ordre de lecture impératif

1. `release/AUDIT_REPORT_2026-07-26.md`
2. `release/audit-findings-2026-07-26.json`
3. `release/REMEDIATION_REPORT_2026-07-26.md`
4. `release/remediation-findings-2026-07-26.json`
5. `PROJECTX_INTEGRATION_RFC.md`
6. `PROJECTX_DEPLOYMENT_RUNBOOK.md`
7. `PROJECTX_MAINNET_READINESS_REPORT_2026-07-26.md`
8. `release/release-gate-last-run.json`
9. `release/testnet-attestation-projectx-998.json`
10. `FWA_PARITY_MANIFEST.md`
11. `MAINNET_RELEASE_RUNBOOK_2026-07-26.md`
12. `HWA_MAINNET_CONFIGURATION_FREEZE_2026-07-27.md`
13. `release/HWA_MAINNET_FREEZE_ADDENDUM_2026-07-27.md`
14. `release/hwa-safe-mainnet-preparation.json`
15. `release/hwa-safe-mainnet-deployment.json`
16. `release/hwa-launch-economics-preparation.json`
17. ce document, puis le code et les tests.

Le dépôt n'a pas encore de commit de référence. L'ancrage SHA-256 du manifeste d'audit est donc obligatoire.

Le delta le plus récent prépare un Safe canonique 2-sur-3, désactive explicitement le secondary
Splitter, route les recipients de trésorerie vers le Safe, fixe un plafond opérationnel de 20 HYPE
et prépare la custody des 333 Genesis. Aucun de ces éléments n'a été broadcast. L'audit doit relire
ce delta indépendamment, notamment le calcul CREATE2 Safe, les contrats Safe canoniques chain 999,
les deux orderings du prix Project X et la conformité du secondary nul au Splitter de référence.

## Architecture candidate

```text
Wallets
  |
  +-- ERC-721 + HYPE --> FWA core --> SplitterHyperEVM
  |                       |
  |                       +-- FWAVRFService --> DrandBN254Coordinator
  |                       |                       |
  |                       |                       +-- DrandEvmnetRegistry
  |                       |
  |                       +-- FWARewardsHyperEVM --> FWAHyperSwapAdapter
  |                                                     |
  +-- manual $HWA trading --> Project X V3 pool <--------+
                                  |
                                  +-- LP NFT détenu par HWAProjectXLiquidityLocker

Goldsky = découverte/historique uniquement
Frontend = manifeste + RPC + revalidation/simulation avant signature
```

Gelato peut automatiser l'appel permissionless de soumission drand, mais n'est ni l'oracle ni la source de vérité. Les anciens coordinateurs testnet refusent chain 999.

## Fichiers prioritaires

### Randomness

- `src/hyperevm/DrandEvmnetRegistry.sol`
- `src/hyperevm/DrandBN254Coordinator.sol`
- `src/vendor/randamu-bls/BLS.sol` et sa provenance
- `script/DeployHyperEVMMainnetCore.s.sol`
- `script/VerifyDrandBN254Coordinator.s.sol`
- `test/DrandBN254Coordinator.t.sol`

Attaquer le parsing/provenance de la signature, la validation point/subgroup, round/timestamp/liveness, replay, cache, request binding, collision d'ID, expiry, rollback du callback, reserve/bounty, gas grief, réentrance et dérivation du mot.

### Core, passifs et activation

- `FWA_ETHEREUM_REFERENCE/FWA/sources/src/FWA.sol`
- `FWA_ETHEREUM_REFERENCE/FWAVRFService/sources/src/FWAVRFService.sol`
- `test/FWAHyperEVMCore.t.sol`
- `test/FWAStatefulInvariant.t.sol`
- `script/ActivateHyperEVMMainnet.s.sol` — read-only malgré son nom
- `scripts/PrepareMainnetOwnerActions.ps1`
- `scripts/PreparePostCanaryCollections.ps1`

Attaquer la conservation de tous les passifs HYPE, la custody de chaque NFT unsettled, les running totals, callbacks hors ordre, timeout/refund, stuck NFT, emergency exit, rewards latch, batch sous 2 M gas et isolation réelle du canary.

### Splitter

- `src/hyperevm/SplitterHyperEVM.sol`
- `src/hyperevm/HWAGenesisNFT.sol`
- `test/SplitterHyperEVM.t.sol`
- `test/HWAGenesisNFT.t.sol`

Attaquer snapshot/burn/owner, checkpoints, double claim, arrondis, split freeze, `startRevenueClock`, sweep et droits du frontend.

### Project X, token, locker et rewards

- `src/hyperevm/FWATokenHyperEVM.sol`
- `src/hyperevm/FWATokenHyperEVMFactory.sol`
- `src/hyperevm/FWAHyperSwapAdapter.sol`
- `src/hyperevm/HWAProjectXLiquidityLocker.sol`
- `src/hyperevm/FWARewardsHyperEVM.sol`
- `src/hyperevm/interfaces/IHyperSwapV3.sol`
- `test/FWATokenHyperEVM.t.sol`
- `test/FWARewardsHyperEVM.t.sol`
- `hyperevm-fork-test/ProjectXDeployment.t.sol`

Attaquer l'atomicité `token + pool + initialize + mint LP`, la validation factory/pool/token0/token1/fee/spacing, le verrouillage irrévocable du principal LP, la collecte des seuls fees, min-out, sqrt price limit, spoof de l'adapter, 500 M/300 M/200 M, recipient final, liaison rewards, fermeture manuelle des buys et impossibilité d'une ouverture temporisée.

Contraintes externes assumées à réévaluer : Project X V3 ne peut empêcher ni les positions LP tierces ni exact-output après ouverture publique. Le propriétaire de la factory Project X conserve la capacité de modifier la part protocolaire des fees. Un changement de `feeProtocol` doit être visible et monitoré, sans rendre les sorties utilisateur dépendantes d'un indexeur.

### Frontend et indexeur

- `frontend/src/protocol/viem/ViemProtocolClient.ts`
- `frontend/src/protocol/viem/abi.ts`
- `frontend/src/app/api/nft-metadata/route.ts`
- `frontend/src/proxy.ts`
- `frontend/src/protocol/provider.tsx`
- `indexer/subgraph.template.yaml`
- `indexer/src/mapping.ts`

Attaquer les écritures avec manifest flag, mauvaise chaîne, panne RPC, lecture live, simulation, wallet prompt et receipt. Les sorties doivent rester accessibles en lecture RPC sans l'indexeur. Rejouer SSRF, redirects, DNS/IP privés, ports, self-origin, data URI, limite de taille et timeout.

## État de validation actuel

- 123 tests Solidity, zéro échec ;
- 3 invariants stateful, 256 runs × 64 calls, zéro handler revert ;
- 2 tests fork Project X mainnet 999 ;
- 4 tests fork du venue V3 ABI-compatible testnet 998 ;
- 48 tests frontend unitaires ;
- 36 tests Playwright ;
- build Next production et build indexeur déterministe ;
- audit npm frontend : zéro vulnérabilité ;
- attestations read-only core, drand relay et modules Project X-compatibles passent sur 998 ;
- acquisitions et achats publics restent fermés.

Reproduire avec :

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\TestReleaseCandidate.ps1 -CleanInstall -VerifyLiveTestnet
```

Le mode mainnet exige un déploiement 999 réel et ne doit jamais être contourné :

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\TestReleaseCandidate.ps1 `
  -CleanInstall -MainnetMode -MainnetEnvPath .env.mainnet.local
```

## État 998 à ne pas confondre avec Project X officiel

Project X ne publie pas de contrats officiels sur chain 998. Le testnet utilise les contrats HyperSwap V3 uniquement comme venue ABI-compatible. La compatibilité Project X réelle est testée en fork du mainnet 999. Le frontend doit toujours afficher cette distinction.

## Questions à fermer avant broadcast 999

1. Safe mainnet et signers vérifiés ?
2. Snapshot Genesis et recipients du split définitifs ?
3. Collection canary et collections publiques figées ?
4. Prix initial, range, min backing, min-out et destination des 200 M signés ?
5. Adresses Project X, tick spacing et `feeProtocol` réattestés au bloc du launch ?
6. Deux submitters drand indépendants et leur monitoring prêts ?
7. Domaine, RPC, indexeur, CSP/HSTS et URL Project X revus ?
8. Sources vérifiées, E2E closed-market, puis canary réel réussis avant toute activation ?

## Format de restitution

Pour chaque finding : sévérité, scénario, préconditions, impact, fichier/lignes, correctif minimal et test de non-régression. Distinguer bug du code, hypothèse externe Project X, décision tokenomics et limitation UX. Vérifier explicitement chaque finding antérieur déclaré `fixed-or-superseded`.
