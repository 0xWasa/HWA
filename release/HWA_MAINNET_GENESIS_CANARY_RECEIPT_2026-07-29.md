# HWA HyperEVM mainnet Genesis canary receipt

Date: 2026-07-29  
Chain: HyperEVM mainnet (`999`)  
Core: `0x4E010e44E6369A92c090069833144901a92bed5E`  
Canary collection: HWA Genesis (`0x89D52133B105E9548Df16dE4d7cf59c412daf191`)  
Token: Genesis #1  
Backing: `0.25 HYPE`  
Settlement branch: `keepNFT`

## Result

The single-item canary completed successfully from deposit through verified drand randomness, ordered processing and purchaser settlement. The public application remains fail-closed. Core acquisitions were closed again after settlement and Project X external HWA buys were never opened.

Final safety state:

- `acquisitionsEnabled() == false`
- `externalBuysEnabled() == false`
- `withdrawOnly() == false`
- active listings: `0`
- staged listings: `0`
- pending acquisitions: `0`
- unsettled acquisitions: `0`
- unfulfilled VRF requests: `0`
- acquisition escrow: `0`
- refund credit total: `0`
- Goldsky indexing errors: `false`
- production manifest: `writesEnabled=false`, `acquisitionsEnabled=false`

## Release gate

`scripts/TestReleaseCandidate.ps1 -MainnetMode` passed before activation with zero skipped steps and no broadcasts:

- 178 Solidity tests
- 3 Project X mainnet fork tests
- 4 V3 compatibility fork tests
- 82 frontend unit tests
- 37 Playwright E2E tests
- frontend and indexer production builds
- live chain-999 core, drand, Project X and activation-readiness attestations

See `release/release-gate-last-run.json` for the machine-readable report.

## Transactions

| Step | Transaction | Result |
|---|---|---|
| Start Splitter revenue clock | `0xc73654c132f234d619a29b009c2aaf7a9d65bc83a6f79466b10421640412f3a0` | success |
| Allowlist only HWA Genesis | `0x0fcf71d3fafcec74a52378215d1c1ca97e056c9b5660c6e2a36350c2e0ce9714` | success |
| Enable acquisitions for canary | `0x46dc4e248fcdfa64466030334be05198f60fce7afacdb9df8f747ebfacbb2354` | success |
| Fund isolated purchaser wallet | `0x7792da635e3d7b183a08787fd992ce8adfa70fd5914eb8351daa273d7b233a69` | success |
| Approve Genesis #1 | `0xcf1f0b7b9fb86ca498011683c13158be33f14d329bd9bc268fca720c7cc63954` | success |
| List Genesis #1 with 0.25 HYPE | `0x5c010f6cc80aa7d7ec3ccf89d5b01a4a4da7ba071c1ff36d98fabbf35908d0ee` | success |
| Manual acquisition attempt quoted without an explicit gas price | `0x56863195c17cf01edce6d73c7a51a8013a00e137356b5713d299f1c05556e890` | reverted, no state change |
| Submit one acquisition with gas-price fee margin | `0xcadf84bec479205e7d909b03628d1b30f17a09c178cd983e063b889db7c98c03` | success |
| Fulfill request with verified drand round 19273113 | `0x341833d3f7c76b8a6150c0b7f4a3672f4ba03c4812cc733eefa3427f371246d8` | success |
| Permissionless ordered processing | `0x2cd6c16bf5201891309e88b5ee1da183070448460cc2b539fecd0a7344395d64` | success |
| Purchaser keeps Genesis #1 | `0xec2255d4c9f1824f4e990c252ef8769499acd2895ac5c4ff0327426cbbf85626` | success |
| Close acquisitions after canary | `0xbb75c2142be1543056d43831cc2e54e4de86cd3943fab940e7bacc1e1647ed8d` | success |

The reverted manual attempt was caused by quoting the drand service through `eth_call` without the transaction gas price. The service fee is intentionally based on `tx.gasprice`. The production client already quotes with an explicit gas price and pins that same gas price on the acquisition transaction; the canary retry used a small refundable overpayment margin.

## Randomness and ordered processing

- FWA request ID: `30100636771318882468562993656909383309826698341595825919007677696350406024699`
- local FIFO sequence: `1`
- target drand round: `19273113`
- beacon randomness: `0x97292dea0a435349b06ac8ca7f8c94520bdce5ccfb000360d0c98b7778c9c491`
- derived word: `99052927831576114266814935346969379835643223524580749369125955629313466913939`
- coordinator status: fulfilled
- FWA acquisition status: fulfilled
- selected listing: `1`
- next FIFO sequence to process: `2`

The authenticated callback cached the result as `Ready`. Its best-effort fast path did not settle within the callback gas stipend, so the audited permissionless `processAcquisitions(1)` path finalized the head of the queue.

## Settlement and accounting

Goldsky and direct on-chain reads agree:

- listing #1 status: `settled`
- settlement: `kept`
- Genesis #1 owner: `0x6B3248cf1b82E6BD4c2AB955FF01f99c0ea03290`
- backing returned/credited to the depositor through settlement: `0.2475 HYPE`
- depositor acquisition earnings credit: `0.2475 HYPE`
- accrued owner fees: `0.005 HYPE`
- core balance: `0.2525 HYPE`

The final core balance exactly covers the remaining enumerated liabilities: `0.2475 + 0.005 = 0.2525 HYPE`.

## Deliberately not executed

- no public collection allowlisting
- no production manifest promotion
- no frontend write enablement
- no external HWA buy opening
- no Project X public trading launch
- no payout or withdrawal of the canary fee credits

