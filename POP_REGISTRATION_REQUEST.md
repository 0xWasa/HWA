# Proof of Play vRNG registration request

Use the official Proof of Play contact form: <https://z7a9jnrajv8.typeform.com/to/Ywh9xVFF>.

## Request payload

- Project: FWA HyperEVM fork — private testnet integration
- Network: HyperEVM testnet
- Chain ID: `998`
- vRNG provider: `0xd14D984603b0b7Ade91bE52f3Fc4A917Dfa77bcD`
- Contract to approve: `0x77073140E0C9d34fDB6b2E08Ae647D826b974aca`
- Contract role: `PoPRandomnessAdapter`; this is the direct caller seen by the vRNG provider
- FWA consumer behind the adapter: `0xeE5D51211422606815A71B7b2aD73f732ee6630F`
- Callback implemented by the adapter: `randomNumberCallback(uint256,uint256)`
- RPC: `https://rpc.hyperliquid-testnet.xyz/evm`
- Requested action: approve the adapter for early-access vRNG requests on HyperEVM testnet and confirm when active

Suggested message:

> Please approve `0x77073140E0C9d34fDB6b2E08Ae647D826b974aca` as a vRNG caller on HyperEVM testnet (chain ID 998). It is a dedicated adapter for `0xeE5D51211422606815A71B7b2aD73f732ee6630F` and implements `randomNumberCallback(uint256,uint256)`. Please confirm once the registration is active so we can run request/callback E2E tests.

## Current evidence and acceptance check

The provider address has deployed bytecode and matches Proof of Play's published HyperEVM testnet address. A
read-only request simulated with the adapter as caller currently reverts with `0x48f5c3ed = InvalidCaller()`, which
confirms that manual registration is still pending.

After Proof of Play confirms registration, repeat:

```powershell
& '.\.tools\foundry\cast.exe' call `
  0xd14D984603b0b7Ade91bE52f3Fc4A917Dfa77bcD `
  'requestRandomNumberWithTraceId(uint256)(uint256)' 0 `
  --from 0x77073140E0C9d34fDB6b2E08Ae647D826b974aca `
  --rpc-url https://rpc.hyperliquid-testnet.xyz/evm
```

Only set `POP_REGISTRATION_CONFIRMED=true` after `InvalidCaller()` disappears and Proof of Play has explicitly
confirmed the approval. The gameplay collection prepared for activation is
`0x0ACD941969228976Fc3FaE6c6560c1230d54F74a`.
