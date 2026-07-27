# Contrats et tests — runbook HyperEVM

> Mise à jour randomness 2026-07-25 : Proof of Play est désormais un fallback historique. Le coordinateur actif sur
> 998 est `DrandRelayCoordinator` et le chemin exécutable est `DRAND_GELATO_RANDOMNESS_RUNBOOK.md`. Gelato VRF reste
> la cible 999. Les commandes PoP plus bas sont conservées pour traçabilité et ne doivent plus être exécutées par défaut.

> **ARCHIVÉ.** Ce document décrit la première cible HyperSwap. La cible active est désormais Project X V3 ; utiliser `PROJECTX_DEPLOYMENT_RUNBOOK.md` et `PROJECTX_INTEGRATION_RFC.md`. Les instructions ci-dessous sont conservées uniquement pour l'historique.

## État actuel

La base Foundry compile les huit contrats Ethereum vérifiés sans modifier leurs sources. Les tailles runtime obtenues correspondent à la référence Etherscan :

| Contrat | Taille runtime |
|---|---:|
| FWA | 21 425 octets |
| FWARewards | 11 514 octets |
| FWAVRFService | 6 344 octets |
| FWAToken | 11 394 octets |
| FWATokenHook | 7 072 octets |
| FWAClaim | 1 800 octets |
| FWAWhitelist | 2 683 octets |
| Splitter | 3 949 octets |

Le core HyperEVM utilise exactement `FWA.sol`, `FWAVRFService.sol` et `FWAWhitelist.sol`. Les adaptations isolées sont `PoPRandomnessAdapter` pour Proof of Play, puis `FWATokenHyperEVM`, `FWARewardsHyperEVM`, `FWAHyperSwapAdapter` et la factory de lancement atomique pour HyperSwap V3. `FWATokenHook` reste une référence différentielle et n'est pas déployé sur HyperEVM.

Les sources vérifiées restent dans `FWA_ETHEREUM_REFERENCE/`. `scripts/BuildReferenceUnion.ps1` produit un overlay git-ignoré des dépendances brutes, après avoir refusé tout conflit de contenu entre bundles Etherscan.

## Commandes locales

```powershell
& .\scripts\BuildReferenceUnion.ps1
& 'C:\Users\eliot\.foundry\bin\forge.exe' build
& 'C:\Users\eliot\.foundry\bin\forge.exe' test -vv
$env:FOUNDRY_PROFILE='fork'
& 'C:\Users\eliot\.foundry\bin\forge.exe' test -vv
Remove-Item Env:FOUNDRY_PROFILE
$env:FOUNDRY_PROFILE='hyperevm'
& 'C:\Users\eliot\.foundry\bin\forge.exe' test --fork-url hyperevm_testnet -vv
Remove-Item Env:FOUNDRY_PROFILE
```

État validé : **43 tests locaux + 5 tests différentiels sur fork Ethereum + 4 tests sur fork HyperEVM 998**, tous passants, dont 512 cas fuzz par test de formule. Le fork 998 crée réellement un pool HyperSwap V3 éphémère, mint la position single-sided, déploie token/rewards/adapter et exécute un achat HYPE→FWA par le router officiel.

Couverture actuelle :

- formule inverse `1e36 / backing`, arbre de poids et prix harmonique ;
- paramètres courants, notamment crown 1 % ;
- requête PoP, authentification du callback et domain separation ;
- même valeur PoP dans une fenêtre, mais mots FWA distincts par request ID ;
- callback dupliqué, non autorisé ou qui doit être retenté ;
- plusieurs acquisitions en vol et callbacks hors ordre ;
- timeout, expiration et pull-refund ;
- staging des dépôts pendant une acquisition ;
- keep NFT, accept bid 85 %, passifs HYPE et claims ;
- ERC-721 bloqué ou temporairement non transférable ;
- stuck NFT et récupération ;
- destinataire qui refuse HYPE, payé par le chemin force-transfer ;
- mode withdraw-only et sortie d'une position existante.
- attestations factory/router/NFPM/wHYPE HyperSwap sur chain ID 998 ;
- lancement atomique du pool V3 tier 1 %, orientation token0/token1 et position single-sided ;
- gating des achats externes avant ouverture, ventes et achats rewards ;
- exact-input, `minOut`, partial fill, faux output router et absence de HYPE captif ;
- comptabilité rewards différentielle, claim acheteur et `buyFor` ;
- buyback 0,5 % caller puis routage 40/40/20 et burn réel.

Le profil `fork` est fixé au bloc Ethereum `25_609_502` et valide les huit code hashes officiels, les slots EIP-1967 nuls, le wiring courant, les paramètres forensic et la recompilation exacte du runtime sans immutable de `FWAVRFService`.

## Adaptateur Proof of Play

Provider testnet fixé dans le script :

```text
0xd14D984603b0b7Ade91bE52f3Fc4A917Dfa77bcD
```

Une requête FWA reçoit un ID local monotone. L'adaptateur demande ensuite un ID PoP et dérive le mot final ainsi :

```text
keccak256(
  domain,
  chainId,
  adapter,
  providerRequestId,
  localRequestId,
  consumer,
  providerWord
)
```

Le mot PoP reste l'unique source d'aléa. Les autres champs font uniquement de la séparation de domaine. Le callback authentifié écrit son état, appelle `rawFulfillRandomWords`, et revert entièrement si le consumer échoue afin de préserver un chemin de retry.

L'adaptateur expose également `getSubscription`, `fundSubscriptionWithNative` et `pendingRequestExists` pour conserver `FWAVRFService` et la logique de réconciliation de FWA. Ce solde de compatibilité n'est pas dépensé par PoP ; ses valeurs définitives doivent être réglées après mesure testnet.

## Déploiement testnet par gates

### 1. Déployer sans ouvrir les acquisitions

Préconditions :

- chain ID 998 ;
- wallet de déploiement financé en HYPE testnet ;
- mode big blocks HyperEVM activé pour le compte de déploiement, car le déploiement FWA peut dépasser la limite du fast block ;
- `.env` local rempli à partir de `.env.example`.

Simulation puis broadcast :

```powershell
& 'C:\Users\eliot\.foundry\bin\forge.exe' script script/DeployHyperEVMCore.s.sol:DeployHyperEVMCore --rpc-url hyperevm_testnet -vvvv
& 'C:\Users\eliot\.foundry\bin\forge.exe' script script/DeployHyperEVMCore.s.sol:DeployHyperEVMCore --rpc-url hyperevm_testnet --broadcast --slow -vvvv
```

Le script déploie et câble :

1. `PoPRandomnessAdapter` ;
2. `FWAVRFService` ;
3. `FWA` ;
4. `FWAWhitelist`.

Il force le crown courant à 1 %, transfère les ownerships vers `FWA_OWNER`, mais laisse les acquisitions désactivées et l'allowlist vide.

Le dry-run local en chain ID 998 a réussi. Mesure observée : environ `4.86 M gas` pour la transaction de création FWA et `11.77 M gas` pour l'ensemble des dix transactions. La création FWA ne tient donc pas dans un fast block de 2 M gas et doit effectivement passer par le mode big blocks ; chaque transaction reste sous la limite slow block de 30 M gas.

### 2. Déployer token, rewards et marché sans ouvrir les achats externes

Cette étape doit précéder l'activation des acquisitions afin que l'horloge des émissions ne démarre pas avant que les modules soient câblés. `FWA_TOKENOMICS_CONFIRMED=true` atteste uniquement la configuration de testnet fournie : le destinataire explicite des 20 % doit être un wallet de test contrôlé tant que la tokenomics de saison n'est pas figée.

```powershell
& 'C:\Users\eliot\.foundry\bin\forge.exe' script script/DeployHyperSwapToken.s.sol:DeployHyperSwapToken --rpc-url hyperevm_testnet -vvvv
& 'C:\Users\eliot\.foundry\bin\forge.exe' script script/DeployHyperSwapToken.s.sol:DeployHyperSwapToken --rpc-url hyperevm_testnet --broadcast --slow -vvvv
# Reporter FWA_TOKEN_ADDRESS depuis HyperSwapTokenDeployed dans .env avant la suite.
& 'C:\Users\eliot\.foundry\bin\forge.exe' script script/DeployHyperSwapModules.s.sol:DeployHyperSwapModules --rpc-url hyperevm_testnet -vvvv
& 'C:\Users\eliot\.foundry\bin\forge.exe' script script/DeployHyperSwapModules.s.sol:DeployHyperSwapModules --rpc-url hyperevm_testnet --broadcast --slow -vvvv
& 'C:\Users\eliot\.foundry\bin\forge.exe' script script/VerifyHyperSwapModules.s.sol:VerifyHyperSwapModules --rpc-url hyperevm_testnet -vvvv
```

Le premier script déploie le token et initialise son pool dans **une seule transaction atomique** via `FWATokenHyperEVMFactory`, empêchant une pré-initialisation hostile du pool. Le second déploie rewards/adapter, câble FWA et répartit la supply : 50 % LP, 30 % rewards et 20 % vers `FWA_LEGACY_ALLOCATION_RECIPIENT`. Cette séparation garde chaque script Foundry sous la limite EIP-170. Le NFT LP est envoyé à `FWA_LP_RECIPIENT` et reste récupérable sur testnet. `externalBuysEnabled` reste faux.

### 3. Enregistrer PoP puis activer le core

L'adresse de l'adaptateur doit être transmise à Proof of Play pour l'inscription manuelle early access. Ne pas définir `POP_REGISTRATION_CONFIRMED=true` avant confirmation effective.

Après confirmation et validation des collections :

```powershell
& 'C:\Users\eliot\.foundry\bin\forge.exe' script script/VerifyHyperEVMCore.s.sol:VerifyHyperEVMCore --rpc-url hyperevm_testnet -vvvv
& 'C:\Users\eliot\.foundry\bin\forge.exe' script script/ActivateHyperEVMCore.s.sol:ActivateHyperEVMCore --rpc-url hyperevm_testnet --broadcast --slow -vvvv
```

`ActivateHyperEVMCore` refuse de continuer sans confirmation PoP, liste de collections non vide et câblage bidirectionnel valide.

### 4. Ouvrir le marché seulement après les E2E

Après la matrice complète PoP + gameplay + settlements + rewards + buybacks, définir `HYPERSWAP_E2E_CONFIRMED=true`, revalider les modules, puis ouvrir les achats externes :

```powershell
& 'C:\Users\eliot\.foundry\bin\forge.exe' script script/VerifyHyperSwapModules.s.sol:VerifyHyperSwapModules --rpc-url hyperevm_testnet -vvvv
& 'C:\Users\eliot\.foundry\bin\forge.exe' script script/ActivateHyperSwapMarket.s.sol:ActivateHyperSwapMarket --rpc-url hyperevm_testnet --broadcast --slow -vvvv
```

## Matrice de contrôle des CA testnet

Pour chaque adresse déployée :

| Contrôle | FWA | VRF service | PoP adapter | Whitelist |
|---|---:|---:|---:|---:|
| `eth_getCode` non vide | Oui | Oui | Oui | Oui |
| Owner attendu | Oui | Oui | Oui | Oui |
| Wiring bidirectionnel | coordinator/service | host | consumer/provider | host |
| Paramètres courants | Oui | Oui | Oui | TTT désactivé |
| Événements de déploiement | Oui | Oui | Oui | Oui |
| Parcours transactionnel | list/acquire/settle | fee/coverage/process | request/callback/retry | add/block |

| Contrôle | Token | Rewards | HyperSwap adapter | Pool V3 / LP NFT |
|---|---:|---:|---:|---:|
| `eth_getCode` non vide | Oui | Oui | Oui | Oui / NFPM owner |
| Owner attendu | Oui | Oui | Oui | LP recipient test |
| Wiring | pool/adapter/rewards | FWA/adapter/token | factory/router/pool/buyers | wHYPE/FWA, fee 1 % |
| Supply/passifs | 1 Md, 50/30/20 | émissions/allowances | zéro HYPE captif | seed single-sided |
| Parcours | guard/buyback/burn | claims/`buyFor` | exact-input/minOut | buy/sell/fees |

Les tests transactionnels testnet devront au minimum produire les receipts et événements de : dépôt, acquisition simple, deux acquisitions en vol, callback PoP, traitement permissionless, keep, accept-bid, timeout simulable, retrait earnings et payout fees.

## État des contrats restants

La cotation de `$FWA` est désormais fixée sur HyperSwap. La baseline testnet est HyperSwap V3, tier 1 %, avec factory `0x22B0768972bB7f1F5ea7a8740BB8f94b32483826`, router `0xD81F56576B1FF2f3Ef18e9Cc71Adaa42516fD990`, NFPM `0x09Aca834543b5790DB7a52803d5F9d48c5b87e80` et wHYPE `0xADcb2f358Eae6492F61A5F87eb8893d09391d160`. Ces liaisons ont été vérifiées directement sur le RPC chain ID 998.

Le port est implémenté et testé : `FWARewardsHyperEVM`, `FWATokenHyperEVM`, `FWAHyperSwapAdapter` et `FWATokenHyperEVMFactory`. `FWATokenHook` ne sera pas déployé sur HyperEVM : son équivalent est réparti entre le fee tier V3, le guard du token et l'adapter. Aucun transfer-tax ERC-20 n'est ajouté.

`FWAClaim` attend la décision sur les 20 % v1. `Splitter` attend les bénéficiaires de la nouvelle saison. Le NFT LP restera contrôlé par le wallet de test sur 998 ; aucune opération irréversible de burn/delegation n'est autorisée pendant les tests.

L'ordre restant est donc : obtenir l'inscription PoP, déployer le core puis les modules HyperSwap sur 998, vérifier chaque CA, activer le core, exécuter la matrice complète, puis seulement ouvrir les achats externes. `FWAClaim` et `Splitter` ne sont pas nécessaires à ce premier testnet technique tant que leurs bénéficiaires de saison ne sont pas figés.
