# MemeBag — Backlog d’exécution

> **Archive historique — ne pas utiliser pour la release HWA.** Ce backlog appartenait à l'ancien produit Bags/Memebag. L'état courant et les gates de lancement sont dans `FWA_PARITY_MANIFEST.md` et `MAINNET_RELEASE_RUNBOOK_2026-07-26.md`.

**Baseline :** `MEMEBAG_PROTOCOL_SPEC_v0.3.md`

## Ordre global

```text
Simulation → Contracts → Invariants → Sepolia → Indexer → Frontend → Release candidate
```

Le design visuel peut avancer en parallèle, mais l’ABI et les événements viennent des contrats.

## M0 — économie et spécification

- [x] Décisions produit figées
- [x] Spécification v0.3
- [x] Simulateur analytique
- [x] Monte-Carlo statique
- [x] Scénarios `balanced`, `junk`, `upside`, `mixed`
- [ ] Analyse de sensibilité des paramètres
- [ ] Rapport de décision économique

**Exit :** conservation vérifiée et paramètres suffisamment compris pour coder sans réécrire la machine économique.

## M1 — scaffold contracts

- [x] Installer/configurer Foundry
- [x] Initialiser `contracts/`
- [x] Pinner Solidity et les dépendances
- [x] Configurer format et fuzzing
- [ ] Configurer CI
- [x] Ajouter `MockERC20`, tokens hostiles et `MockVRF`
- [x] Définir interfaces initiales, erreurs et événements

**Stack :** Foundry, Solidity 0.8.30, Solady pour les primitives minimales, OpenZeppelin pour le timelock.

## M2 — `TokenRegistry`

- [x] Config token
- [x] Ownership compatible avec un timelock externe
- [x] Désactivation guardian
- [x] Validation des bornes
- [x] Événements complets
- [x] Tests unitaires et fuzz

## M3 — `BagVault`

- [x] `createBag`
- [x] tri strict et 1–3 actifs
- [x] balance delta exact
- [x] ownership interne
- [x] transfert d’entitlement au pool
- [x] `claimAsset`
- [x] `abandonAsset`
- [x] accounting par token
- [x] aucun rescue d’un token comptabilisé
- [x] mocks de tokens hostiles
- [x] invariants ERC-20

## M4 — positions et arbre

- [x] `listBag`
- [x] backing minimum
- [x] slots stables et free-list
- [x] arbre segmentaire
- [x] `queueExit`
- [x] `queueReprice`
- [x] file de mutations
- [x] `applyPendingMutations(maxCount)`
- [x] priorité de sortie immédiate via blocage des nouvelles acquisitions
- [x] accounting ETH positions

## M5 — acquisitions

- [x] pricing harmonique
- [x] snapshots
- [x] escrow
- [x] séquences FIFO
- [x] intégration `MockVRF`
- [x] callback minimal du mock
- [x] `processAcquisitions(maxCount)`
- [x] empty-pool refund
- [x] price-drift refund
- [x] expiration
- [x] distributions égales
- [x] résidus d’arrondi

## M6 — settlement

- [x] allocation
- [x] fenêtre 15 minutes
- [x] `KEEP`
- [x] `CASHOUT`
- [x] résolution déposant
- [x] défaut public à 7 jours
- [x] crédits pull-based
- [x] transfert interne du Bag
- [x] impossibilité du double bénéfice

## M7 — administration et invariants

- [ ] timelock + multisig interface
- [x] guardian
- [x] pause limitée aux entrées
- [ ] `withdrawOnly`
- [ ] paramètres bornés
- [x] snapshots non rétroactifs
- [x] invariant de solvabilité ETH strict
- [x] invariants arbre/séquences
- [x] fuzz stateful long
- [ ] Slither/Aderyn
- [ ] rapport gas/DoS

## M8 — VRF Ethereum/Sepolia

- [ ] `VRFAdapter`
- [ ] Chainlink VRF 2.5 subscription native payment
- [ ] frais de service mesuré
- [ ] confirmations et deadline
- [ ] processor permissionless
- [ ] alertes abonnement
- [ ] tests Sepolia

## M9 — indexer et opérations

- [ ] schéma d’événements gelé
- [ ] indexer TypeScript
- [ ] PostgreSQL
- [ ] vues Bags/positions/acquisitions/credits
- [ ] processor bot non privilégié
- [ ] monitoring accounting/VRF/tokens
- [ ] API de lecture/cache

**Choix initial :** Ponder + PostgreSQL. Aucun secret utilisateur et aucune custody dans le backend.

## M10 — frontend

- [ ] Next.js + TypeScript
- [ ] viem + wagmi
- [ ] connexion wallet
- [ ] explorer le pool
- [ ] créer un Bag
- [ ] lister/reprice/sortir
- [ ] acquérir
- [ ] suivre le VRF
- [ ] KEEP/CASHOUT
- [ ] claims ETH/tokens
- [ ] dashboard utilisateur
- [ ] affichage offchain des valeurs/liquidités
- [ ] états dégradés sans indexer

## M11 — release candidate

- [ ] gel ABI/bytecode
- [ ] revue interne ligne par ligne
- [ ] audit indépendant
- [ ] corrections et tests de régression
- [ ] scripts de déploiement reproductibles
- [ ] vérification Etherscan
- [ ] caps de lancement faibles
- [ ] runbook incident
