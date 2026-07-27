# Randomness — drand evmnet vérifié on-chain

État au 26 juillet 2026. Le nom historique de ce fichier est conservé pour ne pas casser les liens, mais **Gelato VRF n'est plus une dépendance de production**. Le chemin mainnet utilise `DrandEvmnetRegistry` et `DrandBN254Coordinator`; toute preuve BLS est vérifiée on-chain avant qu'un mot puisse atteindre FWA.

| Réseau | Coordinateur | Autorisation |
|---|---|---|
| HyperEVM testnet 998 | `DrandRelayCoordinator` | Harness historique sans valeur, relayer authentifié mais preuve non vérifiée on-chain |
| HyperEVM mainnet 999 | `DrandBN254Coordinator` + `DrandEvmnetRegistry` | Seul chemin autorisé; soumission permissionless et preuve BN254 on-chain |

Sources primaires : [API HTTP drand](https://docs.drand.love/developer/API-v1/drand-http-api/), [vérification BLS12-381/BN254 dans l'EVM](https://docs.drand.love/blog/2025/08/26/verifying-bls12-on-ethereum/), [dépôt BLS Solidity de Randamu](https://github.com/randa-mu/bls-solidity).

## 1. Propriétés mainnet

`DrandEvmnetRegistry` épingle le chain hash, la clé publique evmnet et le DST. `submitRound` vérifie le pairing BN254, dérive `randomness = sha256(signature)` et ne met en cache que les preuves valides.

`DrandBN254Coordinator` :

- choisit un round futur après la requête;
- impose en production une marge minimale on-chain de **30 secondes** avant le round cible;
- impose les confirmations demandées par FWA et le délai minimum du round;
- n'accepte qu'un round prouvé et suffisamment récent;
- sépare le mot par chain ID, coordinateur, consumer, request ID et round;
- limite le gas du callback et conserve la requête en cas de callback échoué;
- rend les doublons idempotents;
- permet à n'importe qui d'expirer une requête abandonnée après `REQUEST_EXPIRY_BLOCKS`;
- utilise un espace d'IDs dérivé du déploiement, donc une rotation ne réutilise pas les anciens request IDs;
- rémunère le submitter depuis une réserve plafonnée, sans confier la sélection du mot au relayer.

Le relayer ne peut pas inventer un mot ni modifier le round verrouillé, mais sa **liveness est un contrôle de fairness** : si tous les opérateurs sont arrêtés, un acquéreur peut soumettre lui-même une preuve favorable et laisser expirer une preuve défavorable. Deux opérateurs réellement indépendants doivent donc surveiller chaque requête et soumettre avant la deadline; tout tiers financé peut également transporter la preuve publique.

## 2. Limite à auditer explicitement

Le code de vérification BLS vendored provient de `randa-mu/bls-solidity`, commit épinglé dans le workspace. Le dépôt amont est archivé et se présente comme expérimental/non audité. La revue cryptographique de cette implémentation, des constantes evmnet, du hash-to-curve et des vecteurs officiels est un **scope d'audit mainnet obligatoire**. Les tests avec une preuve drand officielle ne remplacent pas cette revue.

## 3. Déploiement fail-closed

1. Déployer le splitter final et figer sa répartition.
2. Dry-run `DeployHyperEVMMainnetCore`; le script déploie registry/coordinator, les lie à FWA et finance la réserve initiale.
3. Reporter `FWA_DRAND_REGISTRY_ADDRESS`, `FWA_DRAND_BN254_COORDINATOR_ADDRESS` et `FWA_DRAND_DEPLOYMENT_BLOCK` depuis les receipts.
4. Exécuter les attestations read-only :

```powershell
& .\.tools\foundry\forge.exe script script/VerifyDrandBN254Coordinator.s.sol:VerifyDrandBN254Coordinator --rpc-url hyperevm_mainnet -vv
& .\.tools\foundry\forge.exe script script/ProveDrandEvmnetRound.s.sol:ProveDrandEvmnetRound --rpc-url hyperevm_mainnet -vv
```

La seconde commande est d'abord un dry-run. Une preuve récente n'est réellement écrite qu'avec `DRAND_PROOF_SUBMISSION_CONFIRMED=true`, les champs `FWA_DRAND_ROUND`/`FWA_DRAND_SIGNATURE`, puis `--broadcast` après revue.

5. Ne générer aucun calldata d'ouverture tant que `launchReady()` est faux ou que la réserve est sous `minimumBuffer + maxFulfillmentCost`.

## 4. Relayers permissionless

Chaque opérateur utilise une clé dédiée, faiblement financée et jamais exposée au navigateur. Exemple :

```powershell
node .\.tools\drand_bn254_relayer.mjs --env-file=.env.mainnet.local --prove-latest --once
node .\.tools\drand_bn254_relayer.mjs --env-file=.env.mainnet.local
```

Le watcher :

- atteste chain ID 999 et les adresses registry/coordinator;
- scanne `RandomWordsRequested` depuis le bloc de déploiement;
- attend la finalité configurée;
- compare deux endpoints drand officiels;
- refuse toute divergence de round/signature;
- soumet la preuve et le fulfillment par les scripts Foundry avec gate explicite;
- persiste son curseur dans `.drand-bn254-relayer-state.json` (ignoré par Git).
- utilise `HYPEREVM_LOG_RPC_URL` et une plage explicitement bornée par `HYPEREVM_LOG_RPC_MAX_BLOCK_RANGE` pour la découverte ;
- émet `FAIRNESS_ALERT` lorsqu'une requête approche de sa deadline (`FWA_DRAND_FAIRNESS_ALERT_BLOCKS`).

Exploitation requise : deux instances indépendantes, clés, hôtes et RPC distincts, alertes sur âge du dernier round prouvé, pending requests, seuil fairness, expirations, réserve et callbacks échoués. `DRAND_RELAYER_REDUNDANCY_CONFIRMED=true` ne vaut qu'après observation de ces deux instances sur une acquisition réelle.

## 5. Canary et incident

Le frontend reste read-only pendant le canary. Après l'ouverture Safe : dépôt faible, acquisition depuis un second wallet, preuve drand publique, `RandomnessCached`, allocation, settlement, indexation et reload. Comparer la signature/round aux endpoints drand et le hash stocké au registry.

En incident : fermer acquisitions par le calldata Safe préparé, laisser retraits/refunds/settlements accessibles, expirer permissionlessly toute requête au-delà de sa deadline, puis réconcilier FWA. Une migration de coordinateur n'est envisagée qu'après zéro requête pending et zéro acquisition non réglée.

Les anciens `GelatoVRFCoordinator`, `DrandRelayCoordinator` et `PoPRandomnessAdapter` rejettent désormais chain 999 dans leur constructeur. Ils sont exclus du bundle de déploiement mainnet.

## 6. Tests obligatoires

- preuve officielle valide et preuve altérée;
- mauvaise clé, mauvais DST, mauvais chain hash et mauvais round;
- round futur, confirmations, staleness et expiry;
- grinding impossible : le submitter ne fournit jamais un mot libre;
- doublon idempotent, replay inter-requête/inter-chaîne impossible;
- callback revert puis retry atomique;
- expiration permissionless puis rotation sans collision d'ID;
- réserve/bounty et retrait seulement hors requête;
- lifecycle FWA `list → acquire → prove → fulfill → settle`;
- invariants stateful des liabilities et de la custody.

Le résultat reproductible est consigné dans `release/release-gate-last-run.json`.
