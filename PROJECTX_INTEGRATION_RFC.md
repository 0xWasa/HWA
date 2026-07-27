# HWA sur Project X — RFC d'intégration V3

Statut : **implémenté et déployé en compatibilité sur chain 998 ; mainnet non déployé**.

## Contrats Project X mainnet 999

| Composant | Adresse |
|---|---|
| Factory V3 | `0xFf7B3e8C00e57ea31477c32A5B52a58Eea47b072` |
| SwapRouter | `0x1EbDFC75FfE3ba3de61E7138a3E8706aC841Af9B` |
| NonfungiblePositionManager | `0xeaD19AE861c29bBb2101E834922B2FEee69B9091` |
| wHYPE | `0x5555555555555555555555555555555555555555` |

Le tier choisi est `10_000` avec tick spacing `200`. Ces valeurs sont réattestées par `ProjectXDeploymentTest` et doivent être relues immédiatement avant tout broadcast.

## Architecture HWA

- `FWATokenHyperEVMFactory` crée le token et le locker, crée/initialise le pool puis mint la LP en une transaction.
- `FWATokenHyperEVM` garde les achats pool fermés par défaut et conserve le buyback permissionless 40/40/20. Chaque buyback dérive son minimum de sortie d'un TWAP Project X de 30 minutes et sa limite de prix du spot courant ; il échoue en mode fermé tant que l'oracle n'a pas assez d'historique.
- `FWAHyperSwapAdapter` est un adapter V3 exact-input immuable, limité au buyer rewards autorisé.
- `HWAProjectXLiquidityLocker` détient définitivement le NFT LP de lancement ; seuls les frais peuvent être collectés.
- `FWARewardsHyperEVM` conserve les émissions 150 M déposants + 150 M purchasers.

## Invariants de lancement

1. Nom/symbole : `Hyper World Assets` / `HWA`.
2. Supply : 1 milliard ; 500 M LP, 300 M rewards, 200 M recipient explicite.
3. Pool canonique factory : wHYPE/HWA, fee `10_000`, spacing `200`, prix non nul.
4. NFT LP détenu par le locker dès le mint ; aucun transfert intermédiaire.
5. Adapter/rewards/token/core liés avant toute activation.
6. `externalBuysEnabled == false` et `acquisitionsEnabled == false` au handoff.

## Administration et limites

L'owner HWA contrôle l'ouverture/fermeture des achats et le recipient des fees du locker. Il ne contrôle pas les bornes du buyback : le contrat applique automatiquement le TWAP 30 minutes, le fee Project X de 1 %, un plancher de 90 % de la quote et une limite sqrt relative au spot courant. Le principal LP n'est pas récupérable. Project X conserve les pouvoirs propres à sa factory, notamment la part protocolaire des fees. HWA ne prétend pas empêcher les positions LP tierces ni exact-output une fois le marché ouvert.

## Testnet 998

La venue de compatibilité utilise factory `0x22B0768972bB7f1F5ea7a8740BB8f94b32483826`, router `0xD81F56576B1FF2f3Ef18e9Cc71Adaa42516fD990`, NFPM `0x09Aca834543b5790DB7a52803d5F9d48c5b87e80` et wHYPE `0xADcb2f358Eae6492F61A5F87eb8893d09391d160`. Elle ne doit jamais être présentée comme Project X officiel.
