# Plan complet de mise en production HWA

> Historical planning baseline. The finding states and test counts below predate the completed
> remediation passes. For the current candidate use
> `release/HWA_PRELAUNCH_READINESS_2026-07-27.md`, the latest audit closure reports and
> `release/release-gate-last-run.json`.

Date de référence : 27 juillet 2026  
Cible : HyperEVM mainnet, chain ID `999`, liquidité HWA/wHYPE sur Project X  
Token public : `Hyper World Assets` / `$HWA` / 18 décimales  
Statut actuel : **NO-GO mainnet — GO pour remédiation, testnet v2 et re-audit**  
Autorisation : ce document ne déclenche ni broadcast ni déploiement mainnet.

## 1. Résumé exécutif

Le produit n'est pas à reconstruire. La mécanique FWA, les contrats HyperEVM, le chemin Project X, le frontend, l'indexeur, les scripts de release et les tests sont déjà largement préparés.

Le dernier gate reproductible est `prepared` :

- 154 tests Solidity passés ;
- 2 tests fork contre les contrats Project X mainnet ;
- 4 tests fork V3 de compatibilité sur HyperEVM testnet ;
- 53 tests frontend Vitest ;
- 36 tests Playwright ;
- builds frontend et indexeur passés ;
- attestations live 998 core, randomness et marché V3 passées ;
- aucun broadcast mainnet ;
- un skip attendu : build indexeur mainnet, puisqu'aucun manifeste chain 999 n'existe encore.

La production reste bloquée par quatre catégories de travail :

1. fermer ou accepter explicitement les findings encore ouverts ;
2. redéployer un **testnet v2** avec le bytecode final — le déploiement 998 actuel précède les derniers correctifs ;
3. figer les paramètres irréversibles, les collections et les rôles ;
4. installer puis tester l'infrastructure de production : Safe, RPC logs, indexeur, submitters drand, monitoring et domaine.

Chemin critique :

`remédiations` → `testnet v2` → `E2E réel` → `re-audit indépendant` → `freeze` → `déploiement mainnet fermé` → `canary` → `ouverture progressive`.

## 2. Définition exacte de « prêt pour la production »

HWA est prêt uniquement lorsque toutes les conditions suivantes sont vraies :

- aucun finding Critical ou High ouvert ;
- aucun Medium susceptible d'affecter les fonds, la fairness, les fenêtres de settlement ou les pouvoirs admin sans décision documentée ;
- le re-auditeur indépendant valide le commit et le manifeste exacts destinés au mainnet ;
- un testnet v2 exécute le flux complet avec le même bytecode que le candidat mainnet ;
- les contrats Project X mainnet et leurs paramètres sont ré-attestés au bloc de lancement ;
- le Safe, les signers, les recipients et les rôles sont vérifiés ;
- deux submitters drand indépendants sont opérationnels et monitorés ;
- le RPC principal, le RPC logs/archives et l'indexeur production sont testés sous panne ;
- le manifeste chain 999 est généré depuis les receipts réels ;
- le gate `TestReleaseCandidate.ps1 -MainnetMode` passe sans skip ;
- les sources sont vérifiées sur l'explorer ;
- le canary mainnet est validé alors que les acquisitions et les achats publics de HWA restent fermés ;
- l'ouverture des acquisitions et celle des achats publics de HWA restent deux décisions manuelles séparées.

## 3. Ce qui est déjà prêt

### Produit et contrats

- parité FWA documentée et architecture HyperEVM implémentée ;
- dépôt, allocation, acquisition aléatoire, quatre règlements acheteur, règlement déposant, rewards et Splitter ;
- HWA à supply fixe et lancement Project X V3 avec LP verrouillée ;
- achats publics du token fermés au lancement et activables manuellement, comme demandé ;
- buyback permissionless corrigé avec TWAP Project X 30 minutes et limites dynamiques ;
- randomness mainnet prévue via `DrandEvmnetRegistry` et `DrandBN254Coordinator`, preuve BN254 vérifiée on-chain ;
- anciens chemins Gelato, Proof of Play et relay testnet interdits sur chain 999 ;
- contrat optionnel `HWAGenesisNFT` déjà présent et testé.

### Application et opérations

- frontend connecté aux contrats, parcours wallet, dépôt, pool, acquisition et settlement ;
- indexeur déterministe et fallback d'urgence borné ;
- scripts de déploiement, vérification, génération de manifeste et promotion ;
- protections contre un lancement au mauvais prix : double saisie, bande FDV et confirmations explicites ;
- runbook mainnet fail-closed et release gate sans broadcast automatique.

## 4. Phase 1 — Fermer le scope sécurité avant le nouveau testnet

Objectif : produire un commit `release-candidate-1` sans dette de sécurité ambiguë.

### P0 — bloquants directs

| Finding | État | Travail restant | Critère de fermeture |
|---|---|---|---|
| `F5F-006` buyback statique | Corrigé techniquement | Re-audit du TWAP 30 min, min-out et limite de prix sur fork Project X réel | Auditeur valide le correctif et son test fork |
| `F5F-015` scan logs inutilisable | Corrigé côté code, ouvert côté infra | Choisir un RPC logs/archives, confirmer sa plage réelle, tester checkpoint/reprise et panne indexeur | Test réel sur le fournisseur et gate mainnet vert |
| `F5F-009` pool pré-initialisable | Ouvert | Rendre factory + token + création/initialisation/LP réellement indivisibles dans une transaction, ou utiliser un CREATE2 avec secret non exposé | Test adversarial : pré-calcul/pré-initialisation impossible |
| `F5F-011` rescue rewards | Ouvert | Limiter le rescue au surplus comptable non dû, ou imposer un wind-down irréversible avec délai de claim | Les HWA gagnés mais non claimés ne sont jamais drainables |
| `F5F-013` fenêtres rétroactives | Ouvert | Snapshot des fenêtres purchaser/finalize dans chaque listing à l'allocation ; setters bornés pour le futur seulement | Une modification admin ne change aucun listing existant |
| `F5F-014` attestation drand | Ouvert | Comparer l'adresse Registry et les quatre coordonnées de `publicKey()`, pas seulement un chain hash décoratif | Le vérifieur échoue sur une clé ou Registry différente |

### P1 — fairness, indexation et backend

| Finding | Travail recommandé | Critère de fermeture |
|---|---|---|
| `F5F-007` liveness/fairness | Deux submitters indépendants, alertes avant deadline, correction du runbook : leur liveness est un contrôle de fairness | Simulation d'arrêt d'un submitter, second submitter respecte toutes les deadlines |
| `F5F-008` round déjà public | Refuser un round cible déjà prouvé/public dans la Registry ; documenter l'hypothèse de timestamp HyperEVM | Test fail-closed sur target round déjà disponible |
| `F5F-010` rate limiter | Utiliser l'IP d'un proxy de confiance et une structure LRU bornée avec éviction | Tests spoofing, mémoire bornée et charge |
| `F5F-012` revenus Splitter invisibles | Indexer la collection snapshot et exposer claims/expiration dans l'UI ; fallback `ownerOf` borné si nécessaire | Un holder voit et claim ses revenus même après reconstruction de l'index |

### P2 — lows à supprimer avant le freeze

La recommandation est de ne pas transporter ces défauts jusqu'au mainnet puisqu'ils sont bornés et peu coûteux à corriger :

- `F5F-016` : classification CIDR canonique de toutes les plages IPv6 privées/spéciales ;
- `F5F-017` : DNS pinning pour empêcher le rebinding SSRF ;
- `F5F-018` : rendre les tests SSRF et BN254 réellement adversariaux ;
- `F5F-019` : supprimer les helpers G2 inutilisés ou ajouter le contrôle de sous-groupe ;
- `F5F-020` : corriger l'arrondi de tick à la frontière exacte ;
- `F5F-022` : lead time minimal du Splitter, refus de `renounceOwnership`, événement post-close ;
- `F5F-023` : promotion vérifiée on-chain et reporting explicite des tentatives de broadcast rejetées ;
- `F5F-025` : corriger le message `AlreadyFrozen`, le cache HTTP 422, les valeurs indexeur non recoupées et les helpers vendored atteignables.

### Décision économique obligatoire — `F5F-021`

Choix recommandé pour rester cohérent avec le split annoncé :

- ne pas consommer l'horloge d'émission lorsqu'aucun listing n'est actif ;
- brûler la part purchaser d'une époque vide, comme la route depositor vide, au lieu de la rendre sweepable par l'owner.

Le comportement retenu doit être figé avant le testnet v2, testé et ajouté au manifeste de parité.

### Tests supplémentaires de cette phase

- invariant stateful propre au Splitter : conservation, claims dupliqués, sweep et wind-down ;
- invariants rewards avec rescue/surplus et époques vides ;
- fuzz des fenêtres snapshotées et des changements de paramètres ;
- test adversarial de pré-initialisation du pool ;
- vrais vecteurs négatifs BN254 ;
- tests de charge metadata et log discovery ;
- nouveau manifeste d'audit généré après freeze, avec raison et hash précédent.

**Gate Phase 1 :** tous les tests locaux et forks passent ; aucun P0/P1 non décidé ; arbre gelé pour l'audit.

## 5. Phase 2 — Figer le produit et les paramètres irréversibles

### 5.1 Tokenomics HWA

La configuration actuelle à confirmer est :

- supply totale : `1 000 000 000 HWA` ;
- LP Project X verrouillée : `800 000 000 HWA` ;
- réserve saisonnière totale : `100 000 000 HWA`, plafonnée à 50 M / 30 M / 20 M sur trois saisons de 15 jours ;
- allocation écosystème : `100 000 000 HWA` dans un vesting immuable de 24 mois avec cliff de 3 mois ;
- pool HWA/wHYPE Project X, fee tier 1 %, tick spacing 200 ;
- achats publics fermés au déploiement, ouverture manuelle ultérieure ;
- LP non retirable ; destinataire des fees modifiable uniquement selon la politique Safe retenue.

À signer dans une fiche de lancement : prix initial, FDV min/max, largeur de range et politique de buyback. Le lancement Project X est one-sided avec `0 HYPE` dans la LP ; le plafond opérationnel global est `20 HYPE`. Le beneficiary du vesting et le recipient des fees sont l'owner EOA attestÃ©.

### 5.2 Collections NFT

Les collections HyperEVM existantes suffisent pour lancer le gameplay. Ordre recommandé :

1. Hypios ;
2. PiP & Friends ;
3. Odd Otties ;
4. Catbal ;
5. Hypurr ensuite, avec cap faible et backing élevé à cause de sa valeur.

Pour chacune : vérifier l'adresse du contrat depuis une source primaire, le standard ERC-721, la supply, les métadonnées, la politique de transfert, le floor indicatif, le backing minimum et l'exposition maximale par collection.

### 5.3 Collection HWA Genesis — décision produit

Elle n'est pas nécessaire pour remplir le pool, mais elle est désormais retenue comme collection
d'identité et snapshot du Splitter. La collection finale est `Pressure Field` v3, renderer
`HWA-GEN-3.0.0`, supply `333`, aggregate
`96b80e5c8a06b07407d92b58dbf7865aab242439bdfdb5d8436e370cd2915648`.

Décision figée :

- supply exacte de 333 ;
- distribution gratuite/airdrop, pas de vente destinée à financer le pool ;
- metadata permanente et redondée ;
- mint terminé puis `freezeSnapshot()` irréversible ;
- ne pas la présenter comme du « mauvais loot » artificiel.

L'art est approuvé. Restent bloquants : double pin/vérification des images, génération des fichiers
metadata contract-compatibles `1..333` sans extension, double pin metadata et freeze du baseURI.

### 5.4 Gouvernance et rôles

Figer :

- adresse du Safe mainnet ;
- seuil et liste des signers sur hardware wallets ;
- owner final de chaque contrat ;
- operator/guardian et limites exactes de leurs pouvoirs ;
- fee recipient Project X ;
- beneficiary du vesting immuable de 100 M ;
- deux wallets submitters drand, séparés du deployer ;
- politique de timelock pour les changements sensibles ;
- wallet canary faiblement financé.

**Gate Phase 2 :** fiche de paramètres signée, adresses checksumées deux fois, aucune valeur irréversible laissée « TBD ».

## 6. Phase 3 — Déployer le testnet v2 final

Le déploiement 998 actuel reste un historique utile, mais il ne contient pas tous les derniers correctifs. Il faut déployer une stack v2 fraîche et mettre à jour le manifeste 998 sans supprimer l'ancienne documentation.

### Ordre

1. déployer éventuellement HWA Genesis/fixtures ;
2. déployer et configurer le Splitter ;
3. déployer Registry/Coordinator test approprié, VRF service, core et whitelist ;
4. déployer HWA, pool V3 ABI-compatible, LP locker, adapter et rewards ;
5. lier core, rewards, token, adapter et Splitter ;
6. transférer les owners testnet aux rôles de test ;
7. laisser acquisitions et achats publics fermés ;
8. générer un nouveau manifeste `hyperevm-testnet-998.json` depuis les receipts ;
9. redéployer/reconfigurer indexeur et frontend sur ce manifeste ;
10. exécuter toutes les attestations live.

Project X n'a pas de déploiement officiel 998 connu : le testnet valide donc l'ABI et les flux avec la venue V3 compatible ; les propriétés Project X réelles restent couvertes par fork chain 999.

### Matrice E2E testnet v2

- au moins trois wallets et plusieurs NFT fixtures/collections ;
- dépôt simple, batch et refus d'une collection non allowlistée ;
- acquisitions quantité 1 et quantité maximale ;
- requêtes concurrentes et callbacks hors ordre ;
- expiration, retry, refund et absence d'un submitter ;
- quatre sorties purchaser : keep NFT, auto-relist, accept HYPE, accept HWA ;
- sorties depositor : vente, retrait, refund et finalisation ;
- rewards depositor/purchaser, epoch vide, claims et Splitter ;
- arrêt/reprise, withdraw-only et comportement sous NFT hostile ;
- HWA public buy fermé, vente autorisée selon la spec, ouverture manuelle puis achat ;
- buyback après maturation de l'oracle 30 min et après déplacement de prix ;
- indexeur arrêté : lecture dégradée et sortie via RPC logs dédié ;
- wallet sur mauvaise chain, RPC principal coupé, resynchronisation et reprise de transaction ;
- responsive mobile/tablette/desktop pour tous les drawers, animations et états d'attente.

Pour éviter d'attendre sept jours à chaque itération : tests locaux/fork avec `warp` sur les paramètres exacts mainnet, plus un lane live 998 accéléré pour l'exploitation. Avant le mainnet, exécuter au moins un cycle live avec les paramètres de release ou documenter précisément les étapes couvertes par fork.

**Gate Phase 3 :** nouveau déploiement 998 attesté, toutes les branches E2E couvertes, aucune dépendance à l'ancien manifeste.

## 7. Phase 4 — Re-audit indépendant

L'audit doit viser le commit et le manifeste exacts issus du testnet v2.

Scope minimal :

- tous les contrats de production, y compris vendor/remappings ;
- factory et atomicité de lancement Project X ;
- HWA, oracle TWAP, buyback, direction de swap et locker LP ;
- core FWA, settlement, comptabilité et insolvabilité ;
- rewards, rescue, émissions, epochs vides et Splitter ;
- Registry/BN254/hash-to-curve/constantes evmnet et vecteurs officiels ;
- scripts de déploiement, owner actions, manifests et gate ;
- indexeur, metadata SSRF/rate limit et fallback logs ;
- frontend sur les actions générant une transaction.

Critères :

- zéro Critical/High ;
- Mediums corrigés ou acceptés un par un avec justification, impact et monitoring ;
- re-tests des remédiations par l'auditeur ;
- rapport final lié au hash du commit et au root hash du manifeste d'audit ;
- aucun changement de code pendant la fenêtre d'audit ; toute modification impose une delta review.

**Gate Phase 4 :** rapport final signé et tableau de findings fermé.

## 8. Phase 5 — Infrastructure production

### RPC et indexation

- choisir un RPC chain 999 principal avec SLA ;
- choisir un endpoint distinct logs/archives supportant au moins 10 000 blocs par requête, ou adapter le seuil du gate à sa limite vérifiée ;
- tester `eth_getLogs`, latence, rate limit, historique complet et reprise par checkpoint ;
- déployer l'indexeur production depuis le manifeste 999 ;
- alertes sur lag, divergence, reorg, erreurs metadata et solde des services.

### Randomness

- déployer `DrandEvmnetRegistry` et `DrandBN254Coordinator` mainnet ;
- vérifier clé publique, DST, chain hash et preuves officielles ;
- faire tourner deux submitters sur infrastructures et clés séparées ;
- financer séparément les submitters et la réserve de bounty ;
- alertes sur round non prouvé, request proche de l'expiry, réserves faibles et divergence ;
- runbook manuel permettant à un tiers de soumettre une preuve publique.

### Frontend, metadata et domaine

- domaine final, DNS, TLS, CDN ;
- CSP, HSTS, headers anti-clickjacking et politique CORS ;
- IPFS/stockage metadata redondé et allowlist strictement bornée ;
- URL Project X officielle ;
- environnement production sans secret dans le bundle ;
- analytics minimales sur les étapes du funnel et les erreurs, sans mock data ;
- page de statut et message fail-closed si indexeur/RPC indisponible.

### Monitoring et incident response

- dashboard : liabilities HYPE, active listings, acquisitions pendantes, deadlines randomness, HWA rewards, Splitter, oracle readiness, LP et indexer lag ;
- alertes 24/7 et procédure d'escalade ;
- tests documentés : acquisitions off, public buys off, withdraw-only, pause indexeur, bascule RPC ;
- sauvegarde des manifests, receipts, source bundles et configurations publiques ;
- aucune private key de production dans `.env` partagé ou dans un processus npm.

**Gate Phase 5 :** exercice de panne réussi et toutes les alertes reçues par au moins deux opérateurs.

## 9. Phase 6 — Freeze et répétition générale mainnet

1. geler la branche, créer le tag release et régénérer `release/audit-manifest.json` ;
2. refaire les tests avec installation propre ;
3. ré-attester les adresses officielles Project X, owner de factory, router, NFPM, wHYPE, fee tier 1 %, tick spacing 200 et `feeProtocol` ;
4. calculer deux fois le sqrt price, le tick, la range, le ratio HWA/HYPE et la FDV ;
5. simuler chaque transaction et multisend Safe sur un fork au bloc récent ;
6. préparer `.env.mainnet.local` hors racine du workspace et scrubber les secrets avant npm/node ;
7. générer les calldatas, ordonner les nonces et faire une revue à quatre yeux ;
8. vérifier soldes HYPE, frais de gas, recipients et code déployé du Safe ;
9. définir fenêtre de lancement et règle d'abandon si un prérequis change.

**Gate Phase 6 :** simulation identique deux fois, aucun drift, checklist signée par deployer et second reviewer.

## 10. Phase 7 — Déploiement mainnet fail-closed

Ordre recommandé :

1. HWA Genesis si retenu : mint, metadata, distribution, puis freeze snapshot ;
2. Splitter ;
3. Registry drand, Coordinator BN254, VRF service, core FWA et whitelist ;
4. HWA + pool Project X + initialisation + LP définitivement verrouillée via le chemin atomique corrigé ;
5. adapter et rewards ;
6. financement de la rÃ©serve saisonniÃ¨re de 100 M et du vesting Ã©cosystÃ¨me de 100 M ;
7. bindings core/rewards/token/adapter/Splitter ;
8. transfert de tous les owners au Safe ;
9. vérification bytecode, immutables, rôles, balances et LP NFT ;
10. vérification des sources sur l'explorer ;
11. écriture du manifeste chain 999 depuis les receipts ;
12. déploiement de l'indexeur et du frontend en mode fermé/read-only.

État obligatoire à la fin du déploiement :

- acquisitions fermées ;
- achats publics HWA fermés ;
- pool vide côté gameplay ;
- aucun reward clock démarré prématurément ;
- randomness et indexeur observables ;
- owner de chaque module = Safe attendu ;
- LP verrouillée et non récupérable.

Puis exécuter :

`scripts/TestReleaseCandidate.ps1 -CleanInstall -MainnetMode -MainnetEnvPath .env.mainnet.local`

Le résultat doit être `passed`, sans skip, avec build indexeur 999 et attestations live 999. Aucun flag auto-déclaré ne remplace une lecture on-chain.

## 11. Phase 8 — Canary mainnet fermé

Ne pas promouvoir publiquement immédiatement après le déploiement.

- prouver un round drand récent et observer les deux submitters ;
- vérifier l'oracle Project X après sa fenêtre de maturation ;
- allowlister une collection canary à faible risque et cap strict ;
- exécuter un dépôt et une acquisition avec deux wallets contrôlés ;
- vérifier UI, indexeur, événements, randomness, settlement, rewards et Splitter ;
- couper l'indexeur et le RPC principal pour tester le mode dégradé ;
- tester la fermeture d'urgence et le withdraw-only ;
- rapprocher soldes on-chain et liabilities après chaque action.

Durée recommandée : 24 à 72 heures d'observation, selon l'activité et les fenêtres testées.

**Gate Phase 8 :** aucun écart comptable, aucun événement manquant, aucune requête randomness hors délai, aucun pouvoir inattendu.

## 12. Phase 9 — Ouverture progressive

Lancement en deux switches indépendants :

### Étape A — gameplay NFT

- ouvrir les acquisitions avec batch max faible et caps par collection ;
- commencer par Hypios, PiP, Odd Otties et Catbal ;
- surveiller exposition, backing moyen, taux de settlement et erreurs metadata ;
- ajouter Hypurr uniquement après stabilité, avec paramètres conservateurs.

### Étape B — marché public HWA

- conserver les achats publics fermés pendant la validation initiale si nécessaire ;
- annoncer clairement la date/condition d'ouverture ;
- activer manuellement les public buys par Safe après checkpoint ;
- vérifier immédiatement un achat, une vente et un buyback ;
- aucune réouverture automatique ni timer caché.

Les acquisitions peuvent être refermées sans nécessairement fermer le marché HWA, et inversement, selon les pouvoirs exacts figés dans la spec.

## 13. Phase 10 — Exploitation après lancement

### Première heure

- monitoring continu des events, RPC, indexeur, pool, oracle et submitters ;
- rapprochement de chaque acquisition et règlement ;
- aucun changement de paramètre non prévu.

### Premières 24 heures

- rapport toutes les 2 à 4 heures : volume, listings, randomness, claims, liabilities, HWA et errors ;
- collecte des retours UX ;
- caps conservateurs tant que toutes les branches ne sont pas observées.

### Première semaine

- revue quotidienne des balances et événements ;
- revue des collections et métadonnées ;
- simulation d'incident ;
- post-mortem immédiat pour tout deadline manqué ou divergence indexeur/on-chain ;
- delta-audit avant toute modification contractuelle ou migration.

## 14. Décisions encore attendues

| Décision | Moment limite | Recommandation actuelle |
|---|---|---|
| Créer HWA Genesis | Avant déploiement Splitter mainnet | Décidé : 333 au Safe en custody, URI finale à valider, puis snapshot gelé |
| Liste initiale de collections | Avant testnet v2 final | Hypios, PiP, Odd Otties, Catbal ; Hypurr ensuite |
| Routage époque vide `F5F-021` | Avant code freeze | Burn cohérent et horloge suspendue sans listing |
| Safe, signers, seuil | Avant répétition mainnet | Préparé : Safe déterministe 2-sur-3 ; déploiement et attestation restent à faire |
| Beneficiary vesting 100 M et fees LP | Avant génération des calldatas | Décidé : owner EOA attesté |
| Prix, FDV, range | À la cérémonie de freeze | Proposition 640 HYPE, bande 600–700 ; fiche à confirmer et vérifier deux fois |
| RPC logs/archives | Avant testnet v2 fallback puis mainnet gate | Endpoint distinct, historique complet, plage testée ≥10k |
| Timing d'ouverture public buys | Après canary | Manuel et séparé des acquisitions |

## 15. Planning indicatif

Ces durées sont des ordres de grandeur, pas une date promise :

- remédiations et tests ciblés : 3 à 6 jours de travail ;
- testnet v2, indexeur/frontend et E2E : 2 à 4 jours, hors éventuelle observation en temps réel ;
- audit indépendant et retours : 4 à 10 jours selon disponibilité ;
- infrastructure production et répétition : 2 à 5 jours, parallélisables avec l'audit ;
- canary fermé : 1 à 3 jours ;
- ouverture progressive : après validation du canary.

Chemin raisonnable sans finding majeur supplémentaire : environ 2 à 3 semaines calendaires. Le facteur principal est l'audit indépendant, pas l'implémentation restante.

## 16. Prochaines actions, dans l'ordre

1. implémenter `F5F-009`, `F5F-011`, `F5F-013`, `F5F-014`, puis `F5F-007/008/010/012` ;
2. trancher `F5F-021` et HWA Genesis ;
3. fermer les Low techniques et renforcer les tests ;
4. sélectionner et tester le RPC logs/archives ;
5. lancer la gate complète et geler `release-candidate-1` ;
6. déployer la stack testnet v2 sans ouverture ;
7. exécuter la matrice E2E et corriger les écarts ;
8. remettre le commit et le manifeste figés à l'auditeur indépendant ;
9. préparer en parallèle Safe, submitters, indexeur, domaine et monitoring ;
10. après audit vert uniquement : répétition mainnet, déploiement fermé, canary, puis ouverture progressive.

## 17. Verdict actuel

- **Contrats et app :** release candidate avancé, pas encore final.
- **Testnet actuel :** fonctionnel pour attestation historique, mais à remplacer par un v2 contenant tous les correctifs.
- **Mainnet :** **NO-GO aujourd'hui**.
- **Prochaine milestone mesurable :** testnet v2 complet + aucun finding P0/P1 ouvert + fallback logs réel validé.

Documents de référence actifs :

- `MAINNET_RELEASE_RUNBOOK_2026-07-26.md`
- `PROJECTX_MAINNET_READINESS_REPORT_2026-07-26.md`
- `FWA_PARITY_MANIFEST.md`
- `release/FABLE5_FOLLOWUP_MAINNET_VERDICT_2026-07-27.md`
- `release/CODEX_FABLE5_FOLLOWUP_REMEDIATION_2026-07-27.md`
- `release/release-gate-last-run.json`
- `release/audit-manifest.json`
