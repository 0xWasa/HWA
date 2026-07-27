# Référence immuable FWA Ethereum

Ce dossier est la couche de référence brute du déploiement FWA actuellement publié sur Ethereum. Il ne doit jamais recevoir les adaptations HyperEVM. Les futurs contrats portés doivent vivre dans un autre dossier et toute divergence doit être reliée à `../FWA_PARITY_MANIFEST.md`.

## Provenance

- Adresses : [page officielle FWA Deployments](https://www.fwa.fun/docs/deployments).
- Sources, ABI, métadonnées de compilation et constructor arguments : contrats vérifiés « Exact Match » sur Etherscan.
- Bytecodes, slots EIP-1967 et vues : RPC Ethereum public.
- Historique `ConfigSet`, `CollectionWhitelistSet` et rôles : logs Ethereum relus depuis les blocs de création.
- Première capture des artefacts : bloc `0x186c50a`.
- Capture des vues et événements : blocs `0x186c51e` à `0x186c524`.
- Date de collecte : 2026-07-25 UTC.

Les huit contrats sont des déploiements directs : les slots EIP-1967 implementation, admin et beacon sont nuls. Ils ont été compilés avec Solidity `0.8.30`, optimiseur activé à `1` run et cible EVM `prague`. HyperEVM annonce Cancun sans blobs : le port devra donc être recompilé pour Cancun et validé par tests différentiels, sans prétendre reproduire le runtime bytecode.

## Contenu

Chaque sous-dossier contient, selon le contrat :

- `etherscan-standard-input.json` : entrée standard de compilation telle que vérifiée ;
- `sources/` : sources brutes extraites, sans modification ;
- `abi.json` ;
- `constructor-arguments.json` ;
- `deployed-bytecode.hex` ;
- `metadata.json` : provenance, compilateur, hashes et slots proxy ;
- `state-snapshot.json` : vues sans argument et solde au bloc de capture.

Les fichiers racine complètent la capture :

- `reference-index.json` : index des huit contrats et hashes ;
- `roles-state.json` : reconstruction des mappings de rôles à partir des événements ;
- `FWA/state-events.json` : historique de configuration et allowlist reconstruite.

## Empreintes runtime

| Contrat | Adresse | Taille | Keccak-256 du runtime |
|---|---|---:|---|
| FWA | `0xB276F62DB0ce8CA2Ca5bc522695bE604521eAc1c` | 21 425 octets | `0xa53298a411a9ce5b5d352c45e3aaa90fac78632d21e7b928425cf6eb11ab8cc4` |
| FWARewards | `0x6a1a1C0CfB3D3C538e13D36d608a5bcaa992fc78` | 11 514 octets | `0xf638c9e341efecf99bd093cff9b780bb3f7bf03bbd814b80c092d7e3361b4555` |
| FWAVRFService | `0xa084c33Fb7a467307452898b8D58165ebd2E5D9f` | 6 344 octets | `0x8ab6e6d4ca28ade13f80314ccd54b3a648734ee88a5bcd807711fe5ae037f4a4` |
| FWAToken | `0xa0Df17B5aC76ABaBA36E1450E2cbCd18A620C845` | 11 394 octets | `0xd07b0280e4e25689956cff42290d843739714308e6fbe693017cede05c2c52fd` |
| FWATokenHook | `0x2C67ebA8A50AF0dB5Fba55F725247a75CbDA6444` | 7 072 octets | `0x5eeafce23c30462750069d6313286eca9587da8ecffdff880288d31b75d41df0` |
| FWAClaim | `0xd4085d38855F17EdF0B1CCBFad7B3846fb305655` | 1 800 octets | `0x2bcc7652822828e6672fe46b9f2330ea71bad315f2df8e740605e0e0fff89f0d` |
| FWAWhitelist | `0x854352b275cF6A0DfFCf2983C986FBe9345e17c3` | 2 683 octets | `0x0472057b43e7cc323bc058a785b861b2ee8d3c5956cd2de5b32e2af37447976a` |
| Splitter | `0x1C175b9F0e8C73eD3e677e1cBb1B5A2DD4373Bfe` | 3 949 octets | `0x10d57a933c83f60e2ff54eb1c7b64ab1c34278f34c4809ac6ae4e7e2accb2ce0` |

## Reproduction

Les scripts de collecte sont conservés dans `../.tools/` :

- `fetch_fwa_reference.mjs` ;
- `snapshot_fwa_state.mjs` ;
- `snapshot_fwa_roles.mjs`.

Ils écrivent dans ce dossier. Une nouvelle exécution doit être faite vers une capture datée ou dans une branche dédiée si elle risque d'écraser cet état de référence.
