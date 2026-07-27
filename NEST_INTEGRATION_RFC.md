# HWA sur Nest — RFC d’intégration Algebra Integral

> **ARCHIVÉ — 26 juillet 2026.** Project X V3 est la cible active. Ce document est conservé uniquement pour l'historique technique ; voir `PROJECTX_INTEGRATION_RFC.md`.

Statut : implémenté et testé localement ainsi que sur un fork de la stack Nest 999, non déployé. La décision produit du 25 juillet 2026 remplace la cible HyperSwap par Nest. Les anciens contrats et documents HyperSwap sont conservés comme historique et solution de repli ; ils ne sont plus la cible de lancement.

## Résultat recherché

Le marché `$HWA/wHYPE` doit conserver autant que possible les propriétés observées sur Ethereum :

- position de lancement single-sided contenant 50 % de la supply ;
- tick spacing `60` ;
- coût de swap nominal de 1 % dans les deux sens ;
- refus des swaps exact-output ;
- achats externes fermés jusqu’à l’activation explicite ;
- achats du token et du module rewards autorisés pendant cette fermeture ;
- impossibilité d’ajouter de la liquidité après le lancement ;
- buyback exact-input, borné par le prix, avec full-fill vérifié ;
- principal LP verrouillé irrévocablement et frais collectables vers un bénéficiaire configurable.

Nest repose sur Algebra Integral et non sur Uniswap v4 canonique. Algebra offre des callbacks de plugin, mais pas le mécanisme `afterSwapReturnDelta` utilisé par le hook Ethereum. Le prélèvement de 1 % ne peut donc pas être recopié comme delta de hook. Il est porté comme frais AMM statique, avec un locker propriétaire du NFT LP.

## Contrats Nest vérifiés

Sources : [contrats officiels Nest](https://docs.usenest.xyz/protocol-and-security/7.4-contracts), [architecture officielle Nest](https://docs.usenest.xyz/key-features/the-unified-amm), [pool Algebra Integral](https://docs.algebra.finance/algebra-integral-documentation/algebra-integral-technical-reference/integration-process/specification-and-api-of-contracts/algebra-pool) et [plugins Algebra Integral](https://docs.algebra.finance/algebra-integral-documentation/algebra-integral-technical-reference/guides/plugin-development).

| Composant | HyperEVM mainnet 999 |
|---|---|
| Factory | `0xF77Bd082c627aA54591cF2f2EaA811fd1AB3b1F3` |
| PoolDeployer | `0x3842CE04380B8655A3A47Ed87eA0D311ADCa161F` |
| SwapRouter | `0xaA26B8e5Cadd04430c32787eCC3AA325e99681e9` |
| NonfungiblePositionManager | `0xEAF58788a405F3253814b4559391a22bE8616250` |
| wHYPE | `0x5555555555555555555555555555555555555555` |

État lu sur le RPC mainnet le 25 juillet 2026 :

- le router et le position manager renvoient la factory et le wHYPE ci-dessus ;
- `defaultTickspacing() = 60` ;
- `defaultFee() = 500`, soit 0,05 % dans les unités Algebra ;
- `defaultCommunityFee() = 1000`, soit 100 % du fee AMM vers le community vault ;
- `isPublicPoolCreationMode() = false` ;
- aucun déploiement officiel Nest sur chain ID 998 n’est documenté et les adresses mainnet n’y ont pas de bytecode.

La documentation Nest présente la création comme permissionless, mais l’état actuel de la factory fait autorité pour le déploiement : le pool HWA doit être créé ou autorisé par Nest.

## Configuration HWA exigée

Le lancement final refuse toute configuration différente de :

| Paramètre | Valeur |
|---|---:|
| nom / symbole ERC-20 | `Hyper World Assets` / `HWA` |
| `fee` | `10_000` = 1 % |
| `communityFee` | `0` |
| `tickSpacing` | `60` |
| `plugin` | instance `FWANestPlugin` liée au pool et au token |
| `pluginConfig` | `7` = beforeSwap + afterSwap + beforeModifyPosition |
| prix final | prix fixé par `initializeMarket` |

Le `communityFee = 0` est indispensable pour éviter que 100 % du frais de 1 % soit capturé par le vault Nest. Si Nest refuse ce paramètre, la parité du destinataire des frais est impossible avec cette version d’Algebra et le déploiement s’arrête.

Point critique confirmé par le code et le fork : `AlgebraPool.initialize()` applique les defaults de la factory après le callback `beforeInitialize`. Configurer fee/community fee/tick spacing avant l’initialisation ne suffit donc pas. Le workflow sûr est nécessairement : plugin pré-init, initialisation verrouillée, paramètres finaux par Nest, puis mint de la LP.

## Architecture livrée

- `FWATokenNest` porte la supply, le verrou de transfert, le lancement en deux temps, les protocol buyers et les buybacks. Il réatteste aussi plugin, flags, frais, community fee et tick spacing lors de tout transfert impliquant le pool.
- `FWANestPlugin` verrouille l’initialisation, interdit tout swap avant la finalisation, refuse exact-output, bloque les achats externes avant ouverture et interdit les nouveaux apports LP.
- `FWANestSwapAdapter` exécute uniquement les achats protocole exact-input HYPE → wHYPE → HWA et vérifie le full-fill par les deltas de balances.
- `FWANestLiquidityLocker` reçoit le NFT LP. Il ne contient aucune fonction de transfert ou de diminution de liquidité. `collectFees()` est permissionless et envoie les frais au bénéficiaire configuré.
- `FWARewardsHyperEVM` consomme une interface DEX générique ; son ABI et sa logique économique ne dépendent plus du nom HyperSwap.
- `SplitterHyperEVM` reproduit le Splitter FWA : 70 % owner / 30 % snapshot NFT, secondary owner recevant 10 % de la part owner, claims cumulatifs et sweep après 365 jours. Seule l’adresse de collection devient un immutable de constructeur pour HyperEVM.

Le pool Algebra reste administrable par Nest : plugin, flags, frais, community fee et tick spacing peuvent être modifiés par ses rôles. Le plugin et le token transforment une dérive de configuration en arrêt des flux `$HWA` plutôt qu’en modification silencieuse. Une autorité Nest pourrait néanmoins remplacer le plugin et autoriser une position ne transférant initialement que du wHYPE ; cette confiance administrative résiduelle est inhérente au pool Nest et doit être explicitement acceptée.

## Déploiement en huit phases

1. Déployer `SplitterHyperEVM` sur la collection snapshot choisie, puis le lier comme payout du core FWA.
2. Déployer `FWATokenNest` et `FWANestLiquidityLocker`.
3. Faire créer par Nest le pool non initialisé `$HWA/wHYPE`.
4. Déployer `FWANestPlugin`, puis faire exécuter par Nest `setPlugin` et `setPluginConfig(7)`.
5. Appeler `InitializeNestMarket` : le prix est fixé, mais les swaps et apports LP restent fermés.
6. Après initialisation, faire appliquer par Nest `fee=10000`, `communityFee=0`, `tickSpacing=60`, plugin et flags.
7. Appeler `LaunchNestMarket` pour minter la position single-sided directement vers le locker.
8. Déployer adapter/rewards, faire signer `FWA.setRewards` par l’owner actuel du core, vérifier tous les CA, démarrer le relayeur drand supervisé sur 998, exécuter les E2E puis seulement envisager les achats externes sur une stack Nest officielle.

Le découpage est imposé par le lifecycle réel d’Algebra : l’adresse du token est requise pour créer le pool, le plugin exige le pool, et les paramètres factory sont réappliqués pendant l’initialisation. Aucun script ne tente de contourner les rôles Nest.

## Limites et gates externes

- Nest doit confirmer la création du pool, l’installation du plugin, `communityFee = 0` et le fee statique de 1 %.
- Nest doit fournir une stack 998 compatible ou autoriser un déploiement de test. Sans cela, les tests 998 du core et de drand continuent, mais l’E2E contre le vrai routeur Nest reste bloqué.
- Le plugin remplace le plugin dynamique/oracle standard de ce pool. Nest doit accepter cette configuration ou fournir une composition de plugins auditée.
- Les 20 % de supply legacy, le bénéficiaire des frais et l’administration finale restent soumis aux gates déjà consignés dans le manifeste.
- Aucun déploiement mainnet n’est autorisé par cette RFC ; les scripts mutatifs exigent un flag explicite et un dry-run préalable.

## Validation disponible

Les tests locaux couvrent le lifecycle en deux temps, le locker, le gating pré-lancement, le gating des achats, exact-output, l’interdiction de nouveaux LP, le buyback fermé, les dérives de configuration et le remplacement du plugin. Le test fork mainnet exécute la séquence complète avec la vraie factory, le vrai position manager et le vrai router Nest : création éphémère du pool, configuration avec l’autorité Nest impersonnée, initialisation, LP verrouillée, buyback et collecte des frais via le vrai NFT position manager. Aucune transaction n’est diffusée.

Le runbook exécutable est `NEST_DEPLOYMENT_RUNBOOK.md` et le paquet opérateur à transmettre à Nest est `NEST_ADMIN_HANDOFF.md`.
