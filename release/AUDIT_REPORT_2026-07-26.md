# Hyper World Assets — rapport d'audit indépendant

**Cible** : release candidate HyperEVM mainnet, chain 999
**Date** : 2026-07-26
**Ancrage** : `release/audit-manifest.json` — **239/239 fichiers vérifiés SHA-256** contre l'arbre de travail au démarrage de l'audit. Le périmètre audité est donc exactement le bundle remis.
**Périmètre** : contrats core + HyperEVM, randomness, marché Nest, rewards, scripts de déploiement/activation, outillage PowerShell de release, frontend et indexeur. Juridique hors périmètre.
**Méthode** : 8 lentilles spécialisées en lecture intégrale du code, puis **chaque constat attaqué par 2 sceptiques indépendants** dont la consigne était de le réfuter. Un constat est retenu si au moins un sceptique n'a pas pu le réfuter. 86 constats bruts, **69 retenus**, 17 réfutés à l'unanimité.
**Livrable machine** : `release/audit-findings-2026-07-26.json` (86 constats, id `HWA-001`…, avec préconditions, scénario, impact, correctif minimal, test de non-régression et notes de réfutation).

---

## 1. Verdict

**Ne pas déployer en l'état.** Un défaut **critique** rend le résultat de chaque tirage sélectionnable par un tiers, et un second défaut critique rend ce tiers **irrévocable**. Les deux sont dans le même composant : `GelatoVRFCoordinator`.

Le reste du système est de bonne facture — le core est déployé en parité bytecode exacte, la conservation des passifs tient sur tous les chemins tracés, le Splitter est une transposition propre, et le verrou de trading Nest est correctement fail-closed. Le problème n'est pas la qualité générale : c'est que **le composant qui décide qui gagne quoi n'a aucune propriété d'intégrité on-chain**.

| Gate | État |
|---|---|
| Intégrité du bundle d'audit | ✅ 239/239 SHA-256 |
| Parité bytecode du core FWA | ✅ exacte (rebuild vérifié) |
| Conservation des passifs natifs | ✅ tenue sur tous les chemins tracés |
| **Intégrité du tirage aléatoire** | ❌ **bloquant** |
| **Réversibilité du fournisseur de hasard** | ❌ **bloquant** |
| Séquencement de release | ⚠️ 5 écarts à corriger |
| Indexeur | ❌ 1 bloquant fonctionnel (halte au 1ᵉʳ dépôt) |
| Frontend / frontière de confiance | ✅ solide, 4 écarts mineurs |

---

## 2. Bloquants — à corriger avant tout broadcast mainnet

### HWA-001 · CRITIQUE · exploitation-risk · Le mot aléatoire est une entrée libre de l'opérateur

**Fichier** : `src/hyperevm/GelatoVRFCoordinator.sol:140-168` (spécifiquement 154)

**Vérifié de première main.** `fulfillRandomness(uint256 randomness, bytes calldata dataWithRound)` authentifie `msg.sender == OPERATOR` et lie par hash le *payload* (`round`, `requestId`, `consumer`, `callbackGasLimit`) via `requestedHash[requestId] != keccak256(dataWithRound)`. Mais le premier argument, `randomness`, **n'est comparé à rien** : ni à une signature drand, ni à un engagement préalable, ni au round. Ligne 154, `derivedWord = keccak256(abi.encode(randomness, address(this), block.chainid, requestId))` : la séparation de domaine est correcte (anti-rejeu inter-chaînes/inter-requêtes) mais **elle ne contraint pas une entrée choisie par l'attaquant**.

**Préconditions** : contrôle de l'adresse `OPERATOR` immuable — l'infrastructure Gelato elle-même, une compromission du compte/de la task, ou toute rotation future de cette clé.

**Scénario** : le pool est gelé pendant qu'une requête est en vol (`withdrawListing` revert `WithdrawLocked`), donc la correspondance mot → listing est publiquement calculable au moment du fulfilment. L'opérateur itère `randomness = 0, 1, 2, …` jusqu'à ce que `keccak256(abi.encode(r, coordinator, 999, requestId)) % totalWeight` tombe dans la plage cumulative du listing visé. Pour un pool de 100 positions, ≈ 100 évaluations keccak — quelques microsecondes hors chaîne. Second levier : retenir la livraison au-delà de `wordDeadlineBlock` pour opposer un veto au tirage.

**Impact** : un acheteur complice acquiert systématiquement le NFT le mieux backé au prix plat dérivé de l'EV du pool, à chaque tirage. C'est un transfert direct de valeur des déposants vers l'opérateur. La détection *a posteriori* est possible (`RandomnessFulfilled` émet `gelatoRandomness` et `round`, recoupables contre drand quicknet) mais la prévention est nulle et le settlement irréversible.

**Correctif minimal** : ne pas expédier en mainnet un tirage dont la seule propriété d'intégrité est l'honnêteté de l'opérateur. Option préférée : vérifier la signature BLS drand **on-chain** dans `fulfillRandomness` (pairing BN254 contre la clé publique épinglée et `H(round)`), puis dériver le mot de `sha256(signature)` — dérivation que `DrandRelayCoordinator.sol:165` implémente déjà. Gelato peut rester le transport ; il ne doit pas rester la source de vérité. Si ce n'est pas fait avant le lancement, les contrôles compensatoires minimaux sont : (a) rendre la rotation d'opérateur réellement possible (cf. HWA-002), (b) borner la valeur à risque par unité de temps (plafond sur `weightedBackingTotal` ou sur les acquisitions par bloc), (c) énoncer explicitement la frontière de confiance dans l'UI et la doc.

**Test de non-régression** : `testOperatorCannotSelectListingByGrindingRandomness` — lister 3 NFT à 1/10/100 HYPE de backing, lancer une acquisition, boucler `randomness` jusqu'à viser le listing à 100, et asserter que le fulfilment est **rejeté** (après correctif) au lieu d'allouer le listing visé.

> **Note d'audit** : les deux sceptiques ont maintenu la sévérité critique. Le test existant `testFuzzWordsAreDomainSeparated` (`test/GelatoVRFCoordinator.t.sol:172`) fuzze précisément l'entrée opérateur et asserte la séparation de domaine — c'est-à-dire la propriété qui **ne protège pas** contre le grinding. Le test donne une fausse assurance.

### HWA-002 · CRITIQUE (un sceptique : medium) · contract-bug · Aucune expiration : une requête non servie soude FWA à son coordinateur pour toujours

**Fichier** : `src/hyperevm/GelatoVRFCoordinator.sol:44,129,147-158,180-183,206-213` (même forme dans `DrandRelayCoordinator.sol` et `PoPRandomnessAdapter.sol`)

**Préconditions** : une seule requête jamais servie — épuisement du Gas Tank, panne de task, revert persistant dans le callback, ou rétention délibérée par l'opérateur (gratuit et instantané pour la partie même qu'on veut pouvoir révoquer).

**Scénario** : `pendingRequestCount` est incrémenté ligne 129 et décrémenté en un seul endroit, ligne 158, dans un `fulfillRandomness` réussi. Il n'existe aucun chemin d'annulation, d'expiration ou de purge admin. Conséquence en chaîne : `FWA.reconcileUnfulfilledVrfCount()` appelle `pendingRequestExists()` qui reste `true` → revert `VrfRequestsPending()` définitif → `FWA.setAddr(VRF_COORDINATOR, …)` revert `AcquisitionStateLocked()` définitif. Or `OPERATOR` est `immutable`, donc changer l'opérateur **exige** un nouveau coordinateur.

**Impact** : verrouillage permanent du protocole sur un coordinateur, plus blocage définitif du solde natif du coordinateur. Surtout : **cela supprime le seul remède on-chain à HWA-001**. Un opérateur malveillant retient une requête à coût nul, devient irrévocable, puis manipule les tirages indéfiniment. Les NFT des déposants restent retirables (vérifié : `unsettledAcquisitionCount` retombe à 0 après expiration), donc c'est une destruction de protocole, pas un vol de NFT.

**Correctif minimal** : ajouter une expiration terminale permissionless aux trois coordinateurs :
```solidity
function expireRequest(uint256 requestId) external {
    Request storage r = requests[requestId];
    if (r.status != RequestStatus.Pending) revert UnknownRequest();
    if (block.number <= uint256(r.requestedAtBlock) + EXPIRY_BLOCKS) revert NotExpired();
    r.status = RequestStatus.Expired;
    requestedHash[requestId] = bytes32(0);
    pendingRequestCount -= 1;
    emit RequestExpired(requestId);
}
```
avec `EXPIRY_BLOCKS >= selectionTimeoutBlocks`, sans callback consommateur, et refus d'un `fulfillRandomness` tardif sur une requête expirée.

**Test** : `testAbandonedRequestCanBeExpiredAndCoordinatorMigrated` — acquérir, ne jamais servir, `vm.roll` au-delà, `expireRequest`, puis asserter dans l'ordre : `pendingRequestExists == false`, `reconcileUnfulfilledVrfCount() == 1`, `setAddr(VRF_COORDINATOR, newCoordinator)` réussit, `withdrawNative` réussit.

### HWA-003 · HAUT · contract-bug · La rotation de coordinateur brique définitivement les acquisitions

**Fichier** : `src/hyperevm/GelatoVRFCoordinator.sol:40-43,92-97,113` ; `FWA.sol:1377-1397`

`nextRequestId` est initialisé en dur à `1` (ligne 43), sans paramètre de constructeur. Après N acquisitions sur le coordinateur A, un coordinateur B fraîchement déployé renvoie `requestId = 1` ; `FWA.sol:1387` évalue `acquisitions[1].status != None` → `revert DuplicateRequestId()`. Le revert annule l'incrément de B : son compteur reste à 1, **définitivement**. `setConsumer` étant one-shot, on ne peut pas non plus faire avancer le compteur via un consommateur jetable.

**Impact** : une rotation d'opérateur — routinière ou d'urgence — se transforme en DoS permanent du chemin d'acquisition sur un core non-upgradeable. Le test de migration existant (`test/FWADrandRelayIntegration.t.sol:53-79`) **masque le défaut** : il change de coordinateur avant toute requête, donc l'ID 1 est encore libre.

**Correctif** : paramètre de constructeur `startRequestId` (ou `seedRequestId` owner-only avant `setConsumer`) exigé strictement supérieur au `nextRequestId` sortant ; ou dériver `requestId = uint256(keccak256(abi.encode(address(this), block.chainid, nonce)))` pour une unicité globale à la Chainlink.

### HWA-004 · HAUT (sceptiques : medium) · external-config · Le timeout de sélection Ethereum (30 blocs) part en mainnet

**Fichier** : `script/DeployHyperEVMMainnetCore.s.sol:94-99` ; `FWA.sol:264,1373`

`FWA.sol:264` initialise `selectionTimeoutBlocks = 30`, dimensionné pour des blocs Ethereum de 12 s. Sur HyperEVM (~1 s), cela fait **30 secondes**. `FWA_PARITY_MANIFEST.md` ligne 149 dit explicitement que la valeur doit devenir 360 ; `TESTNET_998_DEPLOYMENTS.md:145-156` documente que la première requête live sur 998 a été classée `TimedOut` pour cette raison exacte, puis la valeur relevée à 360. **Aucun script, vérifieur ou calldata Safe du chemin mainnet n'écrit `SELECTION_TIMEOUT_BLOCKS`** (grep exhaustif : le seul écrivain est `RetryTimedOutDrandGameplayE2E.s.sol:60`, verrouillé chain 998).

**Impact** : expirations en série au lancement. Le remboursement ne couvre que la fee de pool — la fee de service randomness, déjà transmise, n'est remboursée sur aucun chemin d'expiration.

**Nuance des sceptiques (retenue)** : cela échoue *fermé* (remboursement, NFT intact), et la réparation prend quelques minutes (`setBool` n'a pas le verrou `AcquisitionStateLocked` de `setUint`, donc on ferme les acquisitions, on draine la file avec `processAcquisitions` permissionless, puis `setUint` passe). Sévérité réelle : **medium**, mais à corriger avant lancement car cela casse la fonction produit principale.

**Correctif** : ajouter `fwa.setUint(FWAConfigKeys.SELECTION_TIMEOUT_BLOCKS, …)` dans `DeployHyperEVMMainnetCore.run()`, depuis une variable d'environnement obligatoire, et ajouter `fwa.selectionTimeoutBlocks() != expected` aux prédicats `InvalidWiring` de `ActivateHyperEVMMainnet` et `VerifyHyperEVMCore`.

### HWA-005 · HAUT (sceptiques : medium) · contract-bug · Le subgraph s'arrête au premier dépôt

**Fichier** : `indexer/subgraph.template.yaml:23-25` ; `indexer/src/mapping.ts:89-93`

`captureTokenURI()` appelle `ERC721.bind(...)` depuis la data source `FWA`, mais celle-ci ne déclare que `- name: FWA` dans ses `abis:`. graph-node résout le nom d'ABI **dans le contexte de la data source appelante** ; `ERC721` n'y est déclaré que sur la data source séparée `ERC721_0`. Le premier `NFTListed`/`ListingStaged` fait donc échouer le handler.

**Impact** : perte totale de l'indexeur dès le premier dépôt. Comme le frontend route `getUserPositions`, `acquisitionTickets`, `getActivity` et la grille du pool par l'indexeur quand `NEXT_PUBLIC_INDEXER_URL` est défini, le produit se lance avec un écran Positions vide, aucun reveal et une activité vide — **sans bannière d'alerte** (cf. HWA : `EnvBanner` n'avertit que sur `lagging`, jamais sur `down`).

**Correctif** : déclarer l'ABI ERC721 sur la data source FWA :
```yaml
      abis:
        - name: FWA
          file: ./abis/FWA.json
        - name: ERC721
          file: ./abis/ERC721.json
```
et découpler `mapping.ts` du module par collection généré (`../generated/ERC721_0/ERC721`) pour qu'un manifeste à zéro collection compile toujours.

### HWA-006 · HAUT · exploitation-risk · L'état de settlement critique est indexeur-only, sans repli on-chain

**Fichier** : `frontend/src/protocol/viem/ViemProtocolClient.ts:551-570, 753-754, 862-903`

`getUserPositions` dérive `deposited`, `allocated`, `depositedAllocated`, `settled`, `stuck` et `claimable.listingFees` **exclusivement** de l'indexeur, et `pendingAcquisitions` de `indexedAcquisitionTickets`. Les chemins d'énumération on-chain existent (lignes 525-537 et 755-805) mais sont morts dans cette configuration ; il n'y a ni recoupement, ni repli sur résultat vide, ni contrôle `hasIndexingErrors`.

**Mode dangereux** : une panne *dure* est sûre (throw `INDEXER_DOWN`, erreur visible). Le mode risqué est le **silencieux** — subgraph bloqué, élagué ou partiellement indexé — où « vide » est indistinguable de « rien à régler ». Un acheteur ayant payé le prix plein voit un portefeuille vide, ne règle pas dans sa fenêtre de 24 h, et se fait finaliser par défaut.

**Correctif** : (1) lire `_meta { block { number } hasIndexingErrors }` avec les données et lever `INDEXER_DOWN` si erreurs ou retard au-delà d'un seuil dur ; (2) recouper systématiquement les tickets contre la chaîne via `lastIssuedSequence`/`requestIdAtSequence` (le code existe déjà).

### HWA-007 · HAUT · external-config · Prix de lancement `$HWA` non validé, template 8 ordres de grandeur hors référence

**Fichier** : `.env.mainnet.example:61-62` ; `script/InitializeNestMarket.s.sol:26-45` ; `script/LaunchNestMarket.s.sol:37-71`

`FWA_INITIAL_SQRT_PRICE_X96 = 79228162514264337593543950336` est exactement `2^96`, soit un prix de départ de **1 FWA = 1 wHYPE**, une FDV de 1 000 000 000 HYPE. Le déploiement Ethereum vérifié a lancé à 40 000 000 FWA par ETH (≈ 25 ETH de FDV). Contrairement à tous les autres champs sensibles, cette valeur est **pré-remplie** dans le template. Et les deux scripts irréversibles (`InitializeNestMarket`, `LaunchNestMarket`) sont les seuls du parcours Nest **sans gate dédié** — ni `FWA_TOKENOMICS_CONFIRMED`, ni `NEST_ADMIN_ACTIONS_CONFIRMED`.

**Impact** : une valeur non éditée fixe définitivement le prix du pool canonique et verrouille 500 M FWA (50 % de la supply) dans une position inutilisable, sans recours on-chain (`FWANestLiquidityLocker` n'a ni transfert ni `decreaseLiquidity`, `finalizeLaunch` revert `AlreadyLaunched`, la factory Algebra garde un pool par paire).

**Correctif** : (1) vider la valeur du template comme tous les autres champs ; (2) exiger `FWA_TOKENOMICS_CONFIRMED` dans les deux scripts, plus des gates dédiés `NEST_MARKET_PRICE_CONFIRMED` / `NEST_LP_LOCK_CONFIRMED` ; (3) ajouter des bornes de FDV explicites dans les scripts ; (4) ajouter l'allowlist positive de chain-id (ces deux scripts n'en ont aucune).

### HWA-008 · HAUT · exploitation-risk · L'admin Nest peut briquer définitivement le marché et piéger la réserve HYPE

**Fichier** : `src/hyperevm/FWATokenNest.sol:431-437` (`_assertLivePoolConfiguration`), 178-202, 204-219

C'est le revers exact de la bonne propriété fail-closed. `_assertLivePoolConfiguration` compare à des **constantes** (`POOL_FEE=10000`, `POOL_TICK_SPACING=60`, `REQUIRED_COMMUNITY_FEE=0`, `REQUIRED_PLUGIN_CONFIG`). Si Nest — un tiers — exécute une maintenance de routine (`setCommunityFee(1000)`, `setTickSpacing`, `setFee`, `setPlugin`), alors **tout** transfert touchant le pool revert définitivement : plus aucun achat ni vente de `$HWA`, `collectFees()` bloqué, et `buyback()` bloqué — or le token n'a **aucune fonction de retrait HYPE**, donc la réserve de buyback est piégée pour toujours.

Le pool FWA est configuré pour verser à Nest une community fee **nulle** : l'incitation économique à restaurer leur défaut existe. La référence Ethereum ne porte pas ce risque (clé de pool et hook Uniswap v4 immuables).

**Correctif** : garder le revert dur uniquement sur les deux paramètres qui portent réellement le verrou (`pool.plugin() == plugin` et `pluginConfig == REQUIRED_PLUGIN_CONFIG`), et déplacer `fee`/`tickSpacing`/`communityFee` vers des valeurs attendues modifiables par l'owner via un `setExpectedPoolEconomics(...)` événementiel derrière le Safe. Ajouter un chemin de sauvetage HYPE sur le token.

**Question ouverte à trancher avec Nest** : engagement contractuel (timelock/gouvernance/accord signé) de gel de `plugin`, `pluginConfig`, `fee`, `tickSpacing` et `communityFee` sur le pool HWA/wHYPE.

---

## 3. Écarts de séquencement de release (à corriger, non bloquants au sens contrat)

| ID | Sévérité | Constat | Correctif |
|---|---|---|---|
| HWA-009 | haut→medium | `activationBatch` peut ouvrir les acquisitions **avant** `FWA.setRewards`, qui est one-shot et exige un pool vide → 300 M FWA d'émissions définitivement inaccessibles | `PrepareMainnetOwnerActions.ps1` doit prendre un `-RpcUrl` obligatoire et refuser d'émettre `activationBatch` tant que `fwa.rewards()` est nul |
| HWA-010 | haut→medium | **Propriété fail-open** : seul `DeployHyperEVMMainnetCore` utilise `vm.envAddress("FWA_OWNER")` ; tous les autres scripts utilisent `vm.envOr("FWA_OWNER", deployer)`. Si la variable est absente, le token Nest, le locker LP, l'adapter, les rewards et le Splitter appartiennent au **wallet déployeur chaud**, qui peut alors ouvrir le trading public et exempter des adresses du verrou de transfert. Aggravant : `VerifyNestModules.s.sol` n'atteste **jamais** `token.owner()`, `rewards.owner()` ni `locker.owner()` — il ne compare que `splitter.owner()` à `fwa.owner()` | Remplacer par `vm.envAddress` partout ; ajouter les assertions d'owner Nest à `VerifyNestModules` |
| HWA-011 | medium | 8 scripts mutants n'ont **aucune allowlist positive de chain-id** | Ajouter `require(block.chainid == 998 \|\| block.chainid == 999)` |
| HWA-012 | medium | `WriteMainnetManifest` émet `"links": null` sur la configuration par défaut, que le frontend consomme | Émettre un objet vide ou omettre la clé |
| HWA-013 | haut→low | L'activation démarre irréversiblement l'émission de 15 jours sans attester que `depositorRatePerSec`/`purchaserDailyPot` sont configurés ni que les 300 M FWA sont provisionnés | Ajouter ces quatre assertions au bloc `InvalidWiring` d'activation et à `VerifyNestModules` |

**Mes propres constats de processus** (hors workflow, vérifiés de première main) :

- **La gate de release n'est pas auto-descriptive.** `TestReleaseCandidate.ps1` n'enregistre pas les switches utilisés : un rapport `status: passed` peut avoir sauté le fork Nest et les E2E (`-SkipFork`/`-SkipE2E`), alors que le runbook §3 dit de ne poursuivre que sur ce `passed`. Corriger : sérialiser les paramètres d'invocation dans le rapport.
- **`broadcastPerformed: false` est une constante littérale** (ligne 96), pas une mesure. Le handoff la présente comme preuve qu'aucune transaction n'a été diffusée. Corriger : dériver le champ des logs Foundry, ou renommer en `broadcastRequested`.
- **La gate ne vérifie que des codes de sortie.** Les compteurs attendus (91 Solidity / 46 Vitest / 32 Playwright) ne sont asserés nulle part ; une perte de couverture silencieuse passerait. *J'ai vérifié qu'ils sont actuellement exacts : 91 fonctions de test Solidity, 46 Vitest exécutés, 32 parcours Playwright listés.*
- **Aucun test d'invariant stateful.** `foundry.toml` déclare `[profile.default.invariant] runs=256 depth=64 fail_on_revert=true` et `FWA_PARITY_MANIFEST.md` §12 liste les invariants comme bloquants. En pratique : 4 tests fuzz *stateless* et **zéro** `invariant_*` sur le périmètre HWA (les seuls du dépôt appartiennent au projet memecoin abandonné). La propriété de solvabilité n°1 du système n'est vérifiée par aucune machine. **C'est la lacune de vérification la plus importante du dossier** — à combler avant mainnet, d'autant que l'auditeur core a tracé cette conservation à la main et l'a trouvée correcte : un handler d'invariant la figerait.
- **Asymétrie de contrôle sur `finalOwner`** : `DeployHyperEVMMainnetCore` vérifie `operator.code.length` et `splitter.code.length`, mais **pas** `finalOwner.code.length`. Or un Safe a du code, et une faute de frappe sur l'owner est irréversible sur des contrats non-upgradeables. Ajouter la vérification, ou utiliser le handover 2-étapes que Solady `Ownable` fournit déjà.
- **`TestReleaseScripts.ps1` ne teste que le chemin heureux** de la promotion : il appelle `PromoteMainnetManifest.ps1` avec les cinq `-Confirm*` et vérifie que ça promeut, jamais que ça **refuse** sans. Le refus *est* implémenté (vérifié ligne 12-14), mais non testé — un refactor pourrait le retirer silencieusement.

---

## 4. Assurance — ce qui a été vérifié et trouvé correct

Ces points sont établis par lecture intégrale et, quand indiqué, par exécution.

**Core FWA**
- **Parité bytecode exacte** : rebuild avec solc 0.8.30, optimizer runs=1, via-IR, evm_version=cancun, puis comparaison octet à octet avec la référence Ethereum vérifiée. Meilleur que ce que le projet revendique.
- **Conservation des passifs natifs** tenue sur tous les chemins tracés : `balance >= Σ(listing.value) + acquisitionEscrowTotal + acquisitionRefundCreditTotal + feeCredit + accruedOwnerFees + topListingPot`.
- Arrondis de dividendes **monotones en faveur du protocole** (`_distribute` et `_pendingFees` planchent).
- Intégrité de l'arbre de sommes : `treeRootWeight() == totalWeight` maintenu par mises à jour appariées.
- **Anti-steering intact** : les dépôts pendant une requête en vol sont `Staged` et exclus de tous les totaux du pool.
- **ERC-721 hostile** ne peut ni bloquer le settlement d'autrui ni piéger du HYPE : aucun mouvement NFT dans `processAcquisitions`, `try/catch` sur `_deliverNFT`, `forceSafeTransferETH` (stipend 100 k + repli SELFDESTRUCT) sur chaque sortie native.
- `setRewards` réellement one-shot et auto-défendu (vérifie `r.fwa() == address(this)` et `r.token() != 0`).

**Randomness (hors les deux critiques)**
- Liaison de payload exacte et canonique ; anti-rejeu correct (statut basculé et hash purgé **avant** l'appel externe) ; séparation inter-requêtes/inter-chaînes/inter-redéploiements ; atomicité du retry ; livraison hors-ordre sûre ; conformité d'interface exacte avec la référence vérifiée.

**Splitter**
- Transposition **ligne à ligne** équivalente à la référence ; 4 dépendances solady **byte-identiques** (`diff -q`).
- Double-claim par transfert **impossible** (checkpoint par tokenId, pas par adresse) ; ids dupliqués inoffensifs ; arrondis non manipulables et sans dust bloqué ; détenteur hostile incapable de bloquer autrui ; réentrance fermée.

**Marché Nest**
- **LP principal réellement irrécupérable** : ni `decreaseLiquidity`, ni transfert NFT, ni `call` générique.
- **Le token applique lui-même l'état fermé** : retirer ou remplacer le plugin n'ouvre **pas** le marché (c'est précisément ce qui cause HWA-008 — la propriété est correcte, sa rigidité est le problème).
- Initialisation du pool non front-runnable une fois le plugin attaché ; états intermédiaires des deux passes admin **inertes** ; liquidité additionnelle impossible après lancement ; exact-output refusé ; l'adapter ne peut pas payer un destinataire arbitraire ; arithmétique de buyback exacte et sans dust ; range single-sided appliqué on-chain.

**Rewards**
- `FWARewardsHyperEVM.sol` **byte-identique** à la référence Ethereum sauf le chemin de swap (diff complet).
- Conservation de supply assertée on-chain par le script ; budget d'émission conforme à la référence live ; accumulateur √backing **non manipulable** par repricing/relist/dépôt-éclair ; époques acheteur non double-comptées ; `settleAcquisition`/`refundAcquisition` sans appel externe, donc le processeur ordonné du core ne peut pas être briqué.

**Frontend**
- **Chaque écriture est autorisée on-chain, pas par l'indexeur** : les 15 méthodes d'écriture tracées relisent la valeur faisant foi juste avant signature ; `acquire()` recalcule les gardes on-chain.
- Mauvais réseau, manifeste absent/invalide/mauvais chainId, env malformé : **tous fail-closed** au niveau client, pas seulement UI.
- **Inversion de prix Algebra correcte dans les deux ordres de tokens.**
- **Aucun secret serveur atteignable par le navigateur** (grep exhaustif de `process.env`).
- Logique d'allowlist du proxy metadata **saine**, sondée directement : `userinfo@`, suffixes de sous-domaine, ports et schémas non-HTTP rejetés.

**Indexeur**
- Aucune surface de mutation, aucun privilège ; parité de signature des 25 événements vérifiée programmatiquement ; décodage des statuts conforme aux enums ; ordonnancement des états terminaux sûr ; comptabilité `totalBacking`/`stagedListingCount` équilibrée sur le cycle complet ; ids d'entités stables et idempotents face aux reorgs.

**Release**
- `DeployHyperEVMMainnetCore` : chain 999 dur, flags stricts, rejet d'owner nul / opérateur sans bytecode / splitter non possédé par l'owner final, acquisitions jamais ouvertes, 4 contrats transférés à l'owner final.
- `ActivateHyperEVMMainnet` : chain 999 + **six** attestations `envBool` indépendantes.
- `PromoteMainnetManifest.ps1` **verrouille réellement** ses cinq confirmations (comportement `[switch]` vérifié en PowerShell 5.1), plus contrôles machine (chainId, randomnessMode, dexMode, collections non vides, `deploymentBlock > 0`).
- Adresses Nest de `.env.mainnet.example` **identiques** aux constantes Solidity (vérifié).

---

## 5. Questions ouvertes à trancher avant lancement

1. **Le `msg.sender` dédié Gelato sur 999 est-il un contrat OpsProxy ou un EOA ?** `DeployHyperEVMMainnetCore:64` et `VerifyGelatoVRFCoordinator` exigent `code.length != 0` — si Gelato fournit un EOA, le déploiement mainnet **revert**.
2. **Gelato peut-il faire tourner ce dedicated sender ?** Si oui, HWA-003 (collision d'IDs) devient un chemin certain, pas hypothétique.
3. **Quelle est la latence Gelato mesurée sur 999, en blocs ?** C'est ce nombre, pas le 30 d'Ethereum, qui doit fixer `SELECTION_TIMEOUT_BLOCKS`.
4. **Nest s'engage-t-il à geler `plugin`/`pluginConfig`/`fee`/`tickSpacing`/`communityFee` sur le pool FWA ?** Sans cet engagement, HWA-008 reste un kill switch détenu par un tiers.
5. **Quel est le `FWA_INITIAL_SQRT_PRICE_X96` réellement voulu, et la FDV cible ?**
6. **L'owner final sur 999 est-il un Safe ou un EOA contrôlé ?** Les deux chemins d'activation ont des forces de gate très différentes.
7. **Quel contrat sera `FWA_SPLITTER_SNAPSHOT_NFT` ?** Il doit exposer `getCurrentSupply()` et `burnedTokenCount()`, non standard.
8. **Le subgraph a-t-il déjà indexé 998 avec succès ?** HWA-005 prédit un arrêt au premier dépôt : si une instance 998 tourne avec des dépôts, cela contredit le constat et il faut le rejouer.
9. **`release-gate-last-run.json` a-t-il été produit avec `-CleanInstall -VerifyLiveTestnet` ?** Le rapport ne l'enregistre pas.

---

## 6. Plan de remédiation proposé

**Palier 1 — bloquant absolu**
1. HWA-001 : vérification BLS drand on-chain, ou décision explicite et documentée d'accepter une randomness de confiance avec plafonnement de la valeur à risque.
2. HWA-002 : `expireRequest` permissionless sur les trois coordinateurs.
3. HWA-003 : `startRequestId` paramétrable.

**Palier 2 — avant broadcast**
4. HWA-004 `SELECTION_TIMEOUT_BLOCKS` écrit et attesté · HWA-007 prix de lancement (template vidé + gates dédiés) · HWA-010 `vm.envAddress` partout + attestations d'owner Nest · HWA-009 `PrepareMainnetOwnerActions` conditionné à l'état on-chain · HWA-013 attestations d'émission.
5. **Ajouter les tests d'invariants stateful** de `FWA_PARITY_MANIFEST.md` §12 — au minimum la conservation des passifs natifs et « aucun double claim ».

**Palier 3 — avant ouverture publique**
6. HWA-005 ABI ERC721 sur la data source FWA · HWA-006 `_meta`/`hasIndexingErrors` + recoupement on-chain des tickets · HWA-008 config de pool attendue modifiable + sauvetage HYPE · HWA-011/012 · durcissement de la gate de release (switches sérialisés, `broadcastPerformed` mesuré, compteurs de tests assertés).

**Palier 4 — recommandé**
7. Les 35 constats `low` et 8 `info` du JSON, notamment : CSP `script-src 'unsafe-inline'` et absence de HSTS, `EnvBanner` muet sur `indexer down`, `withdrawListing` désactivé par le manifeste read-only d'urgence (le contraire du §8 du runbook), timeouts de polling rapportés comme `reverted`.

---

*Rapport produit sans modifier aucun fichier du bundle audité et sans diffuser aucune transaction. Les 86 constats détaillés, avec leurs notes de réfutation, sont dans `release/audit-findings-2026-07-26.json`.*
