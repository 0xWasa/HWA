# HWA HyperEVM event indexer

Goldsky-compatible subgraph for HyperEVM chain 998/999. It indexes FWA listings,
acquisitions, activity and current ERC-721 ownership for every collection in the
deployment manifest. The frontend uses it only for discovery and history; price,
ownership, approvals and settlement state are revalidated against the contracts
before a signature.

HyperEVM is supported by Goldsky on mainnet and testnet. The default Hyperliquid
RPC limits `eth_getLogs` to 50 blocks and does not expose historical state, which
is why the browser must not be the production indexer:

- https://docs.goldsky.com/chains/hyperevm
- https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/hyperevm/json-rpc
- https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/hyperevm/raw-hyperevm-block-data

## Deterministic build

```powershell
npm ci
npm run render:testnet
npm run build
npm audit --omit=dev
```

`render:mainnet` reads `frontend/public/deployments/hyperevm-mainnet-999.json`.
It fails if any allowlisted collection lacks `deploymentBlock`, because starting
after the first mint would produce an incomplete wallet inventory.

```powershell
npm run render:mainnet
npm run build
goldsky subgraph deploy hwa-hyperevm/1.0.0 --path .
```

The last command is an external publication and must only run after the mainnet
manifest and deployment block have been reviewed. Put the resulting public query
URL in `NEXT_PUBLIC_INDEXER_URL`; never expose the Goldsky deployment API key.

## Security boundary

- The subgraph endpoint is untrusted, cacheable read infrastructure.
- Every card returned by the indexer is re-read from `FWA.listings` before use.
- Wallet NFT ownership and approval are re-read on-chain before deposit.
- Acquisition quotes and every write guard stay on-chain.
- `_meta.block.number` is compared with the RPC head and lag is visible in UI.
- Graph CLI packages are build-only dependencies. `npm audit --omit=dev` is the
  production dependency gate; run the CLI only on this repository's reviewed
  manifest/ABI in an isolated CI runner.

FWA emits the same economic events for purchaser actions and equivalent
depositor timeout actions (`NFTKept` / `DepositorBidAccepted`). The index therefore
records the economic outcome faithfully but does not invent an initiator that the
event itself does not expose.
