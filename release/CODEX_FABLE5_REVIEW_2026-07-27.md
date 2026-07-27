# Revue Codex de l'audit Fable 5 — 27 juillet 2026

## Conclusion

Le finding F5-001 est confirmé : l'ancienne campagne stateful ne progressait pas au-delà de la tête FIFO pending. Les nouveaux tests sont additifs, atteignent les états `Allocated` et `Settled`, couvrent l'expiration/remboursement et la récupération d'un NFT bloqué, sans modification des contrats de production.

Le finding F5-002 est conservateur mais valide. La documentation HyperEVM décrit des fast blocks d'une seconde, mais ne publie pas de borne garantissant l'écart maximal entre `block.timestamp` et l'horloge murale. Le délai de 12 secondes n'était donc pas une propriété de sécurité démontrée. La décision produit du 27 juillet 2026 fixe désormais une marge minimale mainnet de 30 secondes, imposée par le contrat, le script de déploiement, l'attestation et la configuration de release. Le frontend présente ce délai comme une étape de sécurité normale. F5-002 est fermé.

F5-003 et F5-004 sont fermés dans cette passe :

- `broadcastCapableSteps` est désormais un compteur alimenté lorsque la gate détecte et refuse `--broadcast` ;
- `fork-test/FWAEthereumDifferential.t.sol` et `indexer/subgraph.yaml` sont désormais inclus explicitement dans le manifeste SHA-256.

Les rapports Fable originaux restent intacts afin de préserver la trace d'audit. La présente note enregistre uniquement la revue et les fermetures postérieures.

## État de sécurité

- Critical ouverts : 0.
- High ouverts : 0.
- Medium ouverts : 0.
- Zones nécessitant encore un audit hostile dédié : Rewards/Splitter et SSRF frontend/indexeur.
- Aucun déploiement mainnet ni activation publique autorisé par cette revue.
