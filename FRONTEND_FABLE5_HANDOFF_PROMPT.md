# Prompt de handoff — frontend FWA sur HyperEVM

Tu prends en charge **uniquement le frontend** d'un fork fonctionnel de Fake World Assets (`https://www.fwa.fun/`) porté sur HyperEVM. Une autre instance Codex travaille en parallèle sur la reconstruction forensic, les contrats, les tests et les intégrations HyperEVM.

Ta mission est de concevoir puis implémenter une dApp crédible, testable et prête à être raccordée aux contrats, en conservant les parcours produit de FWA mais avec une direction artistique inspirée de l'application Hyperliquid.

Ne t'arrête pas à une proposition de maquette : construis le frontend, vérifie-le et documente son point de raccordement avec les contrats.

## 1. Workspace et sources de vérité

Workspace :

`C:\Users\eliot\Documents\FWA FORK`

Lis entièrement avant de commencer :

1. `FWA_HYPEREVM_HANDOFF_PROMPT.md`
2. `FWA_PARITY_MANIFEST.md`
3. `HYPERSWAP_INTEGRATION_RFC.md`
4. les ABIs présentes dans `FWA_ETHEREUM_REFERENCE/`, uniquement pour comprendre les parcours FWA historiques ;
5. `src/hyperevm/` et `script/`, sans les modifier, pour connaître l'état du port en cours.

Sources externes à inspecter :

- produit de référence : `https://www.fwa.fun/`
- documentation FWA : `https://www.fwa.fun/docs`
- direction artistique : `https://app.hyperliquid.xyz/trade`
- environnement cible : `https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/hyperevm`

L'ancien projet de bags de memecoins est abandonné et hors scope. N'utilise pas ses contrats, ses écrans ou sa terminologie comme base produit.

## 2. Contrat de parallélisation

Une autre instance modifie le reste du repository. Pour éviter les conflits :

- crée et modifie uniquement `frontend/**` ;
- ne modifie aucun contrat, test Foundry, script de déploiement, manifeste de parité ou fichier forensic ;
- ne renomme et ne déplace aucun fichier existant ;
- ne reviens jamais sur les changements effectués en parallèle par une autre instance ;
- si une information contrat manque, avance avec une interface typée et un mock ;
- consigne les besoins d'intégration non résolus dans `frontend/INTEGRATION_NEEDS.md` au lieu de bloquer ;
- considère les adresses, ABIs et paramètres comme instables tant qu'ils ne sont pas publiés dans un manifeste de déploiement testnet.

Tu es explicitement autorisé à construire le frontend avant le gel final des contrats, à condition que la couche d'accès au protocole reste remplaçable et qu'aucune sémantique on-chain ne soit inventée silencieusement.

## 3. Objectif produit

Le produit permet à des utilisateurs de :

1. explorer un pool de NFT déposés avec du backing HYPE ;
2. consulter pour chaque position le NFT, la collection, le backing, le poids, les odds, la classe/rareté, l'ancienneté et l'état ;
3. déposer un ERC-721 autorisé avec un montant de backing HYPE ;
4. acheter une ou plusieurs chances d'obtenir aléatoirement des NFT du pool ;
5. suivre la transaction, la demande de randomness et la révélation du résultat ;
6. gérer les NFT alloués et choisir le settlement disponible ;
7. gérer les listings déposés, earnings, refunds et retraits ;
8. consulter l'activité globale et personnelle ;
9. consulter et réclamer les rewards HWA lorsque ce module sera activé ;
10. comprendre clairement à tout moment le coût, l'état on-chain, le risque de drift et l'action suivante.

ETH doit être remplacé partout par **HYPE**. Ne jamais afficher ETH ou le symbole `Ξ`. L'application doit distinguer sans ambiguïté **HyperEVM** de **HyperCore**.

Réseaux :

- HyperEVM testnet : chain ID `998` ;
- HyperEVM mainnet : chain ID `999` ;
- développement initial : testnet ou mode mock uniquement.

## 4. Direction artistique : « FWA mechanics, Hyperliquid spirit »

Nous ne voulons ni une landing page marketing générique, ni une copie rose du site FWA, ni un dashboard SaaS à grosses cartes. L'interface doit évoquer un terminal on-chain premium : dense, rapide, sombre, précise et sobre, tout en laissant les NFT jouer le rôle visuel principal.

Référence visuelle relevée sur l'application Hyperliquid :

- fond principal : `#0F1A1E` ;
- surface/contrôle : `#273035` ;
- accent mint : `#50D2C1` ;
- texte principal proche de `#F6FEFD` ;
- texte sombre sur CTA mint : proche de `#04060C` ;
- coins généralement autour de `8px` ;
- contrôles compacts d'environ `32–34px` ;
- typographie sans-serif système, chiffres lisibles et interface fréquemment en `12–14px` ;
- peu d'ombres, hiérarchie obtenue par les surfaces, traits fins, contraste et espacement ;
- feedback positif mint, danger/échec corail-rouge, warnings ambre discrets.

Ces valeurs forment une base, pas une excuse pour copier aveuglément l'interface de trading. Inspecte la référence vivante et transforme ses principes en expérience NFT originale.

Principes obligatoires :

- densité maîtrisée sur desktop, sans grands espaces décoratifs inutiles ;
- NFTs affichés en images nettes avec ratio stable et fallback robuste ;
- données économiques alignées, tabulaires et faciles à comparer ;
- accent mint réservé aux actions, sélections et valeurs réellement importantes ;
- couleurs de rareté secondaires et contenues, jamais au détriment de la lisibilité ;
- motion courte et fonctionnelle : changement d'état, pending, reveal, settlement ;
- pas de gradients crypto criards, glassmorphism excessif, néons, grosses ombres ou blobs décoratifs ;
- pas de carousel de landing page ;
- pas de fausse donnée présentée comme donnée live ;
- pas de logo Hyperliquid copié. Utilise le wordmark produit `HWA / HyperEVM`.

Crée un petit design system documenté dans `frontend/DESIGN_SYSTEM.md` et matérialisé en tokens CSS : couleurs, surfaces, bordures, rayons, espacements, typographie, tailles de contrôle, états et breakpoints.

## 5. Architecture d'écran attendue

### Shell global

- barre supérieure compacte et sticky ;
- wordmark temporaire ;
- navigation : `Pool`, `Activity`, `My Positions`, `Rewards` ;
- indicateur explicite `HyperEVM Testnet` ou `HyperEVM Mainnet` ;
- état de synchronisation de l'indexer ;
- bouton wallet compact avec menu compte/réseau ;
- bandeau non intrusif quand l'app est en mode mock, testnet, dégradé ou mauvais réseau.

### Pool — écran principal

Desktop : disposition deux colonnes, exploration à gauche et panneau d'acquisition sticky à droite.

Zone exploration :

- statistiques globales : NFT actifs, backing total, prix courant, reward/crown, acquisitions en cours ;
- emplacement featured/crown ;
- vues FWA `Recent / Top / Pool / Deposits` ;
- recherche, filtres collection/rareté/état, tri `Value / Date / Name / Odds` ;
- bascule grille/liste ;
- cards ou lignes NFT affichant image, collection, token ID, backing HYPE, odds, classe, listing ID et état ;
- pagination ou virtualisation si le volume le justifie ;
- détail NFT dans un drawer ou modal profond-linkable.

Panneau d'acquisition :

- quantité de 1 à 5 ;
- prix pool, coût randomness/service, total HYPE et frais clairement séparés ;
- tolérance de drift, baseline FWA `10 %` ;
- aperçu probabiliste et explication courte du mécanisme ;
- solde HYPE ;
- CTA unique et explicite ;
- quote horodatée avec état `fresh / stale / refreshing` ;
- aucune promesse de NFT déterminé avant la randomness.

### Dépôt NFT

Flow guidé dans un drawer ou une page dédiée :

1. connexion et contrôle du réseau ;
2. chargement des ERC-721 détenus ;
3. filtrage des collections autorisées ;
4. sélection d'un NFT ;
5. saisie du backing HYPE avec minimum et solde ;
6. aperçu des odds/poids et des conditions ;
7. approval ERC-721 si nécessaire ;
8. transaction de listing ;
9. confirmation `staged` puis `active` lorsque l'état le permet.

Ne fusionne pas approval et listing dans un faux état unique. L'utilisateur doit voir exactement l'étape en cours et pouvoir reprendre après un refresh.

### My Positions

Présente des onglets ou filtres :

- `Deposited`
- `Allocated`
- `Pending`
- `Settled`
- `Refunds & Earnings`

Actions selon l'état réel : retirer, keep NFT, relist, accepter le bid en HYPE, accepter en tokens HWA, réclamer un refund/earning, réessayer la livraison d'un NFT stuck. Les actions indisponibles doivent expliquer pourquoi et, le cas échéant, afficher le temps restant avant 24 h ou 7 jours.

### Activity

- feed global et personnel ;
- filtres par type et collection ;
- événements : deposit, activation, acquisition request, reveal/allocation, settlement, relist, bid accepted, refund, reward, withdraw ;
- hash de transaction, adresse abrégée, âge/date, statut final ;
- lien vers l'explorer configuré ;
- ne pas confondre événement indexé et confirmation on-chain finale.

### Rewards

Prépare l'écran même si certaines fonctions restent feature-flagged :

- rewards depositor et purchaser ;
- pot/epoch hot-cold ;
- earned, claimable, claimed ;
- token `$HWA` et route Project X clairement identifiés ;
- skeleton ou état `module not activated` honnête ;
- aucune APR inventée.

## 6. États UX indispensables

Implémente et démontre visuellement au minimum :

- wallet déconnecté ;
- mauvais réseau ;
- changement de réseau refusé ;
- wallet connecté sans position ;
- pool vide ;
- chargement initial et refresh silencieux ;
- indexer en retard ;
- RPC indisponible mais données indexées présentes ;
- quote stale ;
- solde HYPE insuffisant ;
- collection non autorisée ;
- approval demandé, pending, confirmé, rejeté et reverted ;
- listing pending, staged, active et retiré ;
- acquisition pending ;
- randomness demandée ;
- randomness longue ou timeout ;
- résultat révélé ;
- refund disponible ;
- settlement dans la fenêtre purchaser ;
- fenêtre depositor ouverte après 24 h ;
- finalisation permissionless après 7 jours ;
- NFT transfer stuck avec retry ;
- transaction remplacée ou rechargement de page pendant un pending ;
- métadonnées/image NFT cassées ou lentes.

Chaque transaction doit suivre une machine d'état visible du type :

`review → wallet confirmation → submitted → confirming → indexed → completed`

avec branches `rejected`, `reverted`, `stale` et `retryable`. Ne considère jamais `submitted` comme un succès final.

## 7. Stack recommandée

S'il n'existe aucun frontend, crée `frontend/` avec :

- Next.js App Router ;
- TypeScript strict ;
- Tailwind CSS avec tokens centralisés ;
- primitives headless accessibles, sans thème visuel générique imposé ;
- `wagmi` + `viem` pour wallet et lectures/écritures EVM ;
- TanStack Query pour cache et synchronisation ;
- Zod pour valider données indexer/configuration ;
- tests unitaires/composants adaptés à la stack ;
- Playwright pour les parcours end-to-end et captures responsive.

Utilise les versions stables compatibles disponibles au moment de l'installation et crée un lockfile. N'ajoute pas une dépendance lourde lorsqu'une primitive locale simple suffit.

## 8. Couche protocole mock-first

Le frontend ne doit jamais importer directement des adresses ou ABIs éparpillées dans les composants.

Crée une frontière typée, par exemple :

```ts
interface ProtocolClient {
  getPoolSnapshot(): Promise<PoolSnapshot>
  getListings(query: ListingsQuery): Promise<Page<Listing>>
  getActivity(query: ActivityQuery): Promise<Page<ActivityItem>>
  getUserPositions(account: Address): Promise<UserPositions>
  getRewards(account: Address): Promise<RewardsSnapshot>
  getOwnedEligibleNFTs(account: Address): Promise<OwnedNFT[]>
  quoteAcquisition(input: AcquisitionInput): Promise<AcquisitionQuote>
  approveNFT(input: ApproveNFTInput): Promise<TrackedTransaction>
  listNFT(input: ListNFTInput): Promise<TrackedTransaction>
  acquire(input: AcquisitionInput): Promise<TrackedTransaction>
  settle(input: SettlementInput): Promise<TrackedTransaction>
  withdraw(input: WithdrawInput): Promise<TrackedTransaction>
  claim(input: ClaimInput): Promise<TrackedTransaction>
}
```

Adapte les noms si nécessaire, mais conserve cette séparation :

- `MockProtocolClient` complet pour développer et tester maintenant ;
- `ViemProtocolClient` ou équivalent préparé pour le testnet ;
- repository/indexer séparé des lectures critiques on-chain ;
- sélection via configuration/feature flag, pas via modifications de composants ;
- types métier indépendants des types bruts ABI.

Les fixtures mock doivent couvrir plusieurs collections et tous les états UX importants. Fournis un panneau de développement ou des routes/scénarios permettant de basculer rapidement entre ces états, uniquement en environnement local.

Pour les données critiques juste avant une transaction — prix, quote, drift, état de position, solde et allowance — prévois une revalidation directe on-chain. L'indexer sert à explorer et historiser, pas à autoriser aveuglément une transaction.

## 9. Configuration attendue

Prépare un `.env.example` frontend sans secrets, notamment :

```text
NEXT_PUBLIC_APP_ENV=development
NEXT_PUBLIC_DATA_MODE=mock
NEXT_PUBLIC_HYPEREVM_CHAIN_ID=998
NEXT_PUBLIC_HYPEREVM_RPC_URL=
NEXT_PUBLIC_INDEXER_URL=
NEXT_PUBLIC_EXPLORER_URL=
NEXT_PUBLIC_DEPLOYMENT_MANIFEST_URL=
```

Les adresses finales doivent provenir d'un unique deployment manifest validé à l'exécution. Si le manifeste est absent, invalide ou sur le mauvais chain ID, désactive les writes et affiche un état explicite.

Ne place aucune clé privée, clé d'API confidentielle ou secret dans le frontend.

## 10. Responsive et accessibilité

- desktop optimisé pour `1440×900` et utilisable dès `1280px` ;
- tablette testée autour de `1024px` ;
- mobile testée à `390×844` ;
- sur mobile, panneau d'acquisition en bottom sheet ou page dédiée ;
- aucune donnée critique uniquement visible au hover ;
- navigation clavier complète, focus visible, labels accessibles ;
- respect de `prefers-reduced-motion` ;
- contraste WCAG raisonnable ;
- tables converties en cards lisibles sur petit écran ;
- aucune overflow horizontale non intentionnelle.

## 11. Sécurité et intégrité côté interface

- ne déclenche jamais de connexion wallet ou signature automatiquement au chargement ;
- affiche réseau, actif, montant et action avant toute signature ;
- n'utilise jamais de nombres JavaScript flottants pour HYPE ou les valeurs on-chain ;
- traite les métadonnées NFT, SVG, noms de collection et URLs comme non fiables ;
- aucune injection HTML depuis les métadonnées ;
- fallback image et timeout de métadonnées ;
- aucune adresse de contrat codée en dur dans un composant ;
- approval limité au contrat et au besoin réel lorsque l'ABI le permet ;
- erreurs RPC et revert décodées en message actionnable sans masquer les détails techniques consultables ;
- persistance locale limitée aux préférences et transactions publiques nécessaires au resume ;
- aucune donnée mock ne doit pouvoir apparaître comme mainnet live.

## 12. Livrables

Produis dans `frontend/` :

1. l'application fonctionnelle ;
2. `README.md` avec installation, commandes et modes mock/testnet ;
3. `DESIGN_SYSTEM.md` ;
4. `FRONTEND_ARCHITECTURE.md` ;
5. `INTEGRATION_NEEDS.md` avec ABIs, événements, vues, adresses et endpoints encore nécessaires ;
6. `.env.example` ;
7. fixtures et scénarios mock ;
8. tests unitaires/composants ;
9. tests Playwright des parcours critiques ;
10. captures de contrôle desktop, tablette et mobile dans `frontend/artifacts/screenshots/`.

Évite de produire une documentation spéculative très longue : privilégie du code fonctionnel, des contrats d'interface précis et des décisions visuelles démontrées.

## 13. Critères d'acceptation

Le travail est acceptable lorsque :

- le frontend démarre avec une seule commande documentée ;
- lint, typecheck, tests et build passent ;
- l'application fonctionne entièrement en mode mock sans wallet réel ;
- la connexion wallet et le contrôle chain ID sont préparés pour 998/999 ;
- tous les montants sont en HYPE ;
- les parcours pool, dépôt, acquisition, randomness, positions, settlement, activity et rewards sont navigables ;
- les états d'erreur/pending ne sont pas de simples TODO ;
- la D.A. est manifestement Hyperliquid-inspired : sombre, mint, compacte et data-dense ;
- l'expérience reste NFT-first et ne ressemble pas à un terminal de trading copié ;
- l'intégration future peut remplacer les mocks sans réécrire les composants ;
- aucun fichier hors de `frontend/**` n'a été modifié.

## 14. Ordre d'exécution

1. inspecte les sources de vérité et le repository ;
2. audite rapidement les parcours FWA et les codes visuels Hyperliquid ;
3. écris la frontière `ProtocolClient`, les types métier et les fixtures ;
4. pose les tokens et le shell responsive ;
5. construis Pool + acquisition ;
6. construis dépôt + positions + settlement ;
7. construis Activity + Rewards ;
8. implémente tous les états transactionnels et dégradés ;
9. ajoute tests et captures responsive ;
10. exécute lint, typecheck, tests et build ;
11. documente uniquement les besoins d'intégration réellement restants.

Dans ta première réponse, confirme brièvement les fichiers que tu as lus, annonce le plan immédiat, puis commence l'implémentation. Ne demande pas de validation esthétique préalable : utilise ce brief comme direction figée et avance avec des choix réversibles.
