# Production RPC logs/archive decision

Date: 27 July 2026  
Status: **provider selected conditionally; credentialed qualification BLOCKED**

## Decision

Use the official Hyperliquid RPC as the browser read/transaction endpoint and a distinct,
server-only HyperliquidRPC archive endpoint for recovery logs and historical reads.

The emergency endpoint is exposed to the browser only through `/api/rpc/logs`. That proxy accepts
only `eth_getLogs`, enforces the deployed HWA address allowlist, exact block bounds, a qualified
maximum range, response-size and request-rate limits, and never exposes the provider key.

## Evidence and alternatives

- Hyperliquid's official RPC documents a maximum `eth_getLogs` range of 50 blocks and does not
  provide historical state. It is unsuitable for an indexer recovery lane.
- HyperliquidRPC documents archive access and log ranges of a few thousand blocks, matching HWA's
  bounded checkpoint/recovery design. It is the preferred production candidate.
- QuickNode nanoreth and Chainstack archive are acceptable fallbacks, but their published
  HyperEVM log guidance/limits do not currently improve on the official endpoint enough to select
  them without a successful credentialed probe.

Primary references:

- https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/hyperevm/json-rpc
- https://hyperliquidrpc.com/docs/rpc/hyperevm
- https://hyperliquidrpc.com/solutions/hyperevm

## Mandatory qualification

No SLA or marketing claim is accepted as a test result. Populate the server-only values in a local
mainnet environment and run:

```powershell
Copy-Item .env.mainnet.example .env.mainnet.local
# Fill HYPEREVM_LOG_RPC_PROVIDER=HyperliquidRPC,
# HYPEREVM_LOG_RPC_UPSTREAM_URL=https://rpc.hyperliquidrpc.com,
# HYPEREVM_LOG_RPC_API_KEY=<local secret>, HYPEREVM_LOG_RPC_API_KEY_HEADER=x-api-key,
# and HYPEREVM_LOG_RPC_MAX_BLOCK_RANGE=2500.
. .\scripts\ImportEnvFile.ps1 -Path .env.mainnet.local
.\scripts\TestLogRpc.ps1
```

The generated `release/log-rpc-probe-999.json` must demonstrate:

- chain ID 999;
- a successful historical block and historical state read;
- at least a 1,000-block bounded `eth_getLogs` request;
- a historical wHYPE `Transfer` log query;
- a successful bounded burst test;
- provider name, endpoint-host fingerprint, tested head/range/depth and timestamp, with no secret.

`scripts/TestReleaseCandidate.ps1 -MainnetMode` rejects a missing, stale (over seven days),
mismatched or under-range report. The remaining blocker is a HyperliquidRPC production API key;
the secret belongs only in the deployment platform and a local ignored mainnet environment.
