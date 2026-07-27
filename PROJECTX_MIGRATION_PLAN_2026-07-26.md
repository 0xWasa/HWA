# Migration HWA vers Project X — plan d'exécution

Statut : **implémentée sur HyperEVM testnet 998, fermée au public**. Ce document n'autorise aucun déploiement mainnet.

## Cible

Le marché canonique est `$HWA/wHYPE` sur Project X V3, tier `1 %` (`fee = 10_000`) et tick spacing `200`. La création, l'initialisation et le mint de la position de lancement sont exécutés atomiquement. Le NFT LP est minté directement vers `HWAProjectXLiquidityLocker`, qui n'offre aucun chemin de retrait ou de diminution du principal.

Project X ne publie pas de déploiement officiel chain 998. Le testnet utilise donc HyperSwap V3 uniquement comme venue ABI-compatible. La compatibilité réelle Project X est prouvée séparément par des tests fork du mainnet 999.

## Ordre réalisé

1. Geler les invariants Project X et les divergences FWA/v4.
2. Implémenter token, factory de lancement atomique, locker, adapter exact-input et garde `minOut`.
3. Tester localement et sur forks 998/999.
4. Déployer un nouveau core FWA fail-closed sur 998.
5. Déployer `$HWA`, le pool, la LP verrouillée, rewards et adapter.
6. Lier rewards au core et allowlister uniquement le NFT fixture, sans ouvrir les acquisitions.
7. Migrer manifeste, indexeur, frontend et outils de release.
8. Exécuter la matrice complète puis produire le verdict mainnet.

## Contrôles manuels conservés

- `FWA.acquisitionsEnabled()` reste `false` jusqu'au canary drand E2E.
- `FWATokenHyperEVM.externalBuysEnabled()` reste `false` jusqu'à l'action owner explicite.
- Aucun timer, keeper ou rôle DEX ne peut ouvrir automatiquement les achats.
- La fermeture reste disponible via `setExternalBuysEnabled(false)`.

## Non-parités assumées

- Le fee de 1 % est un fee LP V3, pas le delta d'un hook v4.
- Après ouverture publique, Project X ne peut pas bloquer exact-output.
- Un tiers peut créer une autre position LP dans le pool canonique.
- La factory Project X peut modifier la part protocolaire des frais ; HWA la surveille mais ne rend pas le pool inutilisable en cas de changement.

## Gates avant mainnet

- audit indépendant sans finding critique/high non résolu ;
- Safe owner, fee recipient, allocation 20 %, snapshot et collections signés ;
- prix initial, range et `FWA_BUYBACK_MIN_OUT_PER_HYPE_X96` calculés et revus ;
- adresses Project X réattestées au bloc de déploiement ;
- source verification, drand BN254, deux submitters, indexeur et E2E canary ;
- achats publics ouverts seulement après décision Safe séparée.
