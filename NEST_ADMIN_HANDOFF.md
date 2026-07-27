# Handoff administrateur Nest — pool HWA/wHYPE

> **ARCHIVÉ — 26 juillet 2026.** Aucun handoff Nest n'est requis pour la cible Project X permissionless.

Ce document est le paquet opérationnel à transmettre à Nest. Il ne demande aucune modification globale des defaults de la factory.

## Références

- Réseau cible initial : HyperEVM testnet, chain ID `998`.
- Réseau de référence vérifié : HyperEVM mainnet, chain ID `999`.
- Factory Nest 999 : `0xF77Bd082c627aA54591cF2f2EaA811fd1AB3b1F3`.
- wHYPE 999 : `0x5555555555555555555555555555555555555555`.
- Token HWA : `<FWA_TOKEN_ADDRESS>`.
- Locker LP : `<FWA_NEST_LIQUIDITY_LOCKER_ADDRESS>`.
- Plugin HWA : `<FWA_NEST_PLUGIN_ADDRESS>`.
- Pool attendu : `<FWA_NEST_POOL_ADDRESS>`.

Les préfixes techniques `FWA_*` et les noms de contrats `FWA…` restent ceux du core de référence et des scripts existants. Ils ne définissent pas le ticker : le token produit doit exposer `name() = "Hyper World Assets"` et `symbol() = "HWA"`.

Nest doit fournir les adresses officielles/compatibles factory, router, position manager et wHYPE pour le chain ID 998 avant le test E2E.

## Condition bloquante — création et garde atomiques

La création du base pool et l'installation de la garde **ne doivent jamais être séparées par un bloc public**. Dès qu'un base pool existe sans plugin, n'importe qui peut appeler `initialize` avec un prix arbitraire; comme il n'existe qu'un base pool par paire, ce grief est irréversible.

Nest doit donc confirmer l'une de ces deux procédures avant toute Action 1 :

1. un batch/admin bundle atomique qui crée le pool, déploie/attache le plugin et fixe sa config avant de rendre la transaction observable; ou
2. le chemin officiel Algebra custom-pool/plugin-factory qui retourne et attache le plugin dans le hook de création.

Un simple accord « personne n'appelle initialize » et deux transactions publiques successives sont refusés. Si Nest ne peut garantir l'atomicité, **le lancement Nest est bloqué** et aucun base pool HWA/wHYPE ne doit être créé.

## Action 1 — créer le pool non initialisé dans le batch protégé

Avec l’autorité requise par la factory courante :

```solidity
factory.createPool(wHYPE, FWA_TOKEN_ADDRESS)
```

Critères d’acceptation :

- `factory.poolByPair(wHYPE, FWA_TOKEN_ADDRESS) == FWA_NEST_POOL_ADDRESS` ;
- `pool.token0/token1` correspondent à HWA et wHYPE ;
- `pool.globalState().price == 0` ;
- le même batch/protocole de création attache la garde de l'action 2 avant toute possibilité d'initialisation externe.

## Action 2 — installer la garde dans la même procédure atomique

Après déploiement du plugin HWA :

```solidity
pool.setPlugin(FWA_NEST_PLUGIN_ADDRESS);
pool.setPluginConfig(7);
```

`7` active `beforeSwap`, `afterSwap` et `beforeModifyPosition`. Le token HWA vérifie que le plugin est lié à ce pool, à ce token et au bon wHYPE.

L’équipe HWA appelle ensuite `token.initializeMarket(FWA_INITIAL_SQRT_PRICE_X96)`. À ce stade :

- le prix est non nul ;
- aucune LP n’est encore créée ;
- tous les swaps restent bloqués par `MarketNotLaunched` ;
- Algebra a réappliqué les defaults factory au fee, community fee et tick spacing.

## Action 3 — appliquer les paramètres finaux après initialisation

```solidity
// Réinstaller seulement si la valeur a dérivé.
pool.setPlugin(FWA_NEST_PLUGIN_ADDRESS);
pool.setPluginConfig(7);
pool.setFee(10_000);       // 1 % en unités Algebra 1e-6
pool.setCommunityFee(0);   // les frais reviennent à la LP HWA
pool.setTickSpacing(60);   // seulement si la valeur courante diffère
```

Les setters Algebra refusent certaines écritures identiques. Le script `ConfigureNestPool.s.sol` lit donc chaque valeur et n’envoie que les changements nécessaires.

Critères d’acceptation avant la LP :

| Lecture | Valeur attendue |
|---|---:|
| `token.name()` | `Hyper World Assets` |
| `token.symbol()` | `HWA` |
| `pool.plugin()` | `FWA_NEST_PLUGIN_ADDRESS` |
| `globalState().pluginConfig` | `7` |
| `pool.fee()` | `10000` |
| `globalState().lastFee` | `10000` |
| `globalState().communityFee` | `0` |
| `pool.tickSpacing()` | `60` |

L’équipe HWA appelle ensuite `token.finalizeLaunch(tickLower, tickUpper)`. Cette transaction minte la position single-sided directement vers le locker irréversible. Elle revert si une valeur ci-dessus diffère.

## Configuration et confiance résiduelle

### Pouvoirs administratifs HWA/Nest

Tous les rôles HWA mainnet doivent appartenir au même Safe. Les actions destructives ou économiques sont soumises à la politique de délai du Safe; elles ne doivent jamais être signées par le deployer.

| Fonction | Holder | Impact maximal | Réversibilité/politique |
|---|---|---|---|
| `FWA.setBool(ACQUISITIONS_ENABLED, …)` | Safe | ouvre/ferme les nouvelles acquisitions | fermeture immédiate; ouverture après gates |
| `FWA.setRewards` | Safe | lie définitivement le module d'émission | one-shot, uniquement pool vide |
| `Splitter.setOwnerShareBps` | Safe | modifie le futur split owner/NFT | impossible après `freezeSplit`; freeze avant launch |
| `Splitter.sweep` | Safe | clôt définitivement les claims après 365 j | irréversible; délai Safe + annonce |
| `FWATokenNest.setExternalBuysEnabled` | Safe | ouvre/ferme les buys publics | fermeture immédiate; ouverture manuelle séparée |
| `FWATokenNest.setRouteSplit` | Safe | redirige 100 % des futurs buybacks | réversible mais économique; délai Safe obligatoire |
| `FWATokenNest.setDistributor/setProtocolBuyer` | Safe | autorise transferts/achats protocolaires | réversible; liste strictement limitée aux modules attestés |
| `FWATokenNest.schedule/executeEmergencyHypeRescue` | Safe/permissionless execute | retire le HYPE si la config pool est cassée | 7 jours, fingerprint figé, état fermé |
| `FWARewards.setEmission` | Safe | fixe les émissions avant démarrage | bloqué après start; budget préfinancé |
| `FWARewards.setColdGapBands/setForcedTokenShareBps` | Safe | change la part de surcharge destinée aux acheteurs | délai Safe; valeurs publiques |
| `FWARewards.sweepEmptyEpoch` | Safe | récupère un pot sans participant | epoch fermé et vide; délai Safe |
| `FWARewards.rescueTokens` | Safe | peut vider les rewards et arrêter l'émission | seulement après signal `canRescueRewards`; migration destructive annoncée |
| `FWANestSwapAdapter.recoverForcedHype` | Safe | récupère uniquement du HYPE forcé dans l'adapter | pas les swaps normaux; événement public |
| `FWANestLiquidityLocker.collectFees` | permissionless | envoie les fees au recipient immuable | principal LP non récupérable |

Le Safe doit appliquer un délai aux changements de route, distributeurs/protocol buyers, paramètres rewards, sweep et rescue. Les deux kill switches restent exécutables sans délai additionnel.

Le plugin remplace le plugin dynamique/oracle Nest standard pour ce pool. Aucun flag de fee dynamique n’est activé. Le token et le plugin bloquent les flux HWA si plugin, flags, fee, community fee ou tick spacing dérivent.

Les rôles Nest conservent néanmoins l’autorité native du pool Algebra. L’accord demandé porte donc aussi sur la stabilité de cette configuration ou, à défaut, sur une gouvernance/timelock explicitement documentée.

## Preuve déjà exécutée

Le test `hyperevm-fork-test/NestDeployment.t.sol` reproduit tout ce workflow contre les vrais contrats Nest 999 sur un fork local : création de pool, installation du plugin, initialisation, réapplication observée des defaults, configuration finale, LP verrouillée, buyback via le router officiel et collecte des frais via le vrai position manager. Il passe sans diffuser de transaction.
