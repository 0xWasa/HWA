# Déploiement HWA sur Nest — HyperEVM

> **ARCHIVÉ — 26 juillet 2026.** Ne pas utiliser pour un nouveau déploiement. Le runbook actif est `PROJECTX_DEPLOYMENT_RUNBOOK.md`.

Ce runbook prépare les transactions Nest. Il ne donne jamais l'autorisation de broadcaster : `NEST_MAINNET_DEPLOYMENT_CONFIRMED` et chaque gate de phase restent à `false` jusqu'à la revue correspondante.

Les adresses officielles HyperEVM mainnet publiées par Nest sont consignées dans `.env.mainnet.example` et doivent être recroisées le jour du lancement avec la [page officielle des contrats Nest](https://docs.usenest.xyz/security/contracts).

## Invariants du marché

- paire `$HWA / wHYPE` Algebra Integral ;
- fee du pool : `10_000` = 1 % ;
- `communityFee = 0` ;
- tick spacing `60` ;
- plugin config `7` ;
- liquidité initiale single-sided en HWA ;
- NFT LP détenu par `FWANestLiquidityLocker`, principal irrécupérable ;
- exact-output refusé par le plugin ;
- buybacks du protocole permis même quand les achats publics sont fermés ;
- achats publics contrôlés uniquement par `setExternalBuysEnabled(bool)` du final owner, sans timer ni ouverture automatique.
- métadonnées ERC-20 immuables : `Hyper World Assets` / `HWA` / 18 décimales.

## Validation sans transaction

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\TestReleaseCandidate.ps1 -VerifyLiveTestnet

$env:FOUNDRY_PROFILE = 'hyperevm'
& .\.tools\foundry\forge.exe test --fork-url https://rpc.hyperliquid.xyz/evm --match-contract NestDeploymentTest -vv
Remove-Item Env:FOUNDRY_PROFILE
```

La simulation fork utilise la factory, le router et le position manager réels de chain 999. Elle crée un pool éphémère, configure le plugin avec l'autorité Nest impersonnée, lance la LP et effectue un achat protocolaire. Elle ne diffuse rien.

## Séquence mainnet

### 1. Token et locker

Exécuter d'abord sans `--broadcast`, contrôler les événements, puis seulement avec les gates explicites :

```powershell
& .\.tools\foundry\forge.exe script script/DeployNestToken.s.sol:DeployNestToken --rpc-url hyperevm_mainnet -vvvv
```

Reporter `FWA_TOKEN_ADDRESS` et `FWA_NEST_LIQUIDITY_LOCKER_ADDRESS`.

### 2. Création atomique du pool et de sa garde par Nest

Transmettre `NEST_ADMIN_HANDOFF.md` à Nest. Nest doit approuver un batch atomique ou le chemin custom-pool/plugin-factory Algebra qui empêche toute initialisation entre création et installation du plugin. **Ne pas créer le base pool** tant que cette procédure n'est pas confirmée. Vérifier ensuite `factory.poolByPair(wHYPE,HWA)`, `globalState().price == 0`, plugin et config dans le même receipt/protocole de création.

### 3. Attestation du plugin avant initialisation

`DeployNestPlugin` et la première configuration ne sont autorisés que dans la procédure atomique acceptée à l'étape 2. À sa sortie, le plugin et `pluginConfig=7` doivent être présents tandis que le prix reste nul.

### 4. Initialisation et configuration finale

`InitializeNestMarket` fixe le prix. Nest exécute ensuite `ConfigureNestPool` une seconde fois pour imposer fee 1 %, community fee 0, tick spacing 60, plugin et flags. Si une valeur ne peut pas être obtenue, le lancement s'arrête.

### 5. LP verrouillée

`LaunchNestMarket` crée la position single-sided. Contrôler :

- `token.launched() == true` ;
- `token.name() == "Hyper World Assets"` et `token.symbol() == "HWA"` ;
- `positionManager.ownerOf(lpTokenId) == locker` ;
- `locker.bound() == true` ;
- `externalBuysEnabled() == false`.

### 6. Adapter, rewards et allocation

`DeployNestModules` déploie l'adapter et rewards, lie le côté token, transfère 300 M HWA aux émissions et 200 M HWA au recipient legacy défini. Le script exige explicitement `FWA_TOKENOMICS_CONFIRMED=true`.

Le final owner exécute ensuite **séparément** `FWA.setRewards(rewards)` pendant que le pool NFT et les acquisitions sont vides. Avec un Safe, utiliser le champ `preActivation` produit par `PrepareMainnetOwnerActions.ps1`; avec un EOA de test seulement, utiliser `BindNestRewards.s.sol`.

### 7. Attestation et E2E fermé

```powershell
& .\.tools\foundry\forge.exe script script/VerifyNestModules.s.sol:VerifyNestModules --rpc-url hyperevm_mainnet -vv
```

Tester un `buyFor`/buyback, collecte de fees et tous les garde-fous alors que les achats externes restent fermés. Définir `NEST_E2E_CONFIRMED=true` uniquement après receipts et revue.

## Contrôle manuel du trading public

Le trading public n'est pas couplé à l'ouverture du gameplay. `PrepareMainnetOwnerActions.ps1` produit deux calldatas Safe indépendants :

- `manualTradingControls.open` → `setExternalBuysEnabled(true)` ;
- `manualTradingControls.close` → `setExternalBuysEnabled(false)`.

Le frontend lit le flag on-chain. Fermé, il explique que les buys sont manuellement désactivés. Ouvert, il redirige vers l'URL Nest revue dans le manifeste ; il ne simule jamais un swap public via l'adapter réservé au protocole.

## Testnet 998

Nest ne publie pas de déploiement officiel 998. Le testnet utilise donc un harness Algebra/Nest étiqueté comme tel, uniquement pour vérifier les interfaces et le flow. Aucun résultat sur ce harness ne doit être présenté comme de la liquidité Nest officielle.
