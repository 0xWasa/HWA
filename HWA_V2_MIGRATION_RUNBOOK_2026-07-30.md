# HWA v2 migration runbook — 20k USD launch FDV

Status: implementation and tests complete; no HWA v2 mainnet transaction has been broadcast.

## Frozen economics

- Fixed supply: `1,000,000,000 HWA`.
- Migration: 1:1 for eligible liquid HWA v1 balances, plus a separate exact compensation for legacy rewards already earned but not yet claimable.
- Project X launch LP: `125,000,000 HWA` (12.5% of supply), one-sided and permanently locked.
- Range: widest valid one-sided Project X range, mirrored according to HWA/WHYPE token ordering, reaching tick `-887200` or `+887200`.
- Target launch FDV: approximately `20,000 USD`, converted to HYPE immediately before the deployment simulation.
- Seasonal rewards: `100,000,000 HWA`, with three 15-day budgets of `50M`, `30M`, then `20M`.
- Ecosystem vesting: `100,000,000 HWA`, immutable 90-day cliff and 730-day duration.
- Any supply not required by LP, migration, reward compensation, seasons, or vesting is sent to `0x000000000000000000000000000000000000dEaD`. This preserves the nominal 1B supply while preventing the surplus from becoming sell pressure.

## Volatility and exit liquidity

At 20k USD FDV, the 125M launch inventory has an initial mark value of only 2,500 USD. With the 1% Project X fee and no sells, the full-range constant-product approximation is:

| Gross buy pressure | Estimated price / FDV move |
| ---: | ---: |
| 1,000 USD | +94.8816% (x1.948816) |
| 5,000 USD | +788.04% (x8.8804) |
| 10,000 USD | +2,360.16% (x24.6016) |
| 40,000 USD | +28,258.56% (x283.5856) |

The pool launches with HWA inventory and no HYPE inventory. Sellers can only withdraw HYPE previously supplied by buyers. A high displayed market cap therefore does not represent cash that all holders can exit at once; large sells reverse the curve with extreme negative price impact. This is intentional for the selected volatility profile.

## Legacy rewards preservation

Read-only state checked at HyperEVM block `41849020`:

- reward emission had started;
- claims remained disabled;
- `819,680.124158439997849925 HWA` had been unlocked;
- `99,180,319.875841560002150075 HWA` remained in the seasonal reserve;
- no seasonal HWA had been burned;
- the reward contract still held exactly `100,000,000 HWA`.

The final snapshot generator adds each wallet's unclaimed depositor credit, pending active-listing reward, and pro-rata purchaser epoch reward to its liquid 1:1 allocation. The new seasons still receive exactly 100M HWA; legacy earned rights are funded from the migration allocation, not deducted from or silently reset inside the new seasonal budget.

## Mandatory cutover order

1. Disable new v1 deposits and acquisitions. Do not open legacy reward claims during snapshot preparation.
2. Settle or refund every pending acquisition. Wait for the active reward epoch to close and finalize it; the snapshot script rejects pending acquisitions and unfinalized closed epochs.
3. Add the legacy token and rewards addresses to the authorized archive log RPC list. Generate the final snapshot at a fixed block and publish the block hash, exclusions, Merkle root, proofs, liquid total, and legacy reward compensation total.
4. Independently verify that reconstructed balances equal v1 `totalSupply()` at the snapshot block and that the migration allocation is at most 675M HWA.
5. Deploy the new core and splitter in withdraw/operation-disabled mode.
6. Convert 20,000 USD to a HYPE FDV using the deployment-time HYPE/USD reference, derive both token-order sqrt prices, and double-enter the selected sqrt price and narrow allowed HYPE-FDV bounds.
7. Deploy HWA v2 and the locked 125M full-range LP with external buys disabled.
8. Deploy and fund the immutable migration distributor and ecosystem vesting; retire excess allocation; confirm exactly 100M remains for rewards.
9. Deploy the adapter and rewards module; fund exactly 100M and verify 50M/30M/20M season budgets. Keep claims, external token buys, acquisitions, and deposits closed.
10. Update the production manifest and UI to mark the old pool/token as legacy and expose migration proofs.
11. Run the complete read-only verification gate. Public activation requires a separate, explicit owner authorization after all addresses and amounts are reviewed.

## Required final confirmations

The deployment scripts intentionally require separate confirmations for: 20k USD FDV, 125M LP tokenomics, widest range, permanent LP lock, snapshot/exclusions, allocations, reward funding, module wiring, and mainnet broadcast. A simulation revert prevents broadcast when any price, owner, balance, range, or allocation invariant differs.