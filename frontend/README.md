# Hyper World Assets — frontend

dApp HyperEVM du fork FWA : pool de NFT adossés à du HYPE, acquisitions aléatoires, settlements, rewards `$HWA` et marché Project X.

## Testnet local

```powershell
npm ci
npm run dev
```

Ouvrir `http://127.0.0.1:3900` avec un wallet sur chain 998. Le frontend ne lit aucune clé privée.

## Commandes de qualité

| Commande | Effet |
|---|---|
| `npm run typecheck` | TypeScript strict |
| `npm run lint` | ESLint `src/` + `e2e/` |
| `npm test` | tests Vitest |
| `npm run build` | build Next production isolé dans `.next-build` |
| `npm run test:e2e` | parcours Playwright sur environnement mock déterministe |
| `npm audit --audit-level=high` | gate dépendances frontend |

La gate complète du dépôt est `..\scripts\TestReleaseCandidate.ps1`.

## Modes

- `mock` : scénarios déterministes, aucune transaction réelle ; toujours marqué dans l'UI.
- `testnet` : viem/wagmi, chain 998 et manifeste testnet.
- `mainnet` : chain 999, drand evmnet BN254 vérifié on-chain, Project X officiel et manifeste fail-closed.

## Architecture et sécurité

Les composants React consomment `ProtocolClient`. `MockProtocolClient` sert les tests ; `ViemProtocolClient` lit les contrats et soumet les writes. Les adresses, collections et flags viennent exclusivement du manifeste validé par Zod.

L'indexeur fournit découverte et historique. Les données critiques sont relues on-chain avant signature. Les métadonnées NFT passent par `/api/nft-metadata`, qui limite taille/délai, interdit les redirects, transforme IPFS via un gateway HTTPS et refuse les hosts HTTPS non revus. Configurer côté serveur :

```text
NFT_METADATA_ALLOWED_HOSTS=metadata.example,cdn.example
NFT_METADATA_TRUSTED_CLIENT_IP_HEADER=x-real-ip
NFT_METADATA_RATE_LIMIT_PER_MINUTE=600
NFT_IPFS_GATEWAY_BASE_URL=https://ipfs.io/ipfs/
```

Le marché `$HWA` lit son spot directement depuis le pool Project X. Les achats publics ne sont jamais envoyés via l'adapter buyback : quand l'owner ouvre manuellement `externalBuysEnabled`, le frontend redirige vers la route Project X revue du manifeste.

En production, le secours de découverte des positions n'utilise jamais le RPC public HyperEVM pour scanner l'historique. Il exige `NEXT_PUBLIC_HYPEREVM_LOG_RPC_URL` et `NEXT_PUBLIC_HYPEREVM_LOG_RPC_MAX_BLOCK_RANGE` pour un endpoint logs/archives distinct, audité et capable d'au moins 10 000 blocs par requête. Les scans sont bornés et checkpointés. Sans cet endpoint, l'application échoue explicitement si l'indexeur est indisponible au lieu de lancer des requêtes incompatibles avec la limite publique de 50 blocs.

Voir `INTEGRATION_NEEDS.md`, `FRONTEND_ARCHITECTURE.md` et `../MAINNET_RELEASE_RUNBOOK_2026-07-26.md`.
