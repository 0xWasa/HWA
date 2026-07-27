# Readiness mainnet HWA / Project X — 26 juillet 2026

## Verdict

**Testnet release candidate : READY. Mainnet : NO-GO contrôlé.**

La stack Project X est implémentée, testée contre les contrats réels chain 999 par fork et déployée sur chain 998 avec une venue V3 ABI-compatible. Le NO-GO ne vient pas d'un test rouge : les décisions de lancement, l'audit indépendant, la production drand et les opérations 999 ne sont pas encore figés.

## État technique validé

| Périmètre | Résultat |
|---|---|
| Solidity | 123 tests passés, 0 échec |
| Invariants | 3 suites, 256 × 64 appels, 0 revert handler |
| Project X mainnet fork | 2/2 passés |
| V3 testnet compatibility fork | 4/4 passés |
| Frontend unit | 48/48 passés |
| E2E responsive et flows | 36/36 passés |
| Builds | contrats, frontend production et indexeur déterministe passés |
| Dépendances frontend | 0 vulnérabilité npm |
| Bytecode | tous les contrats sous les limites EVM |
| Attestation live 998 | core, drand relay et marché Project X-compatible passés |
| État public | acquisitions fermées, achats publics fermés |

## Déploiement testnet 998 courant

| Composant | Adresse |
|---|---|
| FWA core | `0x1F844C01FDc5d25c3Bd84d55683ee187041b454c` |
| Whitelist | `0xBfFA297Bd994E35ecE369c1fD0a77182707E1844` |
| VRF service | `0x2ae4e158eCDc3ee4b34420729485AD3b6aB43489` |
| Drand relay | `0x5418888554Bf470ACc9000d3bC264B610a6a4f22` |
| Splitter | `0x2c79f69877254BC78bBFD9d6be07bB528985452c` |
| `$HWA` | `0x1678671eC35ed8B2c975Aa65874501CeECaf6E3D` |
| Project X-compatible pool | `0x3202eb021bD4e98fe5f2418A866cE3725207021B` |
| LP locker | `0x2C20f682e3ede77Ba8FBaf46CBc3954049a58aBA` |
| Adapter | `0xf392Ae877155d9de44f9333E53ac6a0A6b24EFBD` |
| Rewards | `0xd1bD3b39A876D61BeAf89F3d2f5557A9BA2525Bf` |
| NFT fixture | `0x0ACD941969228976Fc3FaE6c6560c1230d54F74a` |

Le pool testnet n'est pas un pool Project X officiel. Il teste le même modèle V3, le même tier 1 %, le même tick spacing 200, le chemin router/NFPM et les invariants du locker.

## Gates bloquantes avant mainnet

1. Audit indépendant complet et findings high/critical fermés.
2. Safe mainnet, signers et rôles owner/guardian/funds recipients figés.
3. Snapshot Genesis, split et recipient des 200 M `$HWA` signés.
4. Collections canary/publiques, leurs blocs de départ et metadata hosts figés.
5. Fiche de lancement signée : prix HWA/HYPE, FDV, range LP et backing minimum ; politique immuable du buyback (TWAP 30 min, 90 % après fee, limite spot relative) relue.
6. `DrandEvmnetRegistry` et `DrandBN254Coordinator` production déployés, vérifiés et servis par deux submitters indépendants.
7. Adresses officielles Project X, factory owner, tier/spacing et `feeProtocol` réattestés immédiatement avant simulation puis broadcast.
8. Domaine, RPC production, RPC logs/archives dédié avec plage et SLA documentés, indexeur Goldsky, CSP/HSTS et lien Project X validés.
9. Sources de tous les contrats HWA vérifiées sur l'explorer.
10. E2E closed-market puis canary NFT réel réussis ; acquisitions et trading ouverts par deux décisions manuelles distinctes.

## Non-parités Project X acceptées explicitement

- aucune interdiction protocolaire des LP tierces ;
- exact-output impossible à bloquer une fois les achats publics ouverts ;
- Project X conserve le contrôle de sa part protocolaire des fees ;
- ouverture/fermeture manuelle HWA, sans timer ;
- le principal de la LP canonique reste définitivement verrouillé, seuls les fees sont collectables.

## Séquence de lancement recommandée

1. Audit + décisions signées.
2. Dry-run forké au bloc final et simulation des Safe batches.
3. Déploiement core/randomness avec acquisitions fermées.
4. Déploiement atomique token/pool/initialisation/LP locker.
5. Déploiement adapter/rewards, bindings et allocation.
6. Vérification des sources, manifeste fail-closed et indexeur.
7. E2E closed-market puis canary allowlist.
8. Activation manuelle des acquisitions.
9. Après observation, activation manuelle des achats Project X.

Aucun script de préparation ne doit diffuser de transaction sans `--broadcast` explicite. Le passage mainnet reste une cérémonie séparée et humaine.
