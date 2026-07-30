# HWA drand relayer operations

HWA uses permissionless on-chain verification of drand evmnet beacons. Two
unrelated EOAs, hosts and RPC providers remain the preferred production mode.
Two processes on one VPS do not count as redundancy. A supervised single-host
launch is supported only through the explicit risk acknowledgement documented
below; it does not alter the on-chain proof verification.

## Host boundary

Each host contains only:

- a dedicated, low-balance submitter key in `/etc/hwa/drand-relayer.env`;
- a reviewed source snapshot in `/opt/hwa-drand`;
- an independent cursor in `/var/lib/hwa-drand/relayer-state.json`;
- Node.js 22+, Foundry `forge` and `cast` 1.7.1;
- the `hwa-drand-relayer.service` unit.

Never copy `.env.mainnet.local`, the deployer key or a Safe signer key to a
relayer host. The submitter has no privileged protocol role: it only pays gas to
submit proofs that the registry and coordinator verify on-chain.

## Pre-provisioning (before protocol deployment)

1. Install Node.js 22+ and Foundry 1.7.1.
2. Create the locked `hwa-drand` system account.
3. Copy the reviewed release to `/opt/hwa-drand`, owned by `hwa-drand`.
4. Create `/etc/hwa/drand-relayer.env` from `drand-relayer.env.example` with
   mode `0600` and owner `root:root`.
5. Generate a unique secp256k1 key directly on the host, write it only to the
   env file, and record only its public address in the release checklist.
6. Assign an RPC provider that is not used by the other relayer.
7. Install the systemd unit, run `systemd-analyze verify`, but keep it disabled
   until the coordinator receipt exists.

## Receipt binding and activation

After the contracts are deployed, but before public acquisition is enabled:

1. Set the coordinator, registry and exact deployment block in both env files.
2. Fund each submitter with a small independent HYPE gas budget.
3. Run `node .tools/drand_bn254_relayer.mjs --validate-config` as the service
   user; it prints only public binding information, never the private key.
4. Start and enable both services.
5. Check `journalctl -u hwa-drand-relayer` on each host.
6. Submit a canary acquisition and prove that either instance can fulfill it.
7. Stop each instance in turn and repeat the canary to test failover.
8. Set `DRAND_RELAYER_REDUNDANCY_CONFIRMED=true` only after the two-host
   failover evidence has been archived.

The final canary necessarily occurs after coordinator deployment because the
event address and deployment block do not exist earlier. It remains a launch
gate: gameplay/public acquisition is not opened until the canary passes.

## Explicit single-relayer exception

When a second independent host is intentionally deferred:

1. Keep `DRAND_RELAYER_REDUNDANCY_CONFIRMED=false`.
2. Validate the single service, alerts, funded submitter, bounded log RPC and
   canary exactly as above, except for the failover steps.
3. Set `DRAND_SINGLE_RELAYER_RISK_ACCEPTED=true` in the private release env.
4. Treat any fairness alert or relayer outage as a reason to close acquisitions
   through the prepared Safe action until service is restored.

This exception accepts liveness/fairness risk only. The relayer remains permissionless and
untrusted for randomness integrity: every beacon signature is still verified by the registry and
coordinator on-chain. The same unprivileged submitter also calls `processAcquisitions` after a word
is ready so the canonical FIFO advances without requiring a user transaction; the core contract
fixes ordering and selection.
