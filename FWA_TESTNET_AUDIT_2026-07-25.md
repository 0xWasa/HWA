# FWA HyperEVM — audit de préparation testnet

> **ARCHIVÉ / SUPERSEDED.** Cet audit couvre l'ancien déploiement Nest. La release candidate active est documentée dans `PROJECTX_MAINNET_READINESS_REPORT_2026-07-26.md` et `release/testnet-attestation-projectx-998.json`.

Date : 2026-07-25  
Réseau audité : HyperEVM testnet, chain ID `998`  
Périmètre : contrats FWA, adaptations HyperEVM, drand, modules Nest, scripts de déploiement/vérification et frontend Fable 5. Le juridique est hors périmètre.

## Conclusion

Le système est prêt pour une campagne testnet supervisée depuis le frontend. Aucun défaut critique exploitable n'a été identifié dans les contrats déployés. Les dépôts, retraits, acquisitions, règlements, rewards, splitter et modules Nest ont une implémentation et une couverture de tests fonctionnelles.

Les acquisitions et les swaps publics restent volontairement fermés dans la configuration du site :

- le coordinateur drand de testnet repose sur un relayeur autorisé et ne vérifie pas la signature BLS on-chain ;
- le pool Nest de chain 998 est un harness déterministe de compatibilité, pas un marché Nest officiel.

Cette configuration est correcte pour le testnet supervisé, mais ces deux composants ne doivent pas être présentés comme prêts pour le mainnet.

## Déploiement vérifié

| Composant | Adresse 998 |
|---|---|
| FWA core | `0xeE5D51211422606815A71B7b2aD73f732ee6630F` |
| Drand coordinator | `0xC33993a5f27Ea62bca91D59D1a55E386cF1272CF` |
| VRF service | `0x982A8CbafD79FbF36262873124830873e166Aa62` |
| Whitelist | `0x6c74EE11F680Ef1503bc26115b85F44fDCA6F805` |
| SplitterHyperEVM | `0x2c79f69877254BC78bBFD9d6be07bB528985452c` |
| FWA rewards | `0x0abA952fC5abD9fdb67e57AE36F6C0E905FD7a3e` |
| `$FWA` | `0x41514C9043D7382088F3EEE5A6344dBc55879C5B` |
| Nest adapter | `0xC7D0B6640cDe80816e43eF8a6D29d3F87e18A167` |
| Nest harness pool | `0x2A8aa2976EDc75d7248E04e69049Bfbb874f6e0f` |
| Nest plugin | `0xa651d0569D80c7810dbe404faF6b4387E3a9f98D` |
| Liquidity locker | `0xF4b86F1BA485bE25F322df3eDF5E41d3a22e35b4` |
| NFT gameplay testnet | `0x0ACD941969228976Fc3FaE6c6560c1230d54F74a` |

Le manifeste consommé par le site est `frontend/public/deployments/hyperevm-testnet-998.json`. Il garde `acquisitionsEnabled=false` et `dexMode=nest-test-harness` tant qu'une session supervisée n'est pas ouverte.

## Résultats des contrôles

### Contrats

- `forge test --summary` : **82/82 tests réussis**.
- `forge fmt --check` : réussi.
- `forge lint --severity high` : aucun finding high dans les contrats ; les seuls avertissements observés concernent des transferts ERC-20 non vérifiés dans des tests.
- vérification live drand : réussie.
- vérification live Nest : réussie après correction du vérificateur pour accepter une supply inférieure à la supply initiale à cause des burns de buyback.
- tous les contrats cibles sont sous la limite EIP-170. Deux scripts Solidity de déploiement dépassent cette limite en bytecode, sans effet sur les contrats effectivement déployés.

### Frontend Fable 5

- TypeScript strict : réussi.
- ESLint : réussi.
- Vitest : **38/38 tests réussis**, dont le cas de timestamp indisponible.
- Playwright mock : **26/26 parcours réussis**.
- build Next production : réussi après gel.
- contrôle navigateur live : manifeste 998 chargé, lectures RPC opérationnelles, listing historique et outcome `NFT reward` reconstruits, rewards lisibles, dépôt accessible après connexion.

## Findings ouverts

| ID | Sévérité | Finding | Décision testnet | Condition mainnet |
|---|---|---|---|---|
| AUD-01 | Haute | Le coordinateur drand 998 fait confiance au relayeur autorisé ; celui-ci peut fournir une valeur arbitraire car la BLS drand n'est pas vérifiée on-chain. | Accepté uniquement pendant une session supervisée et annoncée comme testnet. | Remplacer par un mécanisme vérifiable/on-chain ou un fournisseur VRF avec garanties compatibles. |
| AUD-02 | Haute | Le pool Nest 998 est un harness déterministe non officiel ; ce n'est pas de la price discovery. | Swaps publics bloqués dans le client et dans l'UI. | Déployer sur les contrats officiels Nest et revalider adapter, plugin, locker, quoter et router. |
| AUD-03 | Moyenne | Les rôles owner/relayer peuvent ouvrir les acquisitions, modifier certains paramètres et administrer les modules. | Wallet de test dédié acceptable. | Multisig, séparation des rôles, procédure de pause et monitoring. |
| AUD-04 | Moyenne | Le splitter conserve la sémantique FWA `ownerOf` au snapshot. Une collection qui permet de remint un token ID brûlé pourrait modifier l'éligibilité après le snapshot. | La collection snapshot testée avait 4/4 IDs existants ; pas d'exploitation live observée. | N'utiliser qu'une collection non remintable ou figer explicitement l'adaptation avant le déploiement final. |
| AUD-05 | Moyenne | `npm audit --omit=dev` signale 26 advisories transitives : 5 high et 21 moderate, principalement Next/PostCSS/sharp et les connecteurs wagmi/WalletConnect. Les remédiations proposées imposent actuellement des changements majeurs incohérents (`next@9` ou `wagmi@3`). | Accepté pour le testnet local ; aucune mise à jour `--force`. | Refaire l'arbre de dépendances, mettre à niveau sur versions corrigées et rerun complet avant exposition publique. |
| AUD-06 | Faible | Aucun indexeur événementiel n'est branché. Les vues d'état directes fonctionnent, mais Activity et les statistiques historiques complètes sont indisponibles. | UI affiche explicitement « Activity indexer not connected ». | Indexeur bornant `eth_getLogs` à 50 blocs par requête, checkpoints et réconciliation RPC. |

## Correctifs appliqués pendant l'audit

- branchement réel de `ViemProtocolClient` au manifeste 998 et aux wallets injectés ;
- implémentation des lectures listings, positions, tickets, rewards, balances et marché `$FWA` ;
- implémentation des writes : approve, list, withdraw, acquire/batch, règlements, récupération et claims ;
- suivi des receipts et reprise des transactions après rechargement ;
- quote randomness effectuée avec un `gasPrice` explicite, réutilisé pour la transaction afin de respecter `requestFee()` ;
- contrôle de drift aligné sur `weightedBackingTotal >= minWeightedValue` ;
- swaps publics bloqués sur le harness Nest ;
- séparation des caches Next live, build et Playwright ;
- suppression de l'étape frontend « indexed » tant qu'aucun indexeur n'existe ;
- correction des outcomes de listings réglés via le propriétaire ERC-721 actuel ;
- timestamps RPC inconnus rendus comme tels, jamais comme le 1er janvier 1970.

## Séquence de test via le site

1. Laisser les acquisitions fermées et démarrer le frontend sur `http://localhost:3900`.
2. Importer le wallet test dans un wallet navigateur et ajouter HyperEVM testnet 998.
3. Vérifier les pages Pool, `$FWA`, Rewards, Activity et Deposit.
4. Démarrer le relayeur drand supervisé.
5. Ouvrir les acquisitions on-chain et passer `features.acquisitionsEnabled` à `true` dans le manifeste de la session.
6. Depuis le site : approuver un NFT gameplay, le déposer avec au moins `0.01 HYPE`, acquérir, attendre le fulfilment drand, puis tester chaque règlement.
7. Tester les chemins timeout/refund et récupération d'un ERC-721 hostile séparément.
8. Refermer les acquisitions, remettre le manifeste à `false`, vérifier qu'il n'existe plus de requête en attente, puis arrêter le relayeur.

Aucune clé privée ne doit être placée dans une variable `NEXT_PUBLIC_*`, le manifeste ou le bundle du frontend.
