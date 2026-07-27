# HWA / Nest — demande technique avant création du pool

> **ARCHIVÉ — 26 juillet 2026.** Cette demande n'est plus active ; Project X V3 est la cible de lancement.

Date de préparation : 26 juillet 2026  
Réseau cible : HyperEVM mainnet, chain ID `999`  
Paire de travail : `$HWA / wHYPE` — adresse du token communiquée après validation de la procédure  
Important : ne créer aucun pool pour cette paire avant validation écrite de la séquence atomique.

## Message court à envoyer dans le groupe

> Hello Nest team — we are preparing the HWA launch on HyperEVM using a Nest Algebra Integral pool for the `$HWA/wHYPE` pair.
>
> Our token launch uses a dedicated pool plugin. The plugin blocks unauthorized initialization, exact-output swaps, external buys before manual activation, and any later liquidity mint. The final pool configuration must be:
>
> - ERC-20 metadata: `Hyper World Assets` / `HWA` / 18 decimals;
> - static fee: `10_000` (1% in Algebra units);
> - community fee: `0`;
> - tick spacing: `60`;
> - plugin config: `7` (`beforeSwap | afterSwap | beforeModifyPosition`);
> - initial LP: single-sided HWA, minted directly to an irreversible locker;
> - public token buys opened manually by our Safe after launch checks.
>
> The blocker is pool creation safety. A base pool is unique for the pair and `initialize()` is externally callable. Our plugin constructor also requires the pool to already exist. We therefore cannot accept a public block between `createPool()` and attachment of the guard plugin.
>
> Could you confirm which supported route Nest can provide?
>
> **Option A — Nest-operated atomic creation:** one Safe/bundle transaction that creates the pool, deploys or obtains the dedicated plugin, attaches it, sets plugin config `7`, and either initializes the pool in the same transaction or leaves initialization exclusively callable through our token because the attached `beforeInitialize` guard checks the token's one-shot `launching()` latch.
>
> **Option B — audited one-shot wrapper:** Nest grants the minimum pool-creation/admin permission to a dedicated non-upgradeable wrapper, reviewed by both teams, that performs the protected sequence and permanently loses/relinquishes all Nest permissions after success.
>
> If you prefer Algebra's custom-pool entry point/plugin-factory route, please provide the exact deployed entry point, ABI/version and mapping used to discover the resulting pool. Our current integration targets the base-pool `factory.poolByPair(token, wHYPE)` path, so a custom pool requires an explicit adaptation and new fork tests.
>
> We also need a written post-launch admin matrix: who can replace/detach the plugin, change plugin config, fee, community fee or tick spacing, grant/revoke pool-admin roles, change public pool creation mode, and upgrade the factory implementation. Please include the controlling addresses, Safe thresholds and any timelock or operational policy.
>
> We can share the plugin, token gate, locker, fork test and exact acceptance reads immediately. No mainnet transaction will be sent before both teams approve the dry-run and final calldata.

## Pièces à joindre

Envoyer avec le message :

1. `NEST_ADMIN_HANDOFF.md` — actions et lectures d'acceptation ;
2. `NEST_INTEGRATION_RFC.md` — architecture, invariants et confiance résiduelle ;
3. `src/hyperevm/FWANestPlugin.sol` — garde du pool ;
4. `src/hyperevm/FWATokenNest.sol` — latch d'initialisation et attestations ;
5. `src/hyperevm/FWANestLiquidityLocker.sol` — verrouillage de la position ;
6. `hyperevm-fork-test/NestDeployment.t.sol` — preuve exécutée contre la stack Nest 999.

Ne pas envoyer de clé, de fichier `.env`, de calldata signée ou d'adresse finale du token avant la revue de la procédure.

## Questions auxquelles Nest doit répondre

### 1. Chemin de création atomique

1. La factory Nest actuelle supporte-t-elle un batch atomique officiel pour :
   - `createPool(token, wHYPE)` ;
   - déploiement/récupération du plugin dédié ;
   - `setPlugin(plugin)` ;
   - `setPluginConfig(7)` ;
   - `initialize(initialSqrtPriceX96)` ou appel contrôlé de `token.initializeMarket(...)` ;
   - configuration post-initialisation du fee, community fee et tick spacing ?
2. Ce batch est-il exécuté par le Safe Nest via `MultiSend`, par un contrat d'entry point, ou par une factory de plugins ?
3. Si `MultiSend` est utilisé, quel contrat déploie le plugin dans le même appel et comment son adresse est-elle déterminée ?
4. Le pool reçoit-il automatiquement un plugin Nest par défaut pendant `createPool` ? Si oui :
   - par quel hook/factory ;
   - peut-il être remplacé dans le même transaction receipt ;
   - un système Nest peut-il le réinstaller automatiquement plus tard ?
5. La stack déployée expose-t-elle l'`AlgebraCustomPoolEntryPoint` et le rôle `CUSTOM_POOL_DEPLOYER` ? Fournir les adresses, ABI et version exacte.
6. Si Nest recommande un custom pool, confirmer comment le pool est découvert on-chain et si le router, quoter, position manager, gauges et indexeur Nest le supportent sans intégration spéciale.

### 2. Point précis sur l'initialisation

Le plugin actuel refuse `beforeInitialize` sauf pendant l'appel one-shot de `FWATokenNest.initializeMarket`, grâce au flag temporaire `TOKEN.launching()`.

Nest doit choisir et confirmer l'un de ces modèles :

- **modèle minimal sûr, préféré sans changement du token** : création + plugin + config atomiques ; initialisation ultérieure par le Safe HWA via `token.initializeMarket`. Une fois le plugin attaché, un tiers ne peut plus initialiser ;
- **modèle strictement tout-en-un** : création + plugin + initialisation + paramètres finaux atomiques. Ce modèle nécessite un mécanisme de coordination audité entre l'autorité Nest et l'owner HWA ; une simple suite de deux Safe transactions n'est pas atomique.

Nous ne proposons pas de transférer temporairement l'ownership du token au Safe Nest. Si un wrapper est nécessaire, son autorité doit être one-shot, bornée à la paire et révoquée dans la transaction de succès.

### 3. Paramètres post-initialisation

Confirmer que Nest accepte pour ce seul pool :

| Lecture finale | Valeur exigée |
|---|---:|
| `token.name()` | `Hyper World Assets` |
| `token.symbol()` | `HWA` |
| `pool.plugin()` | plugin HWA audité |
| `globalState().pluginConfig` | `7` |
| `pool.fee()` | `10_000` |
| `globalState().lastFee` | `10_000` |
| `globalState().communityFee` | `0` |
| `pool.tickSpacing()` | `60` |

Questions complémentaires :

1. L'initialisation réapplique-t-elle actuellement les defaults factory sur cette version de Nest ?
2. Les setters refusent-ils les écritures identiques ?
3. Existe-t-il un keeper, gouverneur, plugin manager ou processus opérationnel qui remet automatiquement les defaults ou le plugin dynamique Nest ?
4. `communityFee = 0` restera-t-il accepté après le lancement ?
5. Le pool peut-il rester en fee statique sans flag `DYNAMIC_FEE` ?

### 4. Pouvoirs administratifs après lancement

Demander une matrice explicite, fonction par fonction :

| Pouvoir à confirmer | Adresse/rôle | Seuil | Timelock | Peut être révoqué ? |
|---|---|---:|---:|---|
| `setPlugin` / détacher ou remplacer le plugin | | | | |
| `setPluginConfig` / activer `DYNAMIC_FEE` ou retirer un hook | | | | |
| `setFee` | | | | |
| `setCommunityFee` | | | | |
| `setTickSpacing` | | | | |
| grant/revoke `POOLS_ADMINISTRATOR_ROLE` | | | | |
| ouvrir/fermer la création publique de pools | | | | |
| changer le plugin factory / hook de création par défaut | | | | |
| upgrade de l'implémentation de la factory | | | | |
| changement du `ProxyAdmin` ou de son owner | | | | |
| modification du community vault / destination des protocol fees | | | | |
| ajout du pool à un gauge / émissions Nest | | | | |

Questions de risque :

1. Le Safe/role Nest peut-il remplacer le plugin par `address(0)` ou un plugin arbitraire après lancement ?
2. Peut-il activer le dynamic fee et faire varier le fee sans consentement HWA ?
3. Une upgrade de la factory peut-elle modifier les contrôles d'accès consultés par les pools existants ?
4. Les pools eux-mêmes sont-ils immuables ou dépendent-ils d'un beacon/proxy/implementation upgradeable ?
5. Nest accepte-t-il une politique écrite de non-modification de la configuration HWA, hors urgence coordonnée ?
6. Existe-t-il un emergency pause ou un autre rôle capable de bloquer swaps, LP ou collecte de fees ?

## État on-chain observé à transmettre pour confirmation

Lecture RPC HyperEVM mainnet au bloc `41,522,074`, chain ID `999` :

| Élément | Valeur observée |
|---|---|
| Factory | `0xF77Bd082c627aA54591cF2f2EaA811fd1AB3b1F3` |
| Factory owner | `0x6652173b0Cb3d96d8f0198bc49670440Dec69e79` |
| `POOLS_ADMINISTRATOR_ROLE` members | 1 membre, identique au factory owner |
| Factory owner Safe | 3 signatures sur 5 owners |
| `isPublicPoolCreationMode()` | `false` |
| `defaultTickspacing()` | `60` |
| `defaultFee()` | `500` = 0,05 % |
| `defaultCommunityFee()` | `1000` = 100 % du fee vers le community vault |
| Factory `ProxyAdmin` | `0x45727c03B46970C64E4039B546E6bd1F9c9d92ab` |
| `ProxyAdmin.owner()` | `0xFBcC128edfddb638B0939a67f6F505b37425F587` — contrat, nature et gouvernance à préciser par Nest |

Demander à Nest de confirmer ces lectures et de signaler toute rotation planifiée avant le lancement.

## Critères d'acceptation de la procédure proposée

La réponse Nest est exploitable seulement si elle contient :

1. un ordre exact des appels ;
2. l'adresse de chaque contrat appelé ;
3. l'identité du signataire/exécuteur de chaque appel ;
4. la preuve qu'aucun bloc public n'existe entre la création du base pool et l'installation de la garde ;
5. la valeur attendue de toutes les lectures du tableau post-init ;
6. une simulation ou transaction de test reproductible ;
7. le traitement d'un revert à chaque sous-étape — transaction entière revert, aucun pool partiel ;
8. la matrice de pouvoirs administratifs après lancement ;
9. la confirmation de compatibilité router, quoter, position manager, indexeur et éventuel gauge ;
10. la procédure d'urgence et les conditions sous lesquelles Nest modifierait le plugin ou les paramètres.

## Forme du wrapper si Nest demande que nous le fournissions

Le wrapper devra être audité avant autorisation et respecter au minimum :

- non-upgradeable ;
- paire `HWA/wHYPE`, factory, plugin bytecode hash, config et prix immuables ou commités avant exécution ;
- exécution one-shot ;
- aucun `arbitraryCall`, `delegatecall`, sweep générique ou changement de recipient ;
- revert atomique si une lecture finale diffère ;
- rôle Nest minimal, révocable et révoqué après succès ;
- aucun ownership durable du token HWA ;
- événements contenant pool, plugin, prix et paramètres finaux ;
- test fork contre les contrats Nest officiels ;
- revue indépendante des permissions, de CREATE2 et des chemins de reentrancy/callback Algebra.

Avant de coder ce wrapper, Nest doit confirmer le chemin de permissions exact. Un wrapper qui n'est pas reconnu par la factory ne peut pas rendre `createPool` atomique.

## Sources primaires

- Nest — contrats HyperEVM : https://docs.usenest.xyz/security/contracts
- Nest — architecture Algebra Integral : https://docs.usenest.xyz/key-features/the-unified-amm
- Algebra Integral — pool et fonctions administratives : https://docs.algebra.finance/algebra-integral-documentation/algebra-integral-technical-reference/integration-process/specification-and-api-of-contracts/algebra-pool
- Algebra Integral — plugins : https://docs.algebra.finance/algebra-integral/core-logic/plugins
- Algebra Integral — custom pools et hooks de création : https://docs.algebra.finance/algebra-integral-documentation/algebra-integral-technical-reference/changes-v1.1
