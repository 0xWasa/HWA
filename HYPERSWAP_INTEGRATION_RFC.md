# RFC — intégration `$FWA` sur HyperSwap

**Statut : direction produit acceptée, contrats et tests prêts pour déploiement 998**  
**Date de capture : 2026-07-25**

## Décision

Le `$FWA` HyperEVM sera coté sur HyperSwap. Cette décision remplace l'option de déployer une stack Uniswap v4 autonome. Elle conserve le lieu de liquidité natif de l'écosystème HyperEVM, mais elle n'est pas une parité stricte avec le hook FWA Ethereum.

La baseline est **HyperSwap V3, tier `10_000` (1 %), pool wHYPE/FWA**. V3 est préférée à V2 parce qu'elle permet de reconstruire le lancement single-sided, la position NFT et les limites de prix des achats protocole. Le tier 1 % conserve le nominal payé dans les deux directions. La factory impose alors un tick spacing de `200`, contre `60` sur le pool v4 original.

## Contrats officiels attestés

| Réseau | Chain ID | Factory V3 | SwapRouter01 | Quoter | NFPM | wHYPE |
|---|---:|---|---|---|---|---|
| HyperEVM testnet | 998 | `0x22B0768972bB7f1F5ea7a8740BB8f94b32483826` | `0xD81F56576B1FF2f3Ef18e9Cc71Adaa42516fD990` | `0x7FEd8993828A61A5985F384Cee8bDD42177Aa263` | `0x09Aca834543b5790DB7a52803d5F9d48c5b87e80` | `0xADcb2f358Eae6492F61A5F87eb8893d09391d160` |
| HyperEVM mainnet | 999 | `0xB1c0fa0B789320044A6F623cFe5eBda9562602E3` | `0x4E2960a8cd19B467b82d26D83fAcb0fAE26b094D` | `0xF865716B90f09268fF12B6B620e14bEC390B8139` | `0x6eDA206207c09e5428F281761DdC0D300851fBC8` | `0x5555555555555555555555555555555555555555` |

Preuves effectuées sur les RPC officiels : chain IDs 998/999, bytecode non vide, `SwapRouter01.factory()` égal à la factory documentée, `SwapRouter01.WETH9()` égal au wHYPE attendu, et `feeAmountTickSpacing(100/500/3000/10000)` égal à `1/10/60/200` sur les deux factories.

Sources primaires : [HyperSwap V3 testnet](https://docs.hyperswap.exchange/docs/amm/contracts/testnet/v3/), [HyperSwap V3 mainnet](https://docs.hyperswap.exchange/docs/amm/contracts/hyper-evm/v3/), [contrats et wHYPE mainnet](https://docs.hyperswap.exchange/docs/amm/contracts/hyper-evm/), [dApp testnet officielle](https://docs.hyperswap.exchange/docs/amm/official-links/).

## Architecture de port

### `FWATokenHyperEVM`

- conserve supply fixe, distributeurs, burn, bounty buyback, délai et routage 40/40/20 ;
- remplace les immutables v4 par le pool HyperSwap et l'adapter ;
- autorise les transferts mint/burn, owner, distributeurs et ceux impliquant le pool configuré ;
- avant ouverture publique, un transfert pool → destinataire n'est permis qu'aux acheteurs protocole autorisés ;
- ne contient aucune taxe de transfert ;
- ne peut fixer son pool qu'une fois après vérification factory/token0/token1/fee.
- est déployé et lancé atomiquement par `FWATokenHyperEVMFactory`, puis vérifie le `slot0` initial avant le mint LP.

### `FWAHyperSwapAdapter`

- immutables : factory, router, wHYPE, token, fee tier et pool ;
- refuse une factory/router/wHYPE incohérente ;
- n'accepte comme callers que `FWARewards` et `FWATokenHyperEVM` selon le chemin ;
- exécute uniquement des achats exact-input HYPE → FWA dont le caller autorisé est aussi le recipient ;
- impose `minOut`, deadline courte, résultat non nul et absence de HYPE résiduel non comptabilisé ;
- wrappe le HYPE localement en wHYPE et contrôle le solde ERC-20 résiduel, sans dépendre de `router.refundETH()` ;
- expose des événements suffisants pour l'indexeur : caller, recipient, HYPE dépensé, FWA reçu, pool et fee ;
- ne conserve ni allowance utilisateur ni fonds entre deux opérations, hors dust récupérable par procédure bornée.

### `FWARewardsHyperEVM`

- conserve intégralement les checkpoints, sqrt backing, émissions, epochs hot/cold et liabilities ;
- remplace le callback PoolManager v4 par un appel à l'adapter ;
- `buyFor(recipient,minOut)` envoie son HYPE à l'adapter et crédite exactement le montant FWA retourné ;
- les claims et intégrales d'émission restent indépendants du DEX.

### Lancement et liquidité

- créer le pool V3 wHYPE/FWA au tier 1 % ;
- reproduire une position token-only placée sous le prix de lancement, avec bornes multiples de 200 ;
- conserver le NFT LP dans le wallet testnet pendant toute la campagne 998 afin de permettre les tests et la récupération ;
- n'effectuer aucun burn ou verrouillage irréversible sur testnet ;
- avant mainnet, vérifier le mécanisme HyperSwap de lock/delegation, son adresse, son bytecode et son audit, puis geler le bénéficiaire des frais.

Le lancement atomique empêche le front-run le plus critique du modèle V3 : personne ne peut insérer une transaction entre le déploiement du token et l'initialisation de son pool canonique. Le token vérifie en plus factory, tokens, fee, tick spacing et `slot0` avant de transférer la seed LP.

## Divergences acceptées et interdites

| Sujet | Ethereum v4 | HyperSwap V3 | Statut |
|---|---|---|---|
| Frais | hook 1 % vers `feeAddress`, LP fee 0 | LP fee 1 % vers la position | Nominal conservé, flux non exact |
| Actif natif du pool | ETH natif | wHYPE | Adaptation imposée |
| Tick spacing | 60 | 200 au tier 1 % | Acceptée |
| Gating achats | hook inspecte le sender | guard token jusqu'à ouverture publique | Comportement pré-lancement conservé, mécanisme différent |
| Exact-output | rejeté par le hook | DEX peut l'exposer après ouverture | Divergence acceptée pour le marché externe ; chemins protocole exact-input uniquement |
| Transferts | allowance transiente pilotée par hook | allowlist pool/distributeurs dans le token | Mécanisme différent, invariant à tester |
| Taxe ERC-20 | aucune | aucune | Toute transfer-tax cachée est interdite |

Ce fork ne doit donc pas être présenté comme identique au niveau microstructure du marché. Le gameplay NFT, les passifs HYPE, les rewards et les settlements restent soumis à leurs exigences de parité propres.

## Tests de passage testnet 998

1. attester le bytecode et les getters factory/router/wHYPE/NFPM ;
2. créer le pool tier 1 % et vérifier token0/token1/fee/tickSpacing ;
3. mint de la position single-sided et conservation exacte des balances ;
4. buy externe refusé avant ouverture, buy rewards autorisé, sell autorisé ;
5. ouverture publique irréversible ou protégée selon la specification finale ;
6. exact-input HYPE→FWA avec `minOut`, deadline, partial/zero output et prix adverse ;
7. `acceptBidAsTokens`, purchaser allowance puis claim ;
8. buyback permissionless, bounty 50 bps, délai, routage 40/40/20 et burn réel ;
9. collecte des fees LP et rapprochement des événements ;
10. fuzz des guards de transfert et test d'adresses pool/router malicieuses ;
11. invariants : supply, liabilities rewards, aucun HYPE captif dans l'adapter, aucun double routage ;
12. matrice complète avec le core FWA et Proof of Play sur les CA testnet.

État actuel : les points 1–6 et les invariants d'adapter ont été validés localement ; un fork réel du réseau 998 a créé le pool, mint la position et exécuté `FWARewardsHyperEVM.buyFor` via le SwapRouter01 officiel. Les points 7–12 restent à rejouer sur les CA persistants après inscription Proof of Play.

## Gates encore ouverts

- destination des 20 % de supply réservés à la migration v1 ;
- destinataire des frais LP et stratégie mainnet de verrouillage/délégation du NFT LP ;
- bénéficiaires du `Splitter` ;
- cadence buyback exprimée en blocs ou en secondes sur HyperEVM ;
- paramètres définitifs de prix et bornes de la position de lancement.
