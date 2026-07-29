# Déploiement HWA sur Project X — HyperEVM

Ce runbook est fail-closed. Les commandes sans `--broadcast` servent aux simulations. Aucun broadcast chain 999 n'est autorisé avant validation écrite de toutes les gates.

## 1. Préconditions

- fichier mainnet séparé basé sur `.env.mainnet.example` ;
- owner final = owner configuré et attesté. Le lancement 2026-07-29 utilise explicitement
  `0x24398fc31899E2384E4E070fcdBF8Bb6D916FcD9`, identique au deployer, avec
  `MAINNET_EOA_OWNER_CONFIRMED=true`. Toute autre EOA est rejetée ;
- recipients, snapshot, collections et allocation 20 % signés ;
- worksheet prix/range signé et politique buyback immuable relue (TWAP 30 min, 90 % après fee, limite spot relative) ;
- adresses Project X et owner/feeProtocol réattestés ;
- audit indépendant fermé.

## 2. Ordre des scripts

1. Core et randomness : `DeployHyperEVMMainnetCore.s.sol`, puis vérifications.
2. Token/pool/LP atomiques : `DeployProjectXToken.s.sol`.
3. Adapter/rewards/allocation : `DeployProjectXModules.s.sol`.
4. Binding core : `BindProjectXRewards.s.sol`, sans ouvrir acquisitions, trading ou émissions.
5. Attestation read-only : `VerifyProjectXModules.s.sol`.
6. Sources, indexeur et manifeste fail-closed.
7. Canary gameplay, acquisitions ensuite seulement.
8. Ouverture trading séparée avec `ActivateProjectXMarket.s.sol`.

Le wallet de déploiement doit opter temporairement pour les big blocks si une transaction dépasse 2 M gas, puis revenir aux fast blocks après confirmation.

Immediately before step 2, select and double-enter the ordering-dependent price from the live
deployer nonce. This performs no transaction and becomes invalid as soon as that nonce changes:

```powershell
& .\scripts\SelectHWAProjectXLaunchPrice.ps1 -SyncEnv
```

The approved target is 640 HYPE FDV inside the signed 600–700 HYPE band. Never reuse a prior price
selection after any deployer transaction, including a failed-on-chain transaction that consumed a
nonce.

Sur chain 999, `BindProjectXRewards.s.sol` n'accepte une EOA que si elle correspond exactement à
la clé `PRIVATE_KEY` et si `MAINNET_EOA_OWNER_CONFIRMED=true`. Cette action ne lance ni les rewards,
ni les acquisitions, ni les achats publics.

## 3. Simulations obligatoires

```powershell
.\.tools\foundry\forge.exe test -vv
$env:FOUNDRY_PROFILE='hyperevm'
.\.tools\foundry\forge.exe test --fork-url https://rpc.hyperliquid.xyz/evm --match-contract ProjectXDeploymentTest -vv
.\.tools\foundry\forge.exe script script/DeployProjectXToken.s.sol:DeployProjectXToken --rpc-url hyperevm_mainnet -vv
.\.tools\foundry\forge.exe script script/DeployProjectXModules.s.sol:DeployProjectXModules --rpc-url hyperevm_mainnet -vv
```

## 4. Attestations post-déploiement

`VerifyProjectXModules.s.sol` doit confirmer factory/router/NFPM/wHYPE, pool canonique, fee/spacing, LP locker, tokenomics, adapter, rewards, splitter, owners et achats fermés. Le manifeste est écrit avec `writesEnabled=false` et `acquisitionsEnabled=false`.

## 5. Activation

Gameplay et trading sont indépendants. L'owner active d'abord le canary gameplay. Les achats Project X ne sont ouverts que par une action ultérieure, manuelle et réversible. Aucune activation n'est couplée à une heure ou à un nombre de blocs.
