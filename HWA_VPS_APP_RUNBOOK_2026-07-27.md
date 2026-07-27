# HWA application VPS runbook

Date: 2026-07-27  
Status: production packaging prepared; no upload and no mainnet deployment performed

The application and the immutable Genesis files are separate services. The Next.js application is
served by a non-root, read-only container on `127.0.0.1:3900`. Nginx terminates TLS and exposes it.
Genesis assets use the independent immutable configuration in `HWA_VPS_HOSTING_RUNBOOK_2026-07-27.md`.

## 1. Prepare production configuration

Only after the chain-999 deployment manifest, public indexer and reviewed archive/log RPC exist:

```powershell
Copy-Item frontend/.env.production.example frontend/.env.production.local
```

Populate every blank value. `NEXT_PUBLIC_*` values are compiled into the browser bundle and must
never contain credentials. Archive/log RPC and metadata gateway credentials remain server-only.
The release gate validates these values before the final image is built.

## 2. Build and inspect locally

```powershell
docker compose --env-file frontend/.env.production.local -f docker-compose.production.yml build --pull
docker compose --env-file frontend/.env.production.local -f docker-compose.production.yml up -d
docker compose -f docker-compose.production.yml ps
```

The Compose file drops all Linux capabilities, prevents privilege escalation, uses a read-only
filesystem, binds only to localhost and includes a healthcheck. Test `http://127.0.0.1:3900/` before
configuring public DNS.

## 3. Publish behind Nginx

Copy `ops/nginx/hwa-app.conf.example`, replace the hostname and certificate paths, validate with
`nginx -t`, then reload Nginx. Keep the Next container private; only Nginx exposes ports 80/443.
The two server routes are rate-limited at the edge:

- `/api/rpc/logs` — strict contract allowlist and maximum log range;
- `/api/nft-metadata` — reviewed metadata hosts/IPFS gateway and SSRF protections.

Configure uptime checks for `/`, certificate expiry and the two APIs. Back up the exact Git commit,
production env without private material, deployment manifest and Docker image digest.

## 4. Update and rollback

Build every release from an immutable Git commit. Record the image digest before promotion. Keep the
previous image available; rollback changes only the container image and never mutates on-chain state
or files below the versioned Genesis asset path.

## Mainnet boundary

These files prepare hosting only. No container has been published to a VPS and no chain-999
transaction is performed. Contract deployment still requires the user's explicit `deploy hyperevm`.

