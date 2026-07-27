# HyperEVM 998 test plan

## Safety and identities

- Use only a dedicated testnet seed with no mainnet assets.
- Keep private keys in the local, ignored `.env`; never record them in this file or deployment logs.
- Use distinct actors for deployer/owner, depositor, purchaser and snapshot holder before final E2E.
- Store the three actor private keys only in the ignored `.env`; the snapshot holder doubles as the
  testnet secondary owner, while mainnet recipients remain a separate decision.
- Verify `chainid == 998`, bytecode, balances and transaction receipts before continuing to the next phase.
- Keep every mainnet and irreversible-action flag false.

## Gates

| Gate | Evidence required |
| --- | --- |
| Wallet | Valid key format, derived public address, testnet HYPE balance |
| NFT fixtures | Snapshot, gameplay and hostile collection bytecode plus owner/supply checks |
| Project X | No official 998 deployment: version-pinned V3 ABI-compatible venue, explicitly labelled non-official |
| Randomness | Drand coordinator deployed and bound; authorized relayer funded; two public endpoints agree |
| Activation | Every verification script and E2E row passes before acquisitions/external buys open |

## Deployment order

1. Deploy the three test NFT fixtures and mint them to the actors.
2. Deploy `SplitterHyperEVM` against the four-token snapshot collection.
3. Preserve the deployed core FWA, `FWAVRFService`, `PoPRandomnessAdapter` and `FWAWhitelist`.
4. Deploy the Project X-compatible V3 stack against the version-pinned test venue.
5. Deploy `$HWA` (`Hyper World Assets` / `HWA`), the LP locker, pool, adapter and rewards.
6. Deploy `DrandRelayCoordinator`, bind FWA as its consumer, then migrate only with zero pending requests.
7. Verify every contract address, owner, immutable, balance and cross-contract reference.
8. Start the drand relayer, exercise public-beacon callbacks, then run the full gameplay matrix.

## E2E matrix

### NFT pool and custody

- allowlisted and rejected collection deposits;
- active and staged listings, FIFO activation and withdrawal;
- inverse-weight accounting and listing caps;
- hostile transfer revert without partial state changes;
- strict delivery and best-effort stuck-NFT recovery.

### Randomness and settlement

- single and batch acquisitions from one to five NFTs;
- concurrent requests and committed request-time batches;
- callback authentication, duplicate callback rejection and request ordering;
- exact target-round binding, pre-round rejection, two-endpoint agreement and public signature audit;
- relayer rotation, callback retry and coordinator migration with no request in flight;
- timeout/refund and late callback behavior;
- keep, relist, purchaser/depositor choices and permissionless finalization.

### Revenue, rewards and token market

- Splitter 70/30 allocation and secondary-owner tenth of the owner side;
- cumulative claims and claim rights after snapshot NFT transfer;
- fee liabilities and pull payments under reverting recipients;
- depositor and purchaser emission checkpoints;
- Project X buy/sell gates, 1% fee, tick spacing 200, slippage/full-fill constraints and pool wiring;
- buyback routing 40/40/20 and caller bounty;
- LP NFT permanently held by the locker and fee collection routed correctly.

### Administration and negative cases

- owner-only setters, pause/withdraw-only modes and activation gates;
- wrong chain, zero address, missing code and mismatched dependency reverts;
- unauthorized NFT, randomness, reward and market callbacks;
- gas use recorded for deposit, acquisition, callback, settlement, claim and buyback.

The 365-day Splitter sweep remains a time-warped local test because live testnet time cannot be advanced.

## Completion artifact

`TESTNET_998_DEPLOYMENTS.md` will record public addresses, transaction hashes, owners, parameters, bytecode hashes,
gas measurements and a pass/fail line for every E2E scenario. It must never contain a private key or mnemonic.
