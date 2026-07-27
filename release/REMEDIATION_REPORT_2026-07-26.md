# HWA — rapport de remédiation après audit Claude

Date d'arrêté : 26 juillet 2026. Cible : HyperEVM mainnet, chain ID 999. Le juridique est hors périmètre.

## Verdict

La **release candidate source** est prête pour un nouvel audit indépendant. Elle n'est pas autorisée au broadcast mainnet : aucune adresse 999, aucun manifeste 999 et aucun endpoint indexeur de production n'existent encore. Deux dépendances Nest restent à fermer avant tout déploiement : confirmer le comportement des pouvoirs admin du pool et obtenir une séquence atomique création du pool + installation du plugin + initialisation, ou un factory wrapper audité.

La gate locale finale est `prepared`, et non `passed`, parce que le build indexeur 999 exige volontairement un manifeste construit à partir de contrats réellement déployés. Aucun faux manifest ni aucune adresse fictive n'ont été créés.

## Remédiations critiques

### HWA-001 — mot aléatoire contrôlé par l'opérateur

Le chemin mainnet Gelato a été supprimé de la release. `DrandBN254Coordinator` vérifie dans l'EVM la signature BLS BN254 du beacon drand evmnet contre la clé publique figée dans `DrandEvmnetRegistry`. Le submitter transporte une preuve publique mais ne fournit jamais un mot arbitraire. Le mot consommé provient de la signature vérifiée et est séparé par domaine pour la chain, le coordinator et le request ID.

Les anciens coordinateurs Gelato, relay et Proof of Play rejettent leur construction sur chain 999. Les tests couvrent la fixture officielle, une signature forgée, le cache d'un round, un callback raté/rejoué et le parcours FWA complet.

### HWA-002 — requête sans expiration

Chaque requête BN254 possède une expiration en blocs. Après expiration, n'importe qui peut la fermer, libérer la réserve et permettre la réconciliation/migration. Le fulfillment reste permissionless, le bounty est borné par une réserve comptable et un callback échoué ne consomme ni la preuve ni la requête.

## Corrections structurelles principales

- Activation : `setRewards` précède obligatoirement l'ouverture ; `rewardsRequiredForActivation` est un latch mainnet one-way. La première action Safe n'autorise qu'une collection canary. Les collections publiques nécessitent une acquisition canary `Fulfilled` et une randomness drand effectivement mise en cache.
- Owners : les scripts mainnet exigent `FWA_OWNER`, vérifient que c'est un contrat Safe et transfèrent/attestent token, rewards, adapter, locker, splitter, whitelist, service et coordinator.
- Paramètres : timeout HyperEVM à 360 blocs, batch mainnet à 1, prix Nest sans défaut, double saisie du prix, bornes FDV, min-out de buyback, funding rewards de 300 M et réserve randomness obligatoires.
- Nest : buys externes fermés par défaut et ouverts/fermés manuellement ; buys protocole autorisés via un binding non usurpable ; état du pool ré-attesté par le token à chaque transfert ; LP NFT enfermé ; rescue HYPE différé et lié à une empreinte de configuration.
- Splitter : snapshot frozen, split 70/30 gelable, horloge de sweep démarrée à l'activation et claims exposés au frontend.
- Indexeur : ABI ERC-721 déclarée, crown ordering corrigé, service fees accumulés, événements earnings/governance indexés, rendu chain-aware et pagination bornée.
- Frontend : toute écriture passe par les flags, l'état on-chain et une simulation ; les sorties restent disponibles en mode read-only ; fallback positions/settlements on-chain ; timeout distingué d'un revert ; paramètres live lus on-chain ; metadata proxy borné et anti-SSRF ; CSP à nonce et HSTS.
- Release : la gate enregistre ses switches, asserte les compteurs minimums, refuse `--broadcast`, distingue `prepared` de `passed` et exécute quatre attestations live 999 en `MainnetMode`.

## Résultats reproductibles

Commande exécutée sans broadcast :

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\TestReleaseCandidate.ps1 -CleanInstall
```

Résultat machine : `release/release-gate-last-run.json`.

- Solidity : 121/121, dont 3 invariants stateful à 256 runs × 64 appels, zéro revert handler ;
- Nest chain 999 : 5/5 contre les contrats réellement déployés ;
- frontend : audit npm zéro, typecheck, lint, build production, 46/46 Vitest, 32/32 Playwright ;
- indexeur : audit production zéro et build déterministe testnet ;
- install propre : `npm ci` frontend et indexeur ;
- transaction broadcast : zéro ;
- unique skip : build indexeur mainnet, car le manifeste 999 n'existe pas avant déploiement.

Le graphe CLI conserve 24 advisories dans ses dépendances dev/build (3 moderate, 19 high, 2 critical). `npm audit --omit=dev` est à zéro. Il doit rester dans un runner isolé avec des manifests revus.

## État live HyperEVM testnet 998

Les attestations ont été rejouées séparément et sans transaction :

- core : passé ;
- coordinator drand relay 998 : passé ;
- Nest : échec fail-closed sur l'ancien token, qui retourne `false` pour `isDistributor(feeRecipient)`.

Ce déploiement 998 précède le durcissement. Le script courant `DeployNestToken.s.sol` appelle bien `setDistributor(feeRecipient, true)`. Le vérificateur n'a pas été affaibli et aucun redeploy 998 n'a été effectué. Détail machine : `release/testnet-attestation-998.json`.

## Disposition des 86 constats

Le fichier `release/remediation-findings-2026-07-26.json` couvre exactement HWA-001 à HWA-086, sans doublon ni omission :

- 77 corrigés ou rendus inapplicables par la nouvelle architecture ;
- 2 blocages externes avant broadcast : HWA-015 et HWA-039 ;
- 4 choix/assumptions à refaire challenger : HWA-053, HWA-069, HWA-071 et HWA-086 ;
- 3 constats limités à du code legacy testnet interdit sur 999 : HWA-067, HWA-079 et HWA-080.

La catégorie « corrigé ou rendu inapplicable » ne signifie pas qu'un audit externe doit faire confiance à ce classement : elle indique où chercher le nouveau contrôle et son test. Les quatre points « recheck » sont volontairement laissés visibles plutôt que déclarés fermés par auto-évaluation.

## Blocages réels avant broadcast

1. Obtenir de Nest une procédure officielle atomique pour création du pool, plugin et initialisation, ou faire auditer un factory wrapper dédié. Ne jamais créer le pool nu puis attendre une seconde transaction.
2. Confirmer les pouvoirs admin Nest/Algebra applicables au pool HWA et les procédures de récupération. Le token fail-closed en cas de dérive ; cela protège du trading inattendu mais ne répare pas la disponibilité du DEX.
3. Figer les décisions humaines : Safe/signers, collection snapshot, secondary recipient, collections et blocks, min backing, prix/FDV/range, destination des 200 M, fee recipient, hosts metadata et URLs production.
4. Faire l'audit externe de ce bundle et corriger ses conclusions avant dry-run/broadcast.
5. Après déploiement : produire le manifest 999, compiler l'indexeur 999, exécuter la gate `MainnetMode`, déployer l'indexeur, réaliser la canary puis seulement promouvoir le frontend.

## Sources primaires utilisées

- HyperEVM et JSON-RPC : https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/hyperevm
- API HTTP drand : https://docs.drand.love/developer/API-v1/drand-http-api/
- vérification BLS drand sur Ethereum : https://docs.drand.love/blog/2025/08/26/verifying-bls12-on-ethereum/
- implémentation BLS vendue, commit exact documenté dans le source : https://github.com/randa-mu/bls-solidity
- contrats Nest : https://docs.usenest.xyz/security/contracts
- modèle plugins Algebra Integral : https://docs.algebra.finance/algebra-integral/core-logic/plugins
- développement plugin Algebra : https://docs.algebra.finance/algebra-integral-documentation/algebra-integral-technical-reference/guides/plugin-development
- CSP Next.js App Router : https://nextjs.org/docs/app/guides/content-security-policy

## Politique de release

Les contrats ne sont pas upgradeables. Le trading public HWA reste un switch manuel du Safe, indépendant du gameplay. Aucun timer ne peut l'ouvrir. Toute adresse ou valeur irréversible doit provenir de la fiche de release signée ; `.env.mainnet.example` est un schéma fail-closed, pas une autorisation.
