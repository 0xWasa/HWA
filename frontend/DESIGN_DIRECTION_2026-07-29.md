# HWA — passe DA/UX 2026-07-29 : « Pressure Desk »

## Diagnostic de l'existant (Volt Loot, état au 2026-07-29)

Ce qui marche déjà : le squelette hybride existe. Côté terminal — échelle 13/14 px, JetBrains
Mono tabulaire sur tous les chiffres, `.mlabel`, segmented controls, feed avec rails de rareté,
états honnêtes partout (prelaunch/degraded/fail-closed exemplaires). Côté jeu — le `.btn3d` qui
s'enfonce, la HeroPrizeStack (tilt/foil/flip) qui est la meilleure pièce de l'app, la séquence de
dépôt théâtrale, la palette Volt (midnight `#080a12` + acid `#d8ff52` + ultraviolet `#7354f5`).

Ce qui manque par rapport à « un terminal Hyperliquid envahi par un jeu de cartes NFT » :

1. **Le terminal est sous-affirmé** — rayons généreux (12–28 px) qui lisent « fintech grand
   public », aucune sémantique verte/rouge de tick dans les tables, le teal HyperEVM relégué à un
   point d'état, pas de culture « status bar » (Drip/HL l'ont), pas de peau de table dense.
2. **Le jeu de cartes est cantonné** à trois set pieces (hero, reveal, dépôt). Positions,
   Activity, Rewards, Acquisitions = panneaux gris. La rareté ne « cadre » rien hors du hero.
3. **Le reveal — pic émotionnel — est plat** : le résultat apparaît fini, sans scellé, sans flip,
   sans burst (le keyframe `hwa-reveal-burst` existe et n'est jamais utilisé).
4. **Motion non gouvernée** : 32 keyframes, ~23 durées codées en dur, un seul easing, zéro
   squish/overshoot — la personnalité « mou/tactile » du logo ne se retrouve dans aucun contrôle.
5. **Zéro micro-personnalité** : pas de tampons, pas de stickers de desk, microcopy sobre
   partout (« The NFT stayed safe. » est le seul beat charmant).
6. **La collection Genesis « Pressure Fields » (v3 approuvée) n'irrigue pas l'UI** : anneaux de
   contour, mur de liquidation, mint/rose — aucun écho dans les fonds, foils ou états vides.

## Direction retenue : « Pressure Desk »

Un desk de trading nocturne envahi par un jeu de cartes vivant. En dessous, la précision d'un
terminal Hyperliquid : mono, ticks verts/rouges, hairlines, status bar, densité. Par-dessus, le
jeu : cartes qui se penchent légèrement dans les grilles (jamais parfaitement droites), boutons
qui s'écrasent et rebondissent, tampons de greffier sur les états, et la signature « pressure
field » de Genesis qui affleure dans les scellés, les états vides et le pré-launch (anneaux de
contour pressés contre un mur — jamais de fausses données, seulement de la géométrie).

### Piliers

1. **Durcir le terminal** : `--radius-data` 6 px pour les surfaces de données ; ticks ▲/▼
   vert/rouge sur les deltas ; teal = « donnée vivante » (quote fraîche, dots live, sparklines) ;
   footer transformé en status bar ; tables denses `text-2xs` mono.
2. **Laisser les cartes envahir** : micro-rotations alternées (±0.4°) sur les grilles qui se
   redressent au hover ; cadres teintés rareté ; foil réservé aux moments gagnés (reveal,
   allocated) ; dos de carte scellé dérivé des Pressure Fields.
3. **Physique squishy** : tokens motion (`--dur-fast/base/slow`, `--ease-squish` overshoot,
   `--ease-spring`) ; press/rebond sur `.btn3d` ; pop du slider de quantité ; jamais d'animation
   permanente ajoutée ; `prefers-reduced-motion` reste un kill switch global.
4. **Le reveal devient une ouverture de pack** : scellé (dos Pressure Field + tampon SEALED) →
   flip → burst + rangées en cascade. Uniquement dans l'overlay (la route permalink reste
   statique et idempotente). Étages exposés en `data-reveal-stage` pour les tests.
5. **Tampons & microcopy de desk** : classe `.stamp` (mono, bordure, rotation légère) pour les
   états — LOCKED, SEALED, RECORDED, REFUNDED… La précision prime : aucun copy pinné par les
   tests ne change, aucun risque masqué.

### Garde-fous absolus (inchangés)

Formule prelaunch et ordre des gates, ladder EnvBanner, aucune donnée simulée hors mode mock,
matrice `allowInReadOnly`, quatre choix de settlement, tous les `data-testid`/aria/copy pinnés
par les specs, clés localStorage, navigation clavier, `prefers-reduced-motion`, logo HWA, nom
visible « HWA » uniquement, aucun overflow horizontal.
