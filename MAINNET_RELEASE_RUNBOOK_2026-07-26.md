# Hyper World Assets — runbook HyperEVM mainnet 999

Ce runbook prépare un lancement reproductible et fail-closed. Il **n'autorise aucun déploiement**. Les adresses, recipients, tokenomics, collection snapshot, prix Project X et Safe restent des décisions humaines irréversibles à figer avant broadcast.

## 1. Architecture de release

- core FWA de référence, whitelist et `FWAVRFService`;
- `DrandEvmnetRegistry` + `DrandBN254Coordinator`, preuve evmnet BN254 vérifiée on-chain;
- `SplitterHyperEVM`, split figé avant activation et horloge de claim démarrée au lancement;
- `FWATokenHyperEVM`, adapter Project X V3, locker et rewards;
- buys publics HWA fermés par défaut et ouverts/fermés manuellement par le Safe;
- indexeur de découverte/historique, avec revalidation on-chain et secours positions checkpointé via un RPC logs/archives dédié et revu;
- frontend fail-closed et manifeste public promu seulement après canary;
- calldatas Safe générés depuis l'état chain 999, jamais depuis un template offline exécutable.

## 2. Valeurs à signer avant broadcast

| Entrée | Exigence |
|---|---|
| `FWA_OWNER` | Safe chain 999 déployé, bytecode et signers revus |
| Deployer | clé temporaire, solde minimal, jamais utilisée par le frontend |
| Snapshot | HWA Genesis immuable/frozen, supply 333, `MAX_TOKEN_ID=333`, secondary explicitement nul |
| Collections gameplay | adresse, nom, symbol, deployment block, métadonnées/hosts |
| Randomness | paramètres délai/expiry/bounty/réserve et deux submitters indépendants |
| Tokenomics | 500 M LP, 300 M rewards, destination documentée des 200 M restants |
| Project X | prix initial signé, bornes FDV, range, fee recipient, contrats officiels revérifiés ; politique buyback TWAP immuable relue |
| Production | domaine, RPC transactionnel, RPC logs/archives dédié et plage documentée, endpoint indexeur HTTPS, URL Project X, CSP/metadata hosts |

Créer `.env.mainnet.local` depuis `.env.mainnet.example` et ne jamais le committer :

```powershell
. .\scripts\ImportEnvFile.ps1 -Path .env.mainnet.local
```

Tous les flags restent `false` jusqu'à leur étape. Ne pas conserver de `.env` testnet à la racine pendant la gate mainnet.

## 3. Gate pré-déploiement

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\TestReleaseCandidate.ps1 -CleanInstall
```

Sans manifeste 999 — situation normale avant déploiement — le build indexeur mainnet est enregistré comme **skipped/prepared**, jamais comme validé. Exiger : contrats/tests/frontend/indexeur testnet/fork réussis, aucune vulnérabilité production high+, `broadcastPerformed: false`.

## 4. Déploiement fail-closed

Toutes les commandes suivantes sont d'abord exécutées sans `--broadcast`. Le broadcast n'est ajouté qu'après comparaison du dry-run, audit externe et double validation.

### 4.0 Safe HWA 2-sur-3

Déployer en premier le Safe déterministe préparé dans `release/hwa-safe-mainnet-preparation.json`.
Le flag `HWA_SAFE_DEPLOYMENT_CONFIRMED` reste faux pendant le dry-run. Après le broadcast explicite,
vérifier la version `1.4.1`, les trois signers, le seuil 2, l'absence de modules/guard et l'adresse
attendue `0x75818fd0a2Ff801F974C9a5d23616fbd38b15f4C`. Alors seulement renseigner cette adresse dans
`FWA_OWNER`, `FWA_PROJECTX_FEE_RECIPIENT` et `FWA_LEGACY_ALLOCATION_RECIPIENT`.

```powershell
& .\.tools\foundry\forge.exe script script/DeployHWASafe.s.sol:DeployHWASafe --rpc-url hyperevm_mainnet -vvvv
& .\.tools\foundry\forge.exe script script/VerifyHWASafe.s.sol:VerifyHWASafe --rpc-url hyperevm_mainnet -vv
```

### 4.1 Collection Genesis optionnelle

La collection canonique est `Pressure Field` v3 (`HWA-GEN-3.0.0`), aggregate
`96b80e5c8a06b07407d92b58dbf7865aab242439bdfdb5d8436e370cd2915648`. Toute autre version est
interdite. Avant préparation de l'hébergement final :

```powershell
npm --prefix frontend run genesis:v3:verify
& .\scripts\PrepareHWAGenesisHosting.ps1
```

Après choix du hostname VPS HTTPS, préparer le paquet versionné final puis l'attester à distance :

```powershell
& .\scripts\PrepareHWAGenesisHosting.ps1 -PublicOrigin "https://assets.example.tld"
& .\scripts\VerifyHWAGenesisHosting.ps1 -PackageRoot "release/hwa-genesis-v3-hosting" -Remote
```

Uploader uniquement le sous-dossier `public/` sous la racine Nginx. Les fichiers metadata y sont
nommés `1` à `333` sans extension, conformément à `tokenURI = baseURI + tokenId`. Ne renseigner
`HWA_GENESIS_NFT_BASE_URI` qu'avec le `tokenBaseUri` ayant obtenu l'attestation distante complète.
Conserver deux sauvegardes indépendantes et une archive hors ligne des hashes. IPFS reste un miroir
optionnel et n'est pas requis pour le lancement.

Si HWA fournit la collection bootstrap : déployer `HWAGenesisNFT`, faire exécuter par le Safe quatre
batches de mint `100/100/100/33`, tous vers le Safe, puis vérifier metadata et supply. Appeler le
freeze one-way uniquement après validation de l'URI finale. Le splitter refusera une collection non
frozen. Aucun mint/remint n'est possible après freeze; les NFT restent transférables pour la
distribution communautaire et les droits Splitter suivent leur owner courant.

```powershell
& .\.tools\foundry\forge.exe script script/DeployHWAGenesisNFT.s.sol:DeployHWAGenesisNFT --rpc-url hyperevm_mainnet -vvvv
```

Après confirmation du receipt et avant toute action Safe, produire les quatre mints et le freeze à
partir de l'état réel chain 999 :

```powershell
& .\scripts\PrepareHWAGenesisSafeActions.ps1 `
  -Collection $env:FWA_SPLITTER_SNAPSHOT_NFT `
  -BaseUri $env:HWA_GENESIS_NFT_BASE_URI `
  -RpcUrl https://rpc.hyperliquid.xyz/evm
```

Le JSON n'est exécutable que si le contrat est neuf, possède exactement la base URI HTTPS attestée,
une supply max de 333 et le Safe comme owner. Après exécution des cinq actions dans l'ordre via le
Safe, attester les 333 owners, la supply, les deux freezes et les URI extrêmes :

```powershell
& .\scripts\VerifyHWAGenesisOnchain.ps1 `
  -Collection $env:FWA_SPLITTER_SNAPSHOT_NFT `
  -BaseUri $env:HWA_GENESIS_NFT_BASE_URI `
  -RpcUrl https://rpc.hyperliquid.xyz/evm
```

Le Splitter ne doit être déployé qu'après `splitterDeploymentAllowed: true` dans cette attestation.

### 4.2 Splitter

Déployer avec `FWA_SPLITTER_DEPLOYMENT_CONFIRMED=true` et `MAINNET_DEPLOYMENT_CONFIRMED=true`. Vérifier owner Safe, secondary nul, snapshot NFT, supply 333, max ID 333 et 70/30. Le Safe appelle ensuite `freezeSplit()`; `startRevenueClock()` reste séparé jusqu'à l'ouverture réelle.

```powershell
& .\.tools\foundry\forge.exe script script/DeploySplitterHyperEVM.s.sol:DeploySplitterHyperEVM --rpc-url hyperevm_mainnet -vvvv
```

### 4.3 Core et randomness

`DeployHyperEVMMainnetCore` exige chain 999, Safe owner, splitter final, réserve suffisante et paramètres obligatoires. Il déploie registry/coordinator/service/core/whitelist, configure timeout 360 blocs, limite les batches mainnet à 1 et laisse acquisitions fermées. Le délai du round drand est fixé à au moins **30 secondes** par le contrat lui-même et par la configuration de release ; une valeur inférieure fait échouer le déploiement.

```powershell
& .\.tools\foundry\forge.exe script script/DeployHyperEVMMainnetCore.s.sol:DeployHyperEVMMainnetCore --rpc-url hyperevm_mainnet -vvvv
```

Reporter les 6 adresses et le bloc dans `.env.mainnet.local`. Les anciens coordinateurs Gelato/relay/PoP sont interdits par constructeur sur chain 999.

### 4.4 Project X, token et rewards

Suivre `PROJECTX_DEPLOYMENT_RUNBOOK.md`. Les phases irréversibles ont leurs gates propres : prix/range confirmés, lancement atomique, LP lock, bindings core/rewards/adapter et E2E Project X. Le lancement augmente aussi la cardinalité d'observation du pool ; le buyback reste fermé pendant les 30 premières minutes, puis utilise automatiquement le TWAP et une limite relative au spot. La création permissionless du pool, son initialisation et le mint direct de la LP au locker restent une transaction atomique.

À la fin : tous les owners sont le même Safe, LP NFT dans le locker, rewards financé de 300 M HWA, adapter lié, `externalBuysEnabled=false`, emergency rescue non planifié.

## 5. Bindings et calldatas Safe

Générer une première fois les actions après tous les déploiements :

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\PrepareMainnetOwnerActions.ps1 `
  -Fwa $env:FWA_ADDRESS -Whitelist $env:FWA_WHITELIST_ADDRESS `
  -Rewards $env:FWA_REWARDS_ADDRESS -Token $env:FWA_TOKEN_ADDRESS `
  -Splitter $env:FWA_SPLITTER_ADDRESS `
  -Coordinator $env:FWA_DRAND_BN254_COORDINATOR_ADDRESS `
  -RpcUrl https://rpc.hyperliquid.xyz/evm `
  -Collections ($env:FWA_COLLECTIONS -split ',') `
  -CanaryCollection $env:FWA_CANARY_COLLECTION
```

Le générateur atteste chain 999, bytecodes, Safe owner commun, états fail-closed, split, coordinator et rewards. Si rewards n'est pas encore lié, le JSON contient seulement `preActivation` et `executable=false`. Exécuter `FWA.setRewards`, attendre le receipt, puis **régénérer**. Le second JSON peut contenir :

- `activationBatch` : allowlist de la seule collection canary, démarrage horloge splitter, acquisitions;
- `postCanaryPublicCollectionsTemplate` : aperçu explicitement non exécutable des autres collections;
- `emergencyPause` : fermeture des acquisitions et passage en retrait uniquement;
- `manualTradingControls.open/close` : circuit breaker Project X indépendant.

Après une acquisition canary réellement finalisée, relever son `requestId` depuis le receipt puis produire l'action publique avec une nouvelle lecture RPC :

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\PreparePostCanaryCollections.ps1 `
  -Fwa $env:FWA_ADDRESS -Whitelist $env:FWA_WHITELIST_ADDRESS `
  -Coordinator $env:FWA_DRAND_BN254_COORDINATOR_ADDRESS `
  -CanaryCollection $env:FWA_CANARY_COLLECTION `
  -CanaryRequestId $env:FWA_CANARY_REQUEST_ID `
  -PublicCollections ($env:FWA_PUBLIC_COLLECTIONS -split ',') `
  -RpcUrl https://rpc.hyperliquid.xyz/evm
```

Ce second générateur refuse de produire un calldata si le request n'est pas exactement `Fulfilled`, si aucune randomness drand vérifiée n'est liée à cet ID, ou si le core/coordinator garde une requête pendante. Il ne broadcaste jamais.

Un fichier produit avec `-OfflineTemplate` est uniquement un self-test non exécutable.

## 6. Attestations read-only

```powershell
& .\.tools\foundry\forge.exe script script/VerifyHyperEVMCore.s.sol:VerifyHyperEVMCore --rpc-url hyperevm_mainnet -vv
& .\.tools\foundry\forge.exe script script/VerifyDrandBN254Coordinator.s.sol:VerifyDrandBN254Coordinator --rpc-url hyperevm_mainnet -vv
& .\.tools\foundry\forge.exe script script/VerifyProjectXModules.s.sol:VerifyProjectXModules --rpc-url hyperevm_mainnet -vv
& .\.tools\foundry\forge.exe script script/ActivateHyperEVMMainnet.s.sol:ActivateHyperEVMMainnet --rpc-url hyperevm_mainnet -vv
```

Le dernier script a gardé son nom historique mais est strictement read-only. Il ne remplace pas l'exécution Safe.

## 7. Randomness et indexeur avant ouverture

Prouver au moins un round evmnet récent, lancer deux relayers indépendants et observer leur convergence. Voir `DRAND_GELATO_RANDOMNESS_RUNBOOK.md`. Le submitter transporte une preuve publique; il ne choisit pas le mot.

Écrire ensuite le manifeste 999 fail-closed avec `WriteMainnetManifest.ps1`. Il exige toutes les adresses, `deployedAtBlock` et au moins une collection avec deployment block; il écrit toujours `writesEnabled=false` et `acquisitionsEnabled=false`.

```powershell
Set-Location indexer
npm ci
npm run check:mainnet
npm audit --omit=dev --audit-level=high
Set-Location ..
```

Publier le subgraph seulement après revue du YAML rendu. Vérifier `_meta`, absence d'erreurs, lag, ownership et événements governance/rewards/splitter. La clé de publication n'est jamais `NEXT_PUBLIC_*`.

Configurer les hosts metadata HTTPS exacts et tester IPFS/HTTPS/refus SSRF. Préparer les standard JSON avec `PrepareSourceVerification.ps1`; l'envoi public exige `-Submit -ConfirmPublicSubmission`.

## 8. Gate post-déploiement

Avec le manifeste 999 et l'env local :

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\TestReleaseCandidate.ps1 `
  -CleanInstall -MainnetMode -MainnetEnvPath .env.mainnet.local
```

Cette fois, aucun skip n'est accepté : le rapport doit être `passed`, inclure le build indexeur 999, les quatre attestations live 999 et conserver `broadcastPerformed=false`. Le switch optionnel `-VerifyLiveTestnet` concerne uniquement l'ancien déploiement 998 et n'est pas une gate mainnet.

## 9. Canary puis promotion

Le frontend public reste read-only.

1. Exécuter le `activationBatch` canary via le Safe; aucune autre collection n'est encore autorisée.
2. Déposer un NFT canary de faible valeur puis l'acquérir depuis un second wallet.
3. Observer request, preuve officielle on-chain, callback, statut `Fulfilled`, allocation, settlement, earnings, rewards et indexation.
4. Tester les quatre sorties, reload/reprise du ticket, secours positions avec indexeur coupé et RPC logs/archives dédié, reprise depuis checkpoint, puis claims splitter.
5. En cas d'échec, exécuter `emergencyPause`; ne pas produire d'action publique ni promouvoir le manifeste.
6. En cas de succès, régénérer puis exécuter l'action de `PreparePostCanaryCollections.ps1` pour les collections publiques.
7. Promouvoir ensuite le manifeste :

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\PromoteMainnetManifest.ps1 `
  -PublicIndexerUrl $env:NEXT_PUBLIC_INDEXER_URL `
  -ConfirmOnchainActivation -ConfirmDrandHealthy -ConfirmProjectXVerified `
  -ConfirmIndexerHealthy -ConfirmMainnetE2E
```

Rebuilder et publier le frontend depuis ce manifeste exact.

## 10. Trading public HWA

Gameplay et trading sont deux switches séparés. Le Safe décide manuellement quand exécuter `manualTradingControls.open`; aucun timer ne peut ouvrir le marché. Avant l'ouverture : liquidité, route Project X, spot on-chain, buy/sell canary et affichage frontend. `close` doit rester immédiatement disponible.

## 11. Arrêt d'urgence

- fermer acquisitions et buys externes;
- publier/revenir à un manifeste read-only;
- conserver retraits, refunds, settlements, recovery et claims splitter;
- expirer permissionlessly les requêtes randomness abandonnées;
- ne migrer qu'après réconciliation des liabilities et zéro request/acquisition pending;
- conserver receipts, proofs drand, logs Safe, bloc indexeur et hash du frontend.

Les contrats ne sont pas upgradeables. Toute correction après déploiement implique une migration explicite, jamais un remplacement silencieux.
