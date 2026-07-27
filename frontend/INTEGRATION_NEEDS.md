# Frontend — état de l'intégration

Le frontend est câblé au core FWA, aux modules rewards/token/Project X et à un indexeur Goldsky-compatible. Le manifeste de déploiement reste l'unique source d'adresses ; aucune adresse n'est inscrite dans les composants.

## Prêt dans le code

- lectures critiques et writes wallet sur HyperEVM 998/999 ;
- dépôt, approval, listing, retrait, acquisition simple/batch, suivi randomness, quatre settlements, recovery et claims ;
- reprise des transactions après reload et gestion des remplacements ;
- indexeur événementiel pour listings, acquisitions, activity, positions et ownership ERC-721 ;
- revalidation on-chain de chaque listing, ownership et approval avant signature ;
- mesure `_meta.block.number` contre la tête RPC ;
- proxy de métadonnées NFT borné, sans HTML, IPFS/HTTPS allowlisté et protégé contre les redirects/SSRF évidents ;
- prix spot Project X calculé depuis `slot0().sqrtPriceX96` et ordre réel token0/token1 ;
- trading public Project X externe uniquement lorsque `externalBuysEnabled()` est vrai et qu'une URL revue existe ;
- CSP et headers de sécurité ;
- états honnêtes RPC/indexeur indisponible, mauvaise chaîne, manifest fail-closed et mock explicitement marqué.

## Entrées externes encore nécessaires au mainnet

Ce ne sont pas des développements manquants, mais des valeurs ou services qui n'existent qu'après déploiement :

1. adresses des contrats 999 et blocs de déploiement ;
2. collections ERC-721 retenues avec leur bloc de création ;
3. endpoint public du subgraph Goldsky déployé ;
4. hosts HTTPS des métadonnées/CDN revus dans `NFT_METADATA_ALLOWED_HOSTS` ;
5. URL officielle Project X du pool `$HWA/wHYPE` dans `links.projectXTradeUrl` ;
6. explorer final ;
7. manifest promu après le canary E2E 999.

## Limites assumées

- Le subgraph est une infrastructure de découverte non fiable : aucun droit ni quote n'en dépend.
- En cas de panne indexeur, les positions et acquisitions du wallet sont redécouvertes depuis les événements du core par fenêtres RPC bornées, puis revalidées on-chain. Ce fallback est plus lent et exige le `deployedAtBlock` exact du manifeste.
- Les chandeliers/volumes 24 h du token nécessitent l'indexation future des swaps Project X. Le spot on-chain et la route de trading restent disponibles sans inventer de données historiques.
- Les métadonnées HTTPS arbitraires sont refusées tant que leur hostname n'est pas explicitement allowlisté ; l'UI affiche alors un fallback propre.

Les secrets restent hors du navigateur. Aucune clé privée de déploiement/submitter drand ni clé Goldsky ne doit porter le préfixe `NEXT_PUBLIC_`.
