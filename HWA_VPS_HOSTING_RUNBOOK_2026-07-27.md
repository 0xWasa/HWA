# HWA VPS hosting runbook

Date: 2026-07-27  
Status: prepared; no upload and no HyperEVM mainnet deployment performed

## Immutable Genesis asset path

The approved `Pressure Field` v3 collection is always served below this exact version path:

`/hwa-genesis/v3/96b80e5c8a06b07407d92b58dbf7865aab242439bdfdb5d8436e370cd2915648/`

Images live at `images/001.svg` through `images/333.svg`. Contract metadata live at
`metadata/1` through `metadata/333` with no extension because `HWAGenesisNFT.tokenURI()` appends an
unpadded decimal token ID to its base URI.

## Prepare the final package

From the repository root, after the production asset hostname has HTTPS enabled:

```powershell
& .\scripts\PrepareHWAGenesisHosting.ps1 -PublicOrigin "https://assets.example.tld"
```

This command is deterministic, refuses to overwrite a non-empty package, validates the approved
source-art aggregate, embeds the final HTTPS image URLs, and creates:

- `release/hwa-genesis-v3-hosting/public/` — the only directory uploaded to the VPS;
- `deployment-manifest.json` — every public URL and SHA-256;
- `checksums.sha256` — a portable offline integrity list;
- `release/hwa-genesis-canonical.json` — the fail-closed preparation record.

The Nginx policy template is `ops/nginx/hwa-genesis-v3.conf.example`. Replace only the hostname and
TLS certificate configuration. Do not change the collection hash path. The policy permits GET/HEAD,
sets exact JSON/SVG MIME types, CORS, `nosniff`, and one-year immutable caching.

## Upload and verify

Upload the contents of the generated `public/` directory to `/srv/hwa-genesis/public/`, reload
Nginx, then run:

```powershell
& .\scripts\VerifyHWAGenesisHosting.ps1 `
  -PackageRoot "release/hwa-genesis-v3-hosting" `
  -Remote
```

The verifier performs 666 remote GETs without following redirects and checks status 200, MIME,
immutable cache policy and byte-exact SHA-256 for all 333 images and 333 metadata documents. A
successful run writes `release/hwa-genesis-hosting-attestation.json` with
`deploymentAllowed: true`. The mainnet release gate rejects missing, mismatched, local-only or
older-than-seven-days attestations.

Set the following values only from the successful deployment manifest:

```dotenv
HWA_GENESIS_V3_PUBLIC_ORIGIN=https://assets.example.tld
HWA_GENESIS_NFT_BASE_URI=https://assets.example.tld/hwa-genesis/v3/96b80e5c8a06b07407d92b58dbf7865aab242439bdfdb5d8436e370cd2915648/metadata/
HWA_GENESIS_V3_HOSTING_ATTESTATION_PATH=release/hwa-genesis-hosting-attestation.json
```

## Availability and recovery

- Keep the primary VPS plus two independent backups in different providers or regions.
- Keep the exact uploaded directory and `checksums.sha256` in an offline archive.
- Monitor TLS expiry, HTTP 200, MIME and hashes for representative tokens continuously; run the
  full 666-resource verifier before deployment and after every infrastructure change.
- Never mutate files below the approved version path. Restore byte-identical files from backup.
- IPFS may be added as a mirror, but it is optional and is not the contract base URI.

## Mainnet boundary

Preparing, uploading and verifying these static files performs no blockchain action. Deploying the
Genesis contract, minting, freezing metadata or broadcasting any chain-999 transaction still
requires the user's explicit `deploy hyperevm` authorization.
