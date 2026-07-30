# HWA pre-launch readiness

Last verified: 2026-07-28
Candidate state: code-complete and locally verified; external production ceremony pending  
Chain: HyperEVM mainnet `999`  
Broadcast status: **none performed by this release preparation**

## Executive verdict

The repository contains the contracts, Project X launch path, deterministic Genesis collection,
Safe action generators, source/receipt attestations, indexer, responsive frontend, VPS packaging,
emergency paths and fail-closed release gates required for launch. The current candidate can move to
the hosting and deployment ceremony without additional product implementation.

This is deliberately not a mainnet GO. Values that can only exist after VPS provisioning or after a
contract receipt remain empty, and every deployment/activation flag remains false. The only HWA
mainnet contract currently present is the previously approved Safe.

## Frozen decisions

- Safe `0x75818fd0a2Ff801F974C9a5d23616fbd38b15f4C`, version 1.4.1, threshold 2-of-3.
- Deployment wallet `0x24398fc31899E2384E4E070fcdBF8Bb6D916FcD9`; observed nonce `0` and balance
  `16.675 HYPE` at chain-999 block `41,698,955`. Operational ceiling remains `20 HYPE`.
- `$HWA`: fixed 1 billion supply and 640 HYPE target FDV inside the signed 600-700 HYPE band.
- Project X V3: 1% pool, one-sided launch, LP position minted directly to the irrevocable locker.
- External HWA buys remain closed until a separate manual Safe action; no timer exists.
- HWA Genesis: 333 `Pressure Field` v3 NFTs, aggregate
  `96b80e5c8a06b07407d92b58dbf7865aab242439bdfdb5d8436e370cd2915648`.
- Genesis initial custody: four Safe mints `100/100/100/33`, followed by a one-way snapshot freeze.
- Randomness: on-chain verified drand evmnet BN254; transport submitters cannot choose the word.
- Collection rollout: Hypio is the sole canary; PiP & Friends and Odd Otties are wave 1; Hypurr is
  indexed but closed; legacy Catbal is deferred because its on-chain `tokenURI` is empty.

## Latest reproducible gate

`release/release-gate-last-run.json`, generated on 2026-07-28, reports `prepared`,
`broadcastRequested: false`:

- 169/169 Solidity tests passed, including stateful invariants;
- production bytecode sizes passed;
- 3/3 fork tests against Project X mainnet passed;
- 4/4 HyperEVM 998 V3 compatibility fork tests passed;
- frontend dependency audit: 0 vulnerabilities;
- typecheck, lint and production build passed;
- 74/74 frontend unit tests passed;
- 36/36 Playwright journeys passed across mobile, tablet and desktop;
- indexer dependency audit: 0 vulnerabilities and deterministic build passed;
- standalone Next.js VPS build passed;
- Docker production image built and served the complete Genesis gallery as the non-root `nextjs`
  user (`HTTP 200`, local image digest
  `sha256:c259b3c2958c2f992dc54698828516f6eb2be25946aaa7de28cd91ba59dab475`);
- chain-999 indexer build skipped as designed because no deployed address manifest exists yet.

## Prepared hosting

- `frontend/Dockerfile` builds a non-root standalone Next.js server.
- `docker-compose.production.yml` binds only to localhost, drops capabilities, uses a read-only root
  filesystem and defines a healthcheck.
- `ops/nginx/hwa-app.conf.example` terminates TLS and rate-limits server API routes.
- Genesis packaging creates an immutable aggregate-addressed HTTPS path with 333 images and 333
  extensionless metadata documents.
- The remote verifier checks all 666 resources byte-for-byte, MIME, redirects and immutable cache
  policy. A local-only attestation cannot unlock the mainnet gate.

The local release-candidate image was built successfully and served the 333-NFT gallery from an
isolated container on port 3901. Rebuild on the destination VPS from the final Git commit, record the
new platform-specific digest and pass the Compose healthcheck before public DNS is switched.

## Remaining external gates

These items are intentionally impossible to pre-fill safely and are the complete handoff for the
return session:

1. Choose the app and asset hostnames, upload the immutable Genesis package, enable TLS, then obtain
   the fresh 666/666 remote hosting attestation.
2. Bring up the hardened app/indexer stack on the VPS and keep it private until its local healthchecks
   and TLS checks pass.
3. Obtain the production archive/log RPC credential and produce a fresh passing probe. The browser
   receives only the restricted same-origin proxy route. The exact
   collection addresses, deployment blocks, code hashes, supplies and metadata surfaces are already
   frozen in `release/hwa-mainnet-collections-attestation.json`.
4. Configure the public indexer endpoint and app domain. Project X and collection metadata routing
   are already frozen; contract-address log allowlisting is populated from the final deployment
   receipts.
5. Obtain the user's exact phrase **`deploy hyperevm`**. Only then turn on deployment confirmations
   for one phase at a time.
6. Immediately before the token transaction, regenerate the nonce-bound 640 HYPE price selection;
   any consumed deployer nonce invalidates it.
7. Deploy closed, verify every receipt/source/owner/LP lock, execute the reviewed Genesis Safe mints
   and freeze, then produce the chain-999 manifest.
8. Start and monitor two independent drand submitters, pass the mainnet release gate with no skip,
   and run the low-value canary before any public collection or token-buy opening.

## Work that can be completed while the VPS is pending

No additional contract or product implementation is required. The useful parallel work is limited
to provisioning external credentials without exposing them in chat or Git:

1. create a dedicated HyperEVM archive/log RPC credential and store it only in the ignored
   `.env.mainnet.local` file;
2. create or confirm the Goldsky production credential in the same ignored file;
3. reserve the final app and asset hostnames, without publishing DNS until the VPS healthcheck is
   green.

Everything else either depends on the final HTTPS host, depends on contract addresses that do not
exist until deployment, or is intentionally nonce-bound and must be regenerated immediately before
the authorized launch transaction.

## Launch boundary

VPS hosting is the next allowed action. No protocol deployment, activation, Safe mint, metadata
freeze, token market opening or other chain-999 transaction is authorized until the explicit GO.
