# Déploiement HWA V2 sur Project X — HyperEVM

Ce runbook est fail-closed. Le déploiement ne constitue jamais une ouverture publique. Les dépôts NFT, acquisitions/spins, claims saisonniers et achats externes de HWA restent fermés tant qu'une activation séparée n'est pas explicitement autorisée.

## 1. Paramètres figés

- Chain : HyperEVM mainnet, chain ID 999.
- Owner/deployer : `0x24398fc31899E2384E4E070fcdBF8Bb6D916FcD9`.
- Supply HWA fixe : 1 000 000 000, aucun mint après déploiement.
- LP Project X : 800 000 000 HWA, one-sided, verrouillée définitivement.
- Réserve rewards : 100 000 000 HWA.
- Vesting écosystème : 100 000 000 HWA, 24 mois linéaires, cliff 3 mois, aucune accélération.
- FDV initiale cible : 640 HYPE, bande attestée 600–700 HYPE.
- Fee tier Project X : 1 %, tick spacing 200.
- Minimum backing protocolaire : 0,1 HYPE.
- HWA Genesis : collection existante de 333 NFT, snapshot gelé.
- Randomness : drand BN254 vérifié on-chain.

## 2. Rewards saisonniers

Trois saisons consécutives de 15 jours, puis arrêt définitif des émissions préfinancées :

| Saison | Fenêtre | Cap maximal |
|---|---:|---:|
| Season 1 | jours 1–15 | 50 M HWA |
| Season 2 | jours 16–30 | 30 M HWA |
| Season 3 | jours 31–45 | 20 M HWA |

Chaque journée ne peut distribuer qu'une valeur HWA inférieure ou égale à 5 % du volume HYPE effectivement réglé. La conversion utilise le minimum entre le prix de lancement et le TWAP 30 minutes. Si le TWAP est indisponible, l'émission est nulle. Les capacités journalières non utilisées ne sont jamais reportées.

Le montant éligible est partagé 50/50 :
- depositors : pondération `sqrt(backing)`, position active au settlement, owner du seed protocolaire exclu ;
- purchasers : pondération selon le HYPE réellement réglé.

Après le jour 45, seuls les rewards issus des buybacks financés par les revenus peuvent continuer.

## 3. Ordre de déploiement

1. Déployer un nouveau Splitter sur le snapshot Genesis existant, puis le geler.
2. Déployer Registry/coordinator drand, VRF service, core et whitelist avec acquisitions fermées.
3. Exécuter immédiatement avant le token :
   ```powershell
   & .\scripts\SelectHWAProjectXLaunchPrice.ps1 -SyncEnv
   ```
   La sélection devient invalide dès que le nonce du deployer change.
4. Déployer HWA + pool Project X + initialisation + LP de 800 M verrouillée.
5. Déployer adapter + rewards V2 + vesting écosystème.
6. Financer exactement 100 M de réserve rewards et 100 M de vesting.
7. Binder rewards/core sans démarrer les émissions.
8. Vérifier bytecodes, owners, balances, immutables, pool, LP, réserves et état fermé.
9. Écrire le manifeste `writesEnabled=false`, publier indexeur/frontend en lecture seule.
10. Vérifier les sources sur l'explorer.

## 4. État obligatoire post-déploiement

- `acquisitionsEnabled == false`
- `externalBuysEnabled == false`
- `emissionStart == 0`
- `claimsEnabled == false`
- aucun calldata d'activation exécuté
- ancien core maintenu en `withdrawOnly == true`
- ancien token maintenu avec achats externes fermés

## 5. Gates avant broadcast

```powershell
C:\Users\eliot\.foundry\bin\forge.exe fmt --check
C:\Users\eliot\.foundry\bin\forge.exe build
C:\Users\eliot\.foundry\bin\forge.exe test
npm --prefix frontend run typecheck
npm --prefix frontend run lint
npm --prefix frontend run test
npm --prefix frontend run build
```

Chaque script de déploiement est d'abord simulé sans `--broadcast`. Après chaque broadcast, les adresses sont enregistrées depuis les receipts, puis relues on-chain avant l'étape suivante.

## 6. Activation ultérieure — hors de ce déploiement

Les activations sont séparées :

1. ouverture des dépôts et allowlist ;
2. démarrage des saisons ;
3. ouverture des acquisitions/spins ;
4. activation des claims ;
5. ouverture manuelle des achats externes HWA sur Project X.

Aucune de ces actions ne doit être exécutée pendant le redéploiement fail-closed. Le swap/buy public reste désactivé jusqu'au GO explicite du propriétaire.
