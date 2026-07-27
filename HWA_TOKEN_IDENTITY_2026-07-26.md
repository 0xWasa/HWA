# Identité canonique du token HWA

## Décision produit

L'identité ERC-20 définitive du produit est figée :

| Champ | Valeur canonique |
|---|---|
| Nom | `Hyper World Assets` |
| Symbole | `HWA` |
| Décimales | `18` |
| Affichage UI | `$HWA` |

Tout nouveau déploiement, manifeste, écran, message de transaction et support Project X doit utiliser cette identité.

## Frontière de compatibilité FWA

Le fork conserve volontairement les noms techniques historiques nécessaires à la parité et à la compatibilité du core : contrat `FWA`, service `FWAVRFService`, appel `FWA.setRewards`, variables d'environnement `FWA_*` et répertoire forensic `FWA_ETHEREUM_REFERENCE/`. Ces identifiants ne représentent pas le ticker public.

## Déploiement HyperEVM 998 existant

Le token Nest historique à `0x41514C9043D7382088F3EEE5A6344dBc55879C5B` expose l'ancienne identité `$FWA`. Il est superseded par le token `$HWA` Project X-compatible courant, documenté dans `release/testnet-attestation-projectx-998.json`.

Il est donc classé **legacy/test forensic** et ne doit pas être présenté comme `$HWA`. Avant la répétition générale testnet puis le mainnet, il faut redéployer au minimum :

1. le token HWA ;
2. le pool HWA/wHYPE Project X-compatible et son locker ;
3. l'adapter et le module rewards liés à l'adresse du nouveau token ;
4. le manifeste frontend/indexer et les attestations de release.

Le script actif `VerifyProjectXModules.s.sol`, ainsi que le client frontend réel, échoue de façon fermée si `name`, `symbol` ou `decimals` ne correspondent pas à l'identité canonique. Les vérificateurs Nest et HyperSwap sont historiques.
