# HWA — remédiation du follow-up Fable 5

**Date :** 2026-07-27  
**Cible :** HyperEVM mainnet 999, Project X V3  
**Nature :** remédiation additive ; les rapports Fable précédents restent inchangés  
**Broadcast :** aucun

## Verdict

Les deux mécanismes classés High par `FABLE5_FOLLOWUP_MAINNET_VERDICT_2026-07-27.md` ont été traités dans le code et couverts par des régressions hostiles.

- `F5F-006` est **corrigé techniquement** et prêt pour re-audit indépendant.
- `F5F-015` est **corrigé côté code**, mais ne peut pas être fermé end-to-end avant la sélection, la contractualisation et un test réel d'un RPC logs/archives production.

La release reste donc **NO-GO mainnet**. Ce statut ne reflète plus un mécanisme silencieusement cassé : il reflète l'absence volontaire de déploiement chain 999 et les prérequis humains/infrastructure encore non figés.

## F5F-006 — buyback bloqué après appréciation

### Changement

La limite statique dérivée du prix de lancement et les setters owner correspondants ont été supprimés du chemin Project X actif.

Chaque `buyback()` :

1. lit le spot courant du pool canonique ;
2. calcule une limite sqrt relative au spot courant ;
3. lit un TWAP Project X de 30 minutes ;
4. calcule la quote HWA après le fee V3 de 1 % ;
5. impose un plancher de 90 % de cette quote ;
6. échoue explicitement tant que la fenêtre oracle n'est pas prête.

Le lancement demande une cardinalité d'observation de 16. L'owner ne peut ni modifier le TWAP, ni réduire le minOut, ni déplacer la limite. Aucun nouveau pouvoir de retrait HYPE n'a été ajouté.

### Preuves

- le mock V3 applique maintenant la précondition de direction/position du `sqrtPriceLimitX96` et reproduit le revert `SPL` ;
- `testBuybackRebasesPriceLimitAfterMarketMovesPastLaunchBand` déplace le marché au-delà de la bande historique puis exécute le buyback ;
- `testBuybackFailsClosedUntilTwapWindowExists` prouve l'échec avant 30 minutes ;
- le fork Project X mainnet exécute un lancement, attend l'oracle puis exécute un vrai `buyback()` contre les contrats Project X déployés ;
- `FWATokenHyperEVM` reste à 14 711 octets runtime, soit 9 865 octets sous EIP-170.

### Risque résiduel

Un TWAP de 30 minutes réduit mais n'annule pas la manipulation oracle/MEV. Le mécanisme échoue fermé si l'oracle Project X n'est pas disponible. Ces propriétés sont désormais explicites et documentées.

## F5F-015 — fallback logs incompatible avec le RPC public

### Changement

Le frontend ne tente plus aucun scan historique sur le RPC public HyperEVM lorsqu'un indexeur tombe.

Le secours exige désormais :

- un endpoint distinct via `NEXT_PUBLIC_HYPEREVM_LOG_RPC_URL` ;
- une plage documentée via `NEXT_PUBLIC_HYPEREVM_LOG_RPC_MAX_BLOCK_RANGE` ;
- une capacité minimale revue de 10 000 blocs par requête ;
- des fenêtres qui ne dépassent jamais la plage fournisseur ni le head ;
- un horizon borné à 50 millions de blocs ;
- au plus 5 000 listings/request IDs par compte ;
- un checkpoint navigateur après chaque fenêtre, avec reprise et nettoyage à la fin.

Sans configuration dédiée, le client renvoie `INDEXER_DOWN` au lieu de lancer des requêtes promises à l'échec. Le gate `-MainnetMode` refuse un endpoint absent, identique au RPC principal ou dont la plage déclarée est inférieure à 10 000 blocs.

### Preuves

- test de refus sans endpoint dédié ;
- test du planificateur de fenêtres et refus d'une plage de 50 blocs ;
- test d'intégration du scanner avec trois fenêtres exactes de 10 000, 10 000 et 401 blocs ; aucune requête ne dépasse la capacité déclarée ;
- `.env.mainnet.example`, le runbook, le manifeste de parité et le frontend documentent la dépendance.

### Blocage restant

Aucun fournisseur production n'a été choisi dans ce workspace. `F5F-015` doit donc rester **operationally open** jusqu'à :

1. sélection d'un endpoint logs/archives chain 999 indépendant ;
2. documentation de sa plage `eth_getLogs`, de sa rétention et de son SLA ;
3. test du scanner et de la reprise checkpoint contre cet endpoint ;
4. simulation d'une panne indexeur sur le déploiement canary.

## Gate finale

`scripts/TestReleaseCandidate.ps1 -VerifyLiveTestnet` : **prepared**, avec un seul skip attendu (`Indexer mainnet deterministic build`, car aucun manifeste/adresse chain 999 n'existe).

| Surface | Résultat |
|---|---:|
| Solidity local | 154 pass, 0 fail |
| Invariants rewards/core | 5 × 256 runs × 16 384 calls, 0 revert |
| Fork Project X mainnet 999 | 2 pass, dont buyback réel |
| Fork V3 testnet 998 | 4 pass |
| Vitest | 53 pass |
| Playwright | 36 pass |
| Build frontend | pass |
| Build indexeur testnet | pass |
| Attestations live 998 core/drand/Project X-compatible | pass |
| Broadcast | false |

Une passe intermédiaire a rencontré `invalid block height` sur le RPC testnet pendant l'attestation drand. Les attestations isolées ont réussi immédiatement, puis la gate complète finale a réussi. Aucun artefact n'a été modifié manuellement pour masquer cet incident.

## Prérequis mainnet toujours bloquants

- re-audit indépendant des changements de cette remédiation et fermeture formelle des High ;
- RPC logs/archives production testé ;
- Safe, signers, recipients, snapshot Genesis et collections canary/publiques figés ;
- paramètres de lancement Project X et contrats réattestés ;
- deux submitters drand indépendants et monitorés ;
- déploiement/vérification des sources chain 999 ;
- E2E closed-market, canary NFT réel, puis ouvertures manuelles séparées des acquisitions et du trading.

Ce document n'autorise aucun déploiement, aucune activation et aucun broadcast.
