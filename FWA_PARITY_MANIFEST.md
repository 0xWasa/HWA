# FWA → HyperEVM — manifeste de parité

**Statut : Phase 0 forensic, spécification initiale non figée**  
**Capture Ethereum : blocs `0x186c50a` à `0x186c524`, 2026-07-25 UTC**  
**Cible initiale : HyperEVM testnet, chain ID `998`**

## 1. Règle de vérité et périmètre

Ce manifeste décrit le comportement du déploiement FWA observable sur Ethereum et son équivalent attendu sur HyperEVM. L'ancien projet de bags de memecoins est entièrement hors périmètre. Ses contrats, documents et simulations ne constituent pas une base produit. L'archive `archives/MEMEBAG_TOKEN_FORK_2026-07-25.zip` reste préservée.

Ordre de confiance appliqué :

1. bytecode, stockage, appels et événements des contrats déployés ;
2. sources Etherscan vérifiées « Exact Match » ;
3. documentation officielle FWA ;
4. frontend FWA vivant ;
5. pour la cible, documentation Hyperliquid et dépendances officielles.

Une valeur on-chain courante prévaut sur une valeur de documentation de lancement. Une adaptation n'est jamais qualifiée d'exacte si elle modifie le hasard, l'économie, les droits, les fenêtres, les rewards ou le settlement.

Adaptations autorisées sans arbitrage produit :

- ETH natif devient HYPE natif, toujours avec 18 décimales ;
- les adresses Ethereum deviennent les adresses de déploiement HyperEVM ;
- seules des collections ERC-721 HyperEVM vérifiées peuvent être admises ;
- les détails d'infrastructure strictement imposés par HyperEVM peuvent changer à comportement utilisateur et sécurité équivalents.

Tout le juridique est hors périmètre.

## 2. Environnement HyperEVM vérifié

| Réseau | Chain ID | RPC officiel | Actif natif | EVM |
|---|---:|---|---|---|
| HyperEVM testnet | `998` (`0x3e6`, confirmé par RPC) | `https://rpc.hyperliquid-testnet.xyz/evm` | HYPE, 18 décimales | Cancun sans blobs |
| HyperEVM mainnet | `999` (`0x3e7`, confirmé par RPC) | `https://rpc.hyperliquid.xyz/evm` | HYPE, 18 décimales | Cancun sans blobs |

Contraintes d'exploitation à conserver dans l'architecture : blocs rapides d'environ 1 seconde avec limite 2 M gas, blocs lourds d'environ 1 minute avec limite 30 M gas, fenêtre de nonce des huit prochaines valeurs et purge des transactions de mempool après un jour. Le RPC officiel ne conserve que l'état récent, limite `eth_getLogs` à 50 blocs et quatre topics, et ne fournit pas de websocket. La production exigera donc un RPC archival séparé, un indexeur événementiel avec checkpoints, relecture idempotente et surveillance des bots permissionless.

Sources primaires : [HyperEVM](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/hyperevm), [JSON-RPC](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/hyperevm/json-rpc), [Dual-block architecture](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/hyperevm/dual-block-architecture).

## 3. Inventaire Ethereum vérifié

Les adresses concordent toutes avec la [page officielle des déploiements FWA](https://www.fwa.fun/docs/deployments). Les huit contrats sont directs, non-proxy : les trois slots EIP-1967 testés sont nuls. Ils partagent le créateur `0x019817ad02a31b990433542097be29d97613e8cb` et ont été compilés avec Solidity `0.8.30`, optimiseur `1` run, cible `prague`. Les sources brutes, ABIs, constructor arguments et bytecodes sont conservés dans `FWA_ETHEREUM_REFERENCE/`.

| Contrat | Adresse Ethereum | Classe | Rôle | Keccak-256 du runtime |
|---|---|---|---|---|
| FWA | `0xB276F62DB0ce8CA2Ca5bc522695bE604521eAc1c` | `core` | custody ERC-721, backing, arbre de poids, acquisition ordonnée, settlement, frais | `0xa53298a411a9ce5b5d352c45e3aaa90fac78632d21e7b928425cf6eb11ab8cc4` |
| FWARewards | `0x6a1a1C0CfB3D3C538e13D36d608a5bcaa992fc78` | `rewards` | émissions déposants/acheteurs, epochs hot/cold, achats de token | `0xf638c9e341efecf99bd093cff9b780bb3f7bf03bbd814b80c092d7e3361b4555` |
| FWAVRFService | `0xa084c33Fb7a467307452898b8D58165ebd2E5D9f` | `infrastructure` | couverture et remboursement du coût Chainlink VRF, traitement permissionless | `0x8ab6e6d4ca28ade13f80314ccd54b3a648734ee88a5bcd807711fe5ae037f4a4` |
| FWAToken | `0xa0Df17B5aC76ABaBA36E1450E2cbCd18A620C845` | `rewards` | ERC-20 FWA, pool, contraintes de transfert, buyback et routage | `0xd07b0280e4e25689956cff42290d843739714308e6fbe693017cede05c2c52fd` |
| FWATokenHook | `0x2C67ebA8A50AF0dB5Fba55F725247a75CbDA6444` | `rewards` + `infrastructure` | hook Uniswap v4, taxe 1 % dans les deux sens, gating des achats | `0x5eeafce23c30462750069d6313286eca9587da8ecffdff880288d31b75d41df0` |
| FWAClaim | `0xd4085d38855F17EdF0B1CCBFad7B3846fb305655` | `legacy migration` | claim Merkle de l'allocation v1 | `0x2bcc7652822828e6672fe46b9f2330ea71bad315f2df8e740605e0e0fff89f0d` |
| FWAWhitelist | `0x854352b275cF6A0DfFCf2983C986FBe9345e17c3` | `infrastructure` | administration de l'allowlist et chemin burn TTT | `0x0472057b43e7cc323bc058a785b861b2ee8d3c5956cd2de5b32e2af37447976a` |
| Splitter | `0x1C175b9F0e8C73eD3e677e1cBb1B5A2DD4373Bfe` | `launch-only` + `infrastructure` | partage des revenus entre owners et détenteurs d'un snapshot NFT | `0x10d57a933c83f60e2ff54eb1c7b64ab1c34278f34c4809ac6ae4e7e2accb2ce0` |

## 4. État économique courant observé

Les valeurs ci-dessous sont des données de capture, pas des defaults à copier aveuglément. La specification figée devra distinguer les paramètres de comportement, qui restent identiques, et les données de saison, qui sont réinitialisées.

| Paramètre | Valeur Ethereum observée | Parité HyperEVM attendue |
|---|---:|---|
| Backing minimum | `0.01 ETH` | `0.1 HYPE`, plancher technique HyperEVM ajustable par l'owner ; ce n'est pas un floor NFT |
| Surcharge acquisition | `1 000 bps` | identique |
| Slippage de sélection positif/default négatif | `1 000 bps` | identique |
| Paiement du bid au purchaser | `8 500 bps` du backing | identique |
| Fenêtre exclusive purchaser | `86 400 s` | identique en secondes |
| Finalisation permissionless | `604 800 s` | identique en secondes |
| Cut owner sur acquisition | `100 bps` de la part déposants après tranche rewards | identique |
| Cut owner sur keep/relist | `100 bps` du backing | identique |
| Pénalité accept-bid | `15 %`, actuellement `retainedToProtocol=true` | identique |
| Confirmations de hasard | `3` | objectif de sécurité à reproduire, mapping fournisseur à valider |
| Timeout de sélection | `30` blocs Ethereum | ne pas copier mécaniquement : durée et garantie à RFC en raison des blocs HyperEVM |
| Callback gas | `900 000` | à calibrer sur testnet sans changer le callback minimal |
| Activations réservées/acquisition | `6` | identique |
| Tithe « crown » | **`100 bps` courant** | `100 bps` si le fork vise l'état vivant |
| Seuil de remplacement crown | `1 000 bps` | identique |
| Allowliste | activée ; 48 collections autorisées reconstruites par logs | nouvelle liste HyperEVM courte, validée séparément |
| Acquisitions | activées | activées seulement après configuration complète/testnet |
| Récompenses déposants | `115.740740740740740740 FWA/s`, 15 jours | même courbe si l'allocation de supply est retenue |
| Reward purchaser | pot journalier `10 000 000 FWA` | identique si l'allocation de supply est retenue |
| Gaps reward | hot `60 s`, cold `3 600 s` | identiques |
| Token | 1 milliard HWA, 18 décimales | supply identique ; `Hyper World Assets` / `HWA` figés |
| Routage buyback | 40 % déposants / 40 % purchasers / 20 % burn | identique |
| Bounty buyback | `50 bps` | identique |
| Frais de trading | 1 % achat et 1 % vente via hook | Project X V3, tier LP statique 1 % ; nominal conservé mais mécanique LP non exacte |

Écart documentaire notable : la [documentation Top Listing Reward](https://www.fwa.fun/docs/rewards/top-reward) décrit le lancement à 5 %, mais `ConfigSet` au bloc `25592190`, la vue `topListingShareBps()` et le frontend courant convergent vers **1 %**. La référence active est donc 1 %, avec 5 % conservé comme historique. De même, la documentation décrit [16 collections au lancement](https://www.fwa.fun/docs/collections), alors que les événements reconstruisent 48 collections courantes. Les adresses et états complets sont dans `FWA_ETHEREUM_REFERENCE/FWA/state-events.json`.

## 5. Machines d'état reconstruites

### Listing et custody

`listNFT` vérifie la collection et le backing, transfère l'ERC-721 en custody, fige les champs économiques, puis active ou met en staging. Une acquisition en vol réserve un batch FIFO de listings stagés avant l'appel externe de randomness ; ces listings ne peuvent donc pas être ajoutés après observation du mot aléatoire. Chaque listing actif possède un slot dans un arbre de sommes, une part de frais plate et un checkpoint rewards.

États fonctionnels : `None → Staged → Active → Allocated → Settled`, avec retrait possible depuis `Staged` ou `Active` si les sorties ne sont pas verrouillées. L'activation, la suppression du slot, les totaux de poids et les dettes de frais doivent rester atomiques.

### Poids, prix et sélection

Pour un backing `b`, le poids est `WAD² / b`, soit `1e36 / b`. La probabilité d'un listing est `weight / totalWeight`. Sa contribution à `weightedBackingTotal` est `backing × weight`. L'expected value du pool est :

```text
EV = weightedBackingTotal / totalWeight
prix_pool = EV × (10_000 + surchargeBps) / 10_000
prix_total = prix_pool + coût_service_randomness
```

La sélection utilise `randomWord % totalWeight` puis descend l'arbre de sommes. Les arrondis entiers, l'ordre des mutations et les limites de capacité sont des éléments de parité, pas des détails d'implémentation.

### Acquisition concurrente et hasard

Chaque demande reçoit une séquence locale monotone, un batch de listings réservés, un deadline de mot et des tolérances de drift figées. Les callbacks peuvent arriver hors ordre : ils ne font qu'authentifier et mettre le mot en cache. `processAcquisitions(maxCount)` traite ensuite permissionlessly les séquences dans l'ordre canonique. Un mot absent après deadline produit une expiration/refund ; un pool vide ou un drift hors tolérance produit un pull-refund. Un callback dupliqué, tardif ou inconnu est ignoré ou rejeté selon l'état sans double settlement.

La fee d'acquisition reste en escrow jusqu'au traitement. Le coût du fournisseur de hasard est séparé et payé avant la requête. La surcharge rewards est enregistrée au request-time ; dans un batch, seule la première acquisition peut toucher le bonus cold-gap.

### Frais et crown

Après extraction de la tranche rewards et du cut owner de 1 %, le reliquat est distribué à parts égales entre listings actifs, pas au prorata du backing. Lorsqu'un crown existe, 1 % courant de ce reliquat alimente son pot et le reste est distribué. Un nouveau listing doit battre le backing du crown de 10 %. La sortie/allocation du crown crédite tout son pot une seule fois.

### Settlement

Une allocation offre au purchaser :

- `keepNFT` : NFT au purchaser, backing au depositor moins 1 % owner ;
- `relistNFT` : même paiement au depositor puis création d'un nouveau listing en custody avec nouveau backing ;
- `acceptDepositorBid` : 85 % du backing au purchaser, NFT au depositor, 15 % au protocole ;
- `acceptBidAsTokens` : même économie, mais les 85 % achètent du FWA via le module rewards avec `minOut`.

Après 24 h, le depositor peut choisir l'équivalent économique de keep ou accept-bid. Après 7 jours, n'importe qui finalise par défaut vers NFT au purchaser et backing net au depositor. Les transferts NFT de chemins non stricts sont best-effort : un échec enregistre un destinataire `stuckNFTRecipient` qui peut réessayer sans rebloquer le règlement HYPE.

### Rewards, token, marché secondaire

La supply observée est `1_000_000_000 FWA` à 18 décimales : 50 % seed LP, 30 % émissions sur 15 jours, 20 % migration v1 via Merkle claim. `FWARewards` checkpoint les positions sur la racine du backing, attribue les rewards purchasers via epochs hot/cold et achète du FWA dans le pool pour les settlements token.

Le pool Ethereum est natif ETH/FWA sur Uniswap v4 : fee LP `0`, tick spacing `60`, hook FWA. Le hook prélève 1 % dans les deux directions, autorise les callbacks `beforeInitialize`, `afterAddLiquidity`, `afterSwap` et `afterSwapReturnDelta`, refuse exact-output, garde les achats externes désactivés et reconnaît `FWARewards` comme pool autorisé. Les transferts FWA sont contraints par une allowance interne augmentée par le hook. Les buybacks sont permissionless, espacés d'au moins un bloc, récompensent l'appelant à 0,5 %, puis routent 40/40/20.

**Décision produit révisée du 2026-07-26 : la cible principale est Project X V3.** Le port retient le tier AMM statique de 1 %, le tick spacing `200`, une position single-sided dont le NFT LP est envoyé atomiquement à un locker sans chemin de retrait du principal, et un gate ERC-20 owner-controlled pour ouvrir ou fermer les achats publics. Project X étant un V3 standard sans hook spécifique, exact-output et l'ajout de liquidité tiers ne peuvent pas être interdits après ouverture. Le fee est collecté par les LP et la factory Project X peut fixer une part protocolaire ; aucun transfert-tax ERC-20 caché n'est introduit. Chain 998 utilise HyperSwap V3 uniquement comme venue ABI-compatible, jamais comme preuve d'un déploiement officiel Project X testnet.

## 6. Matrice de parité obligatoire

| Composant | Ethereum source | Comportement exact | Dépendance Ethereum | Équivalent HyperEVM | Divergence | Risque | Décision requise | Test de parité |
|---|---|---|---|---|---|---|---|---|
| Custody ERC-721 et collections | `FWA.sol`, `FWAWhitelist.sol` | Transfert en custody, statut staged/active, livraison stricte ou best-effort, recovery stuck NFT | Collections Ethereum ; TTT pour le burn path | ERC-721 HyperEVM vérifiés ; même custody et machine d'état | Adresses, univers de collections et éventuellement TTT changent | NFT hostile, reentrancy, transfert non standard, faux ERC-721 | Allowlist initiale et maintien/suppression explicite du chemin TTT | Collections conformes et hostiles ; aucun double transfert ; stuck/retry ; invariants custody |
| Backing natif | `FWA.sol` | Passifs isolés : backing, escrows, refunds, earnings, owner fees ; transferts ETH forcés | ETH | HYPE natif 18 décimales | Substitution imposée ETH→HYPE | Insolvabilité ou HYPE bloqué chez un receveur | Aucune pour la substitution | Invariant solde ≥ somme des passifs ; receveurs qui revert ; force-send |
| Poids et sélection | `FWA.sol` | `1e36/backing`, arbre de sommes, cible `word % totalWeight`, arrondis exacts | Aucune hors EVM | Copie logique recompilée Cancun | Aucune attendue | Biais, overflow, slot corrompu | Aucune | Différentiel Ethereum ; fuzz somme racine ; distribution statistique ; golden words |
| Pricing et surcharge | `FWA.sol` | Harmonic mean `weightedBackingTotal/totalWeight`, surcharge 1000 bps, guards maxFee/minValue/drift | ETH comme unité | Même calcul en wei HYPE | Unité native seulement | Mauvais arrondi ou repricing concurrent | Aucune | Vecteurs exacts, limites, mutations avant mine et avant settlement |
| Demandes simultanées | `FWA.sol` | Séquences FIFO, batch staged réservé, callbacks cachés hors ordre, traitement permissionless ordonné | Chainlink request IDs/callback | Adaptateur randomness avec IDs uniques et même file canonique | API fournisseur nécessairement différente | Manipulation, blocage head-of-line, double fulfilment | Choix du fournisseur après preuve testnet | Callbacks hors ordre/dupliqués/tardifs/invalides ; N requêtes en vol ; timeout |
| Randomness | `FWA.sol`, `FWAVRFService.sol` | VRF 2.5 native payment, 3 confirmations, callback auth minimal, fee service/couverture | Chainlink VRF 2.5 Ethereum | 998 : relay evmnet historique sans valeur ; 999 : `DrandEvmnetRegistry` + `DrandBN254Coordinator`, signature evmnet vérifiée on-chain | Fournisseur/coût différents ; submitters permissionless au lieu d'un coordinator Chainlink | Audit du verifier BN254 vendored ; disponibilité des submitters et réserve | **Implémenté : drand BN254 vérifié on-chain obligatoire en production** | Preuve officielle/altérée ; confirmations ; round futur/stale ; replay ; expiry ; retry ; collision IDs ; lifecycle FWA complet |
| Frais déposants/protocole | `FWA.sol` | Slice rewards, cut acquisition 1 %, partage égal/listing, crown 1 %, owner settlement 1 %, penalty 15 % | ETH/payout Splitter | Même comptabilité en HYPE ; payout vers `SplitterHyperEVM` | Adresse de collection snapshot configurable au constructeur | Perte de passif, double claim, DoS recipient | Collection/owners à renseigner avant le snapshot | Accounting différentiel ; somme distribuée ; pull claims ; receveur hostile |
| Settlement et fenêtres | `FWA.sol` | 4 choix purchaser, 2 choix depositor après 24 h, finalize après 7 j, 85/15 | ETH et buyFor Uniswap v4 | Même machine en HYPE ; `buyFor` via adapter Project X V3 exact-input ; timeout sélection 360 blocs sur 998 | Router, pool fee et slippage diffèrent ; 30 blocs Ethereum deviennent 360 blocs HyperEVM pour conserver environ six minutes | Settlement token indisponible, mauvais recipient, slippage insuffisant ou callback prématurément expiré | Adapter et pool testés avant activation du chemin token | Golden traces de tous les chemins, bornes temporelles et quotes V3 ; timeout 30 puis retry 360 live |
| Retraits et sûreté | `FWA.sol` | Withdraw staged/active, pull refunds/earnings, withdraw-only, acquisitions disable, sortie protégée pendant états sensibles | Aucune hors transfert natif | Identique | Aucune attendue | Blocage d'actifs ou sortie pendant réservation | Aucune | Pause/withdraw-only, requêtes pendantes, refus HYPE/NFT, invariants passifs |
| Whitelist | `FWA.sol`, `FWAWhitelist.sol` | Contrôle uniquement nouvelles listes/relist ; positions existantes inchangées ; blocklist burn | TTT Ethereum et collections Ethereum | Manager HyperEVM ; allowlist locale ; caps off-chain/on-chain à spécifier | Collections et éventuel jeton d'accès changent | Collection malveillante ou illiquide | Validation de la courte allowlist ; choix TTT | Ajout/retrait/block ; existants inchangés ; transfert hostile |
| FWA, émissions et rewards | `FWAToken.sol`, `FWARewards.sol`, `FWAClaim.sol` | Supply 1 Md, 50/30/20, 15 jours, sqrt backing, epochs journaliers ; hot/cold module la slice d'achat FWA | Snapshot v1 Ethereum ; Uniswap v4 | Même supply et comptabilité ; nouvelle saison sans historique ; achats via Project X | 20 % v1 n'a pas d'équivalent naturel ; route DEX différente | Inflation redistribuée silencieusement ; économie différente | **Gate tokenomics : destination explicite des 20 %** | Conservation supply ; intégrales ; checkpoints ; epochs fixes ; claims et buybacks Project X |
| Marché secondaire Project X | `FWATokenHook.sol`, `FWAToken.sol` | Pool natif/FWA, LP fee 0, hook 1 %/sens, exact input, gating buys/transfers | PoolManager/PositionManager/Permit2 Uniswap v4 Ethereum | Project X V3 wHYPE/HWA, tier 1 %, tick spacing 200, position single-sided atomiquement mintée au locker | Frais LP et non delta de hook ; wHYPE ; exact-output non bloquable après ouverture ; LP tiers possibles ; part protocolaire Project X administrable | Dérive `feeProtocol`, contournement de la fermeture par transferts non-pool, principal LP extractible, mauvaise factory | **DEX décidé : Project X ; création permissionless, sans dépendance DM** | Factory/router/NFPM attestés ; launch atomique ; gating achats ; locker ; collecte fee ; bornes buyback dynamiques ; fork mainnet |
| Buybacks et Splitter | `FWAToken.sol`, `Splitter.sol` | Buyback permissionless, delay 1 bloc, bounty 50 bps, 40/40/20 ; revenus 70/30 dont owner secondaire 1/10 de la part owner | Pool v4 ; snapshot NFT Ethereum spécifique | Buyback via adapter Project X V3, TWAP 30 minutes, minOut fixe à 90 % de la quote après fee et limite sqrt relative au spot ; `SplitterHyperEVM` avec logique 70/30 identique | Route/quote/oracle V3 ; adresse snapshot fournie au constructeur ; « un bloc » a autre durée | Manipulation TWAP/MEV résiduelle, oracle indisponible, mauvaise collection/owners, cadence accélérée | **Mécanisme décidé ; gate restante : collection snapshot et adresses owner/secondary** | Routage/burn exact ; oracle non prêt ; déplacement de prix > bande de lancement ; full-fill ; anti-double buyback ; claims snapshot ; sweep |
| Indexation et bots | Événements des 8 contrats ; frontend | Reconstruction logs, traitement acquisitions, activation staging, payout/buyback permissionless | RPC Ethereum historique | Subgraph Goldsky-compatible pour history/discovery ; writes et droits relus on-chain ; secours compte checkpointé sur RPC logs/archives dédié | RPC public limité à 50 blocs, endpoint archives externe, horizon du secours borné | Trous d'index, lag, données GraphQL hostiles, endpoint logs indisponible | Déployer le subgraph 999, sélectionner/revoir le RPC logs et superviser `_meta.block` avant promotion | Build déterministe ; ownership/listings revalidés ; chunks conformes à la plage fournisseur ; reprise checkpoint ; reorg/lag à tester sur endpoints réels |
| Frontend | `fwa.fun` vivant | Pool explorer, rarity/odds, feed Recent/Top/Pool/Deposits, batch 1–5, positions, randomness, settlement, rewards | Wallet Ethereum, ETH, données indexées | Même UX avec réseau 998/999 et HYPE explicite | Branding/adresses/réseau ; données de saison | Confusion HyperCore/HyperEVM, prix stale, mauvaise unité | Aucun avant maquettes fidèles ; collections à valider | E2E réseau 998, changement chaîne, états pending/refund/stuck, données on-chain croisées |
| Rôles administratifs | `Ownable` des 8 contrats, operator VRF, distributors, hook pools | Owner configure paramètres ; operator service ; modules explicitement autorisés ; pas de proxy | EOAs/adresses Ethereum | Multisig/timelock HyperEVM à définir ; même séparation de pouvoirs | Gouvernance de déploiement change | Clé unique, mauvaise initialisation, pouvoir excessif | Modèle opérationnel avant déploiement public | Matrice permissions, unauthorized fuzz, transfert owner, pause/recovery |

## 7. Blocker randomness

### État vérifié et décision

La [liste officielle des réseaux Chainlink VRF v2.5](https://docs.chain.link/vrf/v2-5/supported-networks) ne contient ni HyperEVM ni Hyperliquid au 2026-07-25. L'intégration Ethereum ne peut donc pas être recopiée en changeant seulement une adresse.

[Proof of Play vRNG](https://docs.proofofplay.com/services/vrng/introduction) documente officiellement :

- HyperEVM mainnet : `0x9eC728Fce50c77e0BeF7d34F1ab28a46409b7aF1` ;
- HyperEVM testnet : `0xd14D984603b0b7Ade91bE52f3Fc4A917Dfa77bcD` ;
- inscription manuelle pendant l'early access ;
- drand quicknet et callback `randomNumberCallback(requestId, randomNumber)` ;
- même valeur aléatoire de base pour les demandes d'une fenêtre d'environ 3 secondes, à dériver avec un contexte unique.

Les deux adresses ont 2 739 octets de runtime bytecode sur les RPC officiels au moment du contrôle. Cela prouve un déploiement, pas une équivalence de sécurité à Chainlink.

| Option | Disponibilité prouvée | Parité | Points de sécurité/intégration | Statut |
|---|---|---|---|---|
| Chainlink VRF 2.5 | Non sur HyperEVM | Exacte en théorie | Pas de coordinator officiel ; impossible aujourd'hui | Rejetée tant que support absent |
| Proof of Play vRNG | Contrats présents, mais inscription manuelle requise et formulaire de contact inutilisable pendant le test | Non exact | Dépendance d'accès externe bloquante | Conservé comme historique/repli, plus bloquant pour 998 |
| Gelato VRF | HyperEVM mainnet 999 listé ; testnet 998 absent de la liste officielle contrôlée le 2026-07-26 | Frontière asynchrone, mais mot libre de l'opérateur dans l'ancien adapter | Ne fournit pas l'intégrité on-chain requise par HWA | **Rejeté comme source de vérité ; éventuellement transport externe seulement** |
| `DrandRelayCoordinator` | Déployable sans permission sur 998 avec le beacon public evmnet | Même file/request IDs/callback FWA ; preuve plus faible | Round futur figé ; relayer allowlisté ; signature de 64 octets ; `SHA-256(signature)` ; deux APIs indépendantes hors chaîne ; pas de BLS on-chain | **Cible testnet 998 uniquement** |
| Vérification BLS BN254 directe | Evmnet et précompiles EVM compatibles ; preuve officielle validée dans les tests | Résultat public vérifié avant callback FWA | `DrandEvmnetRegistry` + `DrandBN254Coordinator`; verifier vendored expérimental à auditer | **Chemin mainnet implémenté et obligatoire, sous gate d'audit cryptographique** |

Architecture figée pour 998 : le core FWA reste inchangé et ne consomme que les quatre sélecteurs coordinator déjà utilisés. `DrandRelayCoordinator` verrouille un round evmnet futur, accepte uniquement sa signature publique via un relayer autorisé, dérive un mot séparé par domaine/chain/coordinator/round/request/consumer, puis appelle `rawFulfillRandomWords`. Le relayer compare Protocol Labs et Cloudflare et contrôle `SHA-256(signature)` avant broadcast. Aucun `blockhash`, `timestamp`, `prevrandao` ou caller ne constitue la source d'entropie.

Cette architecture 998 est explicitement **offchain-verified** et sert uniquement aux tests sans valeur. Sur 999, le registry vérifie la preuve BN254 evmnet on-chain, puis le coordinateur impose round futur, confirmations, fraîcheur, expiry, gas cap, retry et IDs non collisionnels. Les submitters sont permissionless : leur panne affecte la disponibilité, pas le choix du résultat. Le verifier vendored reste un scope d'audit cryptographique bloquant avant broadcast.

Preuve live 998 historique : le premier callback a volontairement couvert le chemin `TimedOut → Expired → pull refund`; après adaptation de `selectionTimeoutBlocks` de 30 à 360 pour préserver la durée murale Ethereum, le second callback a sélectionné puis livré le NFT par `keepNFT`. Le stack Project X-compatible actuel utilise le nouveau `DrandRelayCoordinator` `0x5418888554Bf470ACc9000d3bC264B610a6a4f22`, lié au FWA `0x1F844C01FDc5d25c3Bd84d55683ee187041b454c`. Les receipts et digests publics sont consignés dans `TESTNET_998_DEPLOYMENTS.md`.

## 8. Décision liquidité : Project X V3

La [page officielle Uniswap v4 deployments](https://docs.uniswap.org/contracts/v4/deployments) et son [fichier de déploiements officiel](https://raw.githubusercontent.com/Uniswap/contracts/main/deployments/deployments.json) ne listent ni chain ID 998/999 ni HyperEVM/Hyperliquid au 2026-07-26. Aucune stack v4 canonique exploitable n'est donc prouvée sur HyperEVM. Le choix actif est Project X V3 : architecture standard, création de pool permissionless et meilleure distribution, au prix de contrôles plus faibles qu'un hook v4.

Les contrats Project X ont été attestés directement sur le RPC mainnet 999. Le tier `10_000` utilise le tick spacing `200`; la factory crée les pools permissionlessly. La factory reste owner-controlled et la part protocolaire du fee est modifiable par l'administration Project X. Aucun déploiement officiel Project X 998 n'est documenté.

| Réseau | Factory V3 | SwapRouter | NFPM | wHYPE |
|---|---|---|---|---|
| Testnet 998, compatibilité seulement | `0x22B0768972bB7f1F5ea7a8740BB8f94b32483826` | `0xD81F56576B1FF2f3Ef18e9Cc71Adaa42516fD990` | `0x09Aca834543b5790DB7a52803d5F9d48c5b87e80` | `0xADcb2f358Eae6492F61A5F87eb8893d09391d160` |
| Mainnet 999, Project X | `0xFf7B3e8C00e57ea31477c32A5B52a58Eea47b072` | `0x1EbDFC75FfE3ba3de61E7138a3E8706aC841Af9B` | `0xeaD19AE861c29bBb2101E834922B2FEee69B9091` | `0x5555555555555555555555555555555555555555` |

Baseline d'implémentation : tier V3 statique 1 %, tick spacing 200, position single-sided comparable au lancement FWA, adapter immuable et vérification on-chain de la factory, du router, du wHYPE et du pool canonique. `FWATokenHyperEVMFactory.deployAndLaunch` déploie le token et le locker, crée/initialise le pool, puis mint le NFT LP directement au locker dans une seule transaction. `HWAProjectXLiquidityLocker` n'expose aucun transfert ni decrease-liquidity mais permet la collecte des frais vers un recipient explicite. Les achats publics restent fermés jusqu'à l'action owner `setExternalBuysEnabled(true)` ; aucune minuterie n'existe. Voir `PROJECTX_INTEGRATION_RFC.md`.

## 9. Legacy et données de saison

`FWAClaim` n'est pas une dépendance technique du core, mais il est une dépendance économique de la supply : 20 % du milliard de tokens sont destinés au snapshot v1 et son Merkle root courant est `0x304c5bafbde1693914071ed4981f750f846f9963cb0cec3914bf7bf02d17a1af`. Pour une nouvelle saison HyperEVM sans historique v1, copier le contrat avec ce root serait incohérent ; supprimer ou redistribuer ces 20 % changerait l'économie. Cette allocation doit donc faire l'objet d'un arbitrage avant le déploiement du token, sans bloquer le port du core.

Le `Splitter` dépend d'un NFT Ethereum fixe `0xb33d806a94B6770C9d309E0842a75f8E6edCd5A6`, d'une supply snapshot 264 et d'un max token ID 324. Son partage courant est 70 % owners / 30 % snapshot NFTs, avec un secondary owner optionnel recevant un dixième de la part owner lorsqu'il est configuré. `SplitterHyperEVM` reproduit désormais ces calculs, checkpoints, claims et le sweep à 365 jours. L'adresse NFT devient un immutable de constructeur, car la collection Ethereum n'est pas consultable nativement sur HyperEVM. Pour HWA mainnet, l'owner est le Safe 2-sur-3 préparé et le secondary est explicitement désactivé : les 70 % owner vont donc intégralement au Safe.

## 10. Frontend et indexation observés

Le frontend vivant expose les comportements à reproduire, sans commencer l'implémentation UI avant le gel contrat :

- explorer le pool en cards ou liste, filtrer par rareté, trier et paginer ;
- afficher backing, classe, odds, profit/perte, ancienneté et listing ID ;
- feed `Recent / Top / Pool / Deposits` avec états pending, NFT reward, bid accepté, bid token et relist ;
- acquisition batch de 1 à 5, prix/odds et tolérance de drift 10 % ;
- crown 1 % courant, reward purchaser hot/cold, stats globales ;
- wallet, positions, dépôt NFT + backing, suivi randomness, settlement, claims et rewards.

Sur HyperEVM, chaque écran doit afficher HYPE, distinguer explicitement HyperEVM de HyperCore, refuser les mauvais chain IDs et croiser les vues critiques directement on-chain. Les probabilités et prix ne peuvent pas dépendre uniquement d'une base indexée potentiellement en retard.

## 11. Rôles et dépendances actuels

- Owner commun courant : `0x019817ad02a31b990433542097be29d97613e8cb`.
- Operator VRF courant : `0x1033eaa8a296b68b4c56dd98e742175f9e81fc14`; le deployer a été retiré.
- Distributeurs FWA : `FWARewards` et `FWAClaim`.
- Pool autorisé du hook : `FWARewards`.
- Payout du core : `Splitter`.
- Manager allowlist : `FWAWhitelist`.
- Le burn path TTT est désactivé avec `TTT_AMOUNT=0`.
- Le hook conserve `externalBuysEnabled=false`.

Le déploiement HyperEVM devra produire une matrice owner/operator/distributor/pool, vérifier chaque liaison bidirectionnelle avant activation et transférer l'administration selon le modèle multisig/timelock choisi. Aucun contrat proxy n'est requis pour atteindre la parité actuelle.

## 12. Tests qui figeront la specification

Avant port fonctionnel :

1. installer Foundry et reconstruire les huit contrats de référence avec leurs dépendances exactes ;
2. créer un fork Ethereum pinned et des tests différentiels de vues, calculs, erreurs, événements et traces reproductibles ;
3. capturer des golden traces pour list/stage/activate/withdraw, single/batch acquire, callbacks hors ordre, timeout/refund, quatre settlements, depositor reclaim, finalize et stuck NFT ;
4. fuzz/invariants : racine = somme des poids, passifs natifs conservés, un NFT au plus dans un statut, aucun double claim, séquence monotone, escrows fermés une seule fois ;
5. collections hostiles, callbacks/reentrancy, receveurs HYPE qui revert, gas boundaries ;
6. tester drand et l'adapter sur la venue V3 ABI-compatible chain ID 998, puis répéter la matrice sur un fork de la stack Project X mainnet 999 ;
7. indexeur/bots, puis frontend, puis E2E complet testnet.

## 13. Gates de décision — non bloquants pour la suite immédiate

Aucune décision utilisateur n'est nécessaire pour poursuivre la reconstruction et les tests différentiels du core. Les choix suivants deviennent irréversibles plus tard et sont donc volontairement différés jusqu'aux preuves correspondantes :

1. **Randomness** : **implémenté — drand-relay historique sur 998, preuve drand evmnet BN254 on-chain sur 999**. Les adapters relay/Gelato/PoP refusent chain 999. Audit du verifier, réserve, deux submitters et canary restent les gates production.
2. **Liquidité** : **décidé — Project X V3**. Le testnet 998 prouve l'ABI et le flux atomique ; le fork 999 atteste les adresses officielles et exécute un buyback réel. Le lancement exige tier 1 %, tick spacing 200, locker irréversible, observations TWAP prêtes et contrôle manuel des achats publics. Les bornes buyback sont dérivées on-chain, pas signées ni administrables.
3. **Tokenomics de saison** : destination des 20 % v1 et maintien ou non de `FWAClaim`.
4. **Revenue split** : **décidé — même Splitter 70/30 que FWA**. Snapshot HWA Genesis de 333 NFT, owner Safe 2-sur-3 préparé, secondary explicitement désactivé. La collection canonique `Pressure Field` v3 est approuvée et verrouillée par son aggregate SHA-256 ; le hostname VPS HTTPS et l'attestation distante des 666 ressources restent à fournir avant freeze. IPFS est un miroir optionnel.
5. **Collections** : allowlist courte et caps après inventaire HyperEVM vérifié.
6. **Administration** : multisig, timelock, operators et procédure d'urgence avant déploiement public.

## 14. État de Phase 0 et prochaine tranche

Acquis : sources exactes des huit contrats, ABIs, constructors, bytecodes/hashes, non-proxy, owners/rôles, vues courantes, historique de configuration, allowlist reconstruite, parcours frontend, paramètres HyperEVM, absence Chainlink VRF et absence v4 canonique confirmées, Project X choisi comme DEX et stack V3 mainnet 999 attestée.

Reste à fermer avant promotion mainnet :

- audit indépendant des contrats, scripts, frontend et indexeur ;
- gel des inputs irréversibles : Safe, snapshot, collections, tokenomics, prix et recipients ;
- déploiement fail-closed puis configuration drand/Project X/Goldsky ;
- vérification publique des sources et canary 999 avant promotion du manifeste.

Le core de référence reste inchangé. La décision Project X autorise le port isolé rewards/token/liquidité décrit au §8 ; les allocations de saison, bénéficiaires et opérations irréversibles restent interdites sans leurs gates explicites.

## 15. Avancement contrats et tests — 2026-07-25

La préparation technique a commencé sans modifier la couche de référence :

- projet Foundry configuré en Solidity 0.8.30, optimizer 1, via-IR et cible Cancun ;
- les huit sources vérifiées recompilent avec les mêmes tailles runtime que la référence ;
- `FWA`, `FWAVRFService` et `FWAWhitelist` restent inchangés pour le premier déploiement core ;
- `PoPRandomnessAdapter` est préservé comme historique/repli ; `DrandRelayCoordinator` reprend les mêmes quatre sélecteurs pour débloquer le testnet 998 sans inscription externe ;
- `SplitterHyperEVM` reproduit le partage 70/30, le secondary owner, les claims snapshot cumulatifs et le sweep annuel ; le core exige désormais ce payout au déploiement ;
- `FWATokenHyperEVM`, `FWAHyperSwapAdapter` et `HWAProjectXLiquidityLocker` portent le marché Project X V3 sans transfer-tax ;
- le lancement atomique crée et initialise le pool, seed la position et mint directement le NFT LP au locker ;
- les tests locaux couvrent lancement, buy gate, pool canonique, oracle non prêt, TWAP/minOut dynamiques, déplacement au-delà de la bande de lancement, buyback et locker ; un test fork mainnet atteste les contrats Project X et exécute le buyback ;
- scripts séparés randomness, token, modules, binding, vérification et activation manuelle ; acquisitions et achats externes restent fermés jusqu'aux E2E.

Le runbook actif est `PROJECTX_DEPLOYMENT_RUNBOOK.md`. Le core, splitter, token, rewards, adapter, pool et locker Project X-compatible sont déployés et vérifiés sur 998 ; l'absence de Project X officiel sur 998 est explicitement compensée par les tests fork 999. `FWAClaim` reste derrière la gate d'allocation legacy ; le Splitter live utilise la collection snapshot et les bénéficiaires consignés dans le déploiement 998.
