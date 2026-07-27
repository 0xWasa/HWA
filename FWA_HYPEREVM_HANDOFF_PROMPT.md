# Prompt de handoff — fork exact de FWA sur HyperEVM

Tu reprends un projet entièrement réorienté. Ignore l’ancien concept de Bags de memecoins : il est abandonné et archivé. La nouvelle mission est de construire un fork fonctionnel aussi fidèle que possible de la version actuellement déployée de Fake World Assets (`fwa.fun`), en conservant les NFTs et en portant le protocole sur HyperEVM pour y relancer une saison NFT.

Le juridique est complètement hors périmètre. Ne produis aucune analyse juridique et ne bloque aucune étape pour ce motif.

## Objectif

Reproduire le comportement onchain, les paramètres économiques, les parcours utilisateur, les événements et les mécanismes de sûreté de FWA. Les seules divergences autorisées sans nouvel arbitrage sont celles imposées par HyperEVM :

- HYPE remplace ETH comme actif natif de backing, de paiement et de gas ;
- les adresses et services d’infrastructure propres à Ethereum doivent être remplacés par des équivalents HyperEVM vérifiés ;
- les collections admises seront des ERC-721 déployés sur HyperEVM.

Toute autre divergence doit être identifiée dans une matrice de parité et soumise avant implémentation. Ne qualifie jamais de « fork exact » une adaptation qui modifie silencieusement l’économie, le hasard, les droits, les fenêtres temporelles, les rewards ou le settlement.

## Sources de vérité

Travaille à partir de sources primaires et vérifie leur état actuel :

1. documentation officielle : `https://www.fwa.fun/docs` ;
2. sources vérifiées et état onchain des contrats Ethereum ;
3. transactions et événements du déploiement courant ;
4. frontend `https://www.fwa.fun/` pour les parcours et états UX ;
5. documentation officielle Hyperliquid/HyperEVM ;
6. documentation officielle des dépendances externes retenues.

Déploiement FWA Ethereum à reconstruire :

- `FWA` core : `0xB276F62DB0ce8CA2Ca5bc522695bE604521eAc1c`
- `FWARewards` : `0x6a1a1C0CfB3D3C538e13D36d608a5bcaa992fc78`
- `FWAVRFService` : `0xa084c33Fb7a467307452898b8D58165ebd2E5D9f`
- `FWAToken` : `0xa0Df17B5aC76ABaBA36E1450E2cbCd18A620C845`
- `FWATokenHook` : `0x2C67ebA8A50AF0dB5Fba55F725247a75CbDA6444`
- `FWAClaim` : `0xd4085d38855F17EdF0B1CCBFad7B3846fb305655`
- `FWAWhitelist` : `0x854352b275cF6A0DfFCf2983C986FBe9345e17c3`
- `Splitter` : `0x1C175b9F0e8C73eD3e677e1cBb1B5A2DD4373Bfe`

Attention : vérifie toutes les adresses dans la page officielle des déploiements avant de les utiliser. Si une adresse de cette liste est erronée, corrige le manifeste et explique la correction. N’utilise pas de code non vérifié comme référence implicite.

## Environnement cible à vérifier

- HyperEVM mainnet : chain ID `999`, RPC officiel `https://rpc.hyperliquid.xyz/evm` ;
- HyperEVM testnet : chain ID `998`, RPC officiel `https://rpc.hyperliquid-testnet.xyz/evm` ;
- actif natif : HYPE, 18 décimales ;
- EVM : Cancun sans blobs ;
- architecture dual-block à prendre en compte pour le gas et les transactions lourdes ;
- le RPC officiel limite certaines lectures historiques et les plages de logs : prévoir un RPC archival et un indexer adaptés.

Revérifie ces données au début du travail.

## Deux blockers d’infrastructure à résoudre explicitement

### Hasard

Ne présume pas que Chainlink VRF 2.5 est disponible sur HyperEVM. Vérifie la liste officielle Chainlink. HyperEVM référence actuellement Proof of Play vRNG dans son catalogue d’outils ; sa documentation indique des déploiements HyperEVM et une inscription manuelle pendant l’early access.

Produis une comparaison sécurité/intégration entre :

- le mécanisme exact `FWAVRFService` sur Ethereum ;
- Proof of Play vRNG sur HyperEVM ;
- une autre solution vérifiable réellement disponible ;
- le déploiement autonome d’une infrastructure équivalente, si réaliste.

Le callback doit rester minimal, authentifié, non réentrant et séparé du traitement permissionless. Aucun pseudo-hasard basé uniquement sur `blockhash`, timestamp, prevrandao ou l’adresse de l’appelant.

### Boucle `$FWA` et liquidité

Le FWA courant utilise un token de rewards et un hook Uniswap v4. Vérifie si une stack Uniswap v4 canonique et exploitable existe réellement sur HyperEVM. Si elle n’existe pas, compare :

1. déployer la stack canonique v4 nécessaire sur HyperEVM ;
2. porter l’économie sur un DEX HyperEVM existant ;
3. isoler temporairement le sous-système rewards/token.

Les options 2 et 3 ne sont pas des forks exacts. Ne les implémente pas sans arbitrage explicite.

## Phase 0 — reconstruction forensique obligatoire

Avant de coder le port :

1. récupère toutes les sources vérifiées, métadonnées de compilation, versions, librairies, constructor args et ABIs ;
2. identifie proxies, immutables, owners, guardians, rôles, allowlists et dépendances ;
3. relève les paramètres onchain et leurs valeurs courantes ;
4. reconstruis les machines d’état : listing, pondération, acquisition, VRF, settlement, retraits, rewards et buybacks ;
5. classe chaque contrat en `core`, `rewards`, `infrastructure`, `launch-only` ou `legacy migration` ;
6. détermine si `FWAClaim` et les mécanismes v1 sont nécessaires à une nouvelle saison sans historique ; ne les supprime pas silencieusement ;
7. crée `FWA_ETHEREUM_REFERENCE/` contenant les sources brutes non modifiées ;
8. crée `FWA_PARITY_MANIFEST.md` avec, pour chaque composant, adresse, bytecode hash, source, rôle, paramètres et équivalent HyperEVM.

## Matrice de parité obligatoire

Crée un tableau avec les colonnes :

`Composant | Ethereum source | Comportement exact | Dépendance Ethereum | Équivalent HyperEVM | Divergence | Risque | Décision requise | Test de parité`

Elle doit couvrir au minimum :

- custody ERC-721 et collections ;
- backing natif ;
- formule de poids et sélection ;
- pricing et surcharge dynamique ;
- demandes simultanées et traitement du hasard ;
- frais déposants/protocole ;
- settlement et fenêtres temporelles ;
- retraits et modes de sécurité ;
- whitelist ;
- `$FWA`, émissions, rewards acquéreurs/déposants ;
- hook et marché secondaire ;
- buybacks et splitter ;
- indexation et bots permissionless ;
- rôles administratifs.

## Stratégie d’implémentation

Utilise Foundry et conserve deux couches clairement séparées :

- une copie de référence Ethereum strictement intacte ;
- le port HyperEVM avec uniquement les adaptations documentées.

Ordre :

1. reconstruction et manifeste de parité ;
2. tests différentiels sur un fork Ethereum contre les contrats déployés ;
3. RFC des adaptations HyperEVM et arbitrage des blockers ;
4. port des contrats core NFT ;
5. adaptateur de hasard HyperEVM ;
6. rewards/token/liquidité ;
7. scripts de déploiement déterministes ;
8. HyperEVM testnet ;
9. indexer et bots ;
10. frontend fidèle, avec HYPE et réseau 998/999 ;
11. fuzzing, invariants, analyse statique, audit et lancement limité.

## Tests minimaux

- tests différentiels contre Ethereum pour toutes les fonctions reproductibles ;
- golden traces des principaux parcours FWA ;
- conservation stricte des passifs HYPE ;
- aucune perte ni double transfert de NFT ;
- sélection et pricing identiques à paramètres égaux ;
- callbacks hors ordre, dupliqués, tardifs et invalides ;
- plusieurs acquisitions en vol ;
- collections ERC-721 hostiles, callbacks et réentrance ;
- fee recipients ou utilisateurs qui refusent HYPE ;
- pausing et chemins de sortie ;
- limites de gas dans les small blocks et big blocks HyperEVM ;
- tests end-to-end sur chain ID 998 avant toute proposition mainnet.

## Collections HyperEVM

Ne choisis pas les collections au hasard. Dresse un inventaire actuel des collections ERC-721 HyperEVM avec : adresse vérifiée, supply, holders, activité, liquidité, royalties, comportement des transferts et risques techniques. Propose une allowlist initiale courte et des caps faibles, puis demande validation.

## Frontend et indexation

Reproduis les parcours de FWA : exploration du pool, dépôt NFT + backing HYPE, gestion des positions, acquisition, suivi du hasard, settlement, claims et rewards. Le frontend doit clairement distinguer HyperCore de HyperEVM et ne jamais afficher ETH à la place de HYPE.

Le RPC officiel HyperEVM n’étant pas conçu pour toutes les lectures historiques, utilise un indexer événementiel et un RPC archival. Les vues critiques doivent rester vérifiables directement onchain.

## Règles de travail

- Ne réutilise pas les contrats de l’ancien fork memecoin : ils répondent à un autre produit.
- Ne commence pas par le frontend.
- Ne modifie pas l’économie pour « simplifier » le port.
- Ne considère pas une adresse communautaire comme canonique sans preuve.
- Ne déploie rien en mainnet pendant cette phase.
- Conserve les sources récupérées telles quelles et documente chaque patch.
- Avance de manière autonome sur les tâches non bloquées, mais arrête-toi avant toute divergence de parité nécessitant une décision produit.

## Première réponse attendue

Commence par :

1. confirmer que l’ancien projet memecoin est hors scope ;
2. vérifier les adresses FWA et les paramètres HyperEVM ci-dessus ;
3. produire un premier manifeste des composants FWA ;
4. identifier les blockers réels du hasard et d’Uniswap v4 ;
5. poser uniquement les décisions qui empêchent réellement un fork fidèle ;
6. proposer le plan d’exécution concret sans commencer par une réécriture approximative.
