# HWA v2 migration runbook — FWA economic parity

Status: implementation/testing in progress; no HWA v2 mainnet deployment transaction has been broadcast.

## Frozen economics

- Fixed supply: `1,000,000,000 HWA`.
- Project X launch LP: `500,000,000 HWA`, matching FWA's 50% launch allocation; principal permanently locked.
- Rewards: `300,000,000 HWA` over 15 days, matching FWA: `150M` for depositors and `150M` for purchasers.
- Legacy allocation: `200,000,000 HWA`, matching FWA's remaining 20% bucket. For HWA it contains:
  - up to `100,000,000 HWA` for liquid 1:1 migration plus legacy rewards already earned;
  - `100,000,000 HWA` in the existing ecosystem vesting schedule;
  - any unused migration amount permanently retired at `0x000000000000000000000000000000000000dEaD`.
- Target launch FDV: approximately `40,000 USD`.
- Range: FWA's near-full-range shape mirrored for HWA/WHYPE and rounded only as required by Project X tick spacing `200`, reaching usable tick `-887200` or `+887200`.

Project X imposes a 1% pool fee and a 200 tick spacing. Those venue-level constraints prevent byte-for-byte pool identity with FWA, but supply, LP share, reward quantity/duration, legacy share, launch FDV, and one-sided near-full-range economics match FWA.

## Expected volatility and exits

At 40k USD FDV, the 500M launch inventory has an initial mark value of 20k USD. With the 1% Project X fee and no sells, the full-range approximation is:

| Gross buy pressure | Estimated price / FDV move |
| ---: | ---: |
| 1,000 USD | +10.145025% (x1.10145025) |
| 5,000 USD | +55.625625% (x1.55625625) |
| 10,000 USD | +123.5025% (x2.235025) |
| 40,000 USD | +788.04% (x8.8804) |

The one-sided pool starts without HYPE inventory. Sellers can only withdraw HYPE previously supplied by buyers, so displayed market cap is not simultaneously realizable exit liquidity.

## Legacy rewards preservation

The currently deployed HWA rewards v2 contract differs from FWA and must be treated as legacy state. At the read-only check block `41849020`, it had unlocked `819,680.124158439997849925 HWA`, retained `99,180,319.875841560002150075 HWA` in its seasonal reserve, had burned none, and still held 100M HWA while claims were disabled.

The final migration snapshot adds each wallet's liquid HWA v1 balance and exact unclaimed legacy reward entitlement. The new market then starts the independent FWA-parity reward schedule of 300M HWA over 15 days.

## Mandatory cutover order

1. Close v1 acquisitions and enter withdraw-only mode; keep legacy token external buys disabled.
2. Settle or refund every pending acquisition and wait for/finalize the active legacy reward epoch.
3. Authorize legacy token and rewards addresses on the archive log RPC. Generate and publish the final fixed-block snapshot, block hash, exclusions, Merkle root, proofs, and totals.
4. Verify reconstructed balances equal v1 total supply and migration plus reward compensation is at most 100M HWA.
5. Deploy the new core and supporting modules fail-closed.
6. Convert 40,000 USD to HYPE at deployment time; derive and double-enter the selected sqrt price and narrow HYPE-FDV bounds.
7. Deploy HWA v2, its one-sided 500M near-full-range position and permanent LP locker with public buys disabled.
8. Fund the immutable migration distributor, the 100M ecosystem vesting, retire unused legacy allocation, and verify exactly 300M remains with the owner.
9. Deploy/fund FWA-parity rewards with exactly 150M depositor plus 150M purchaser emission over 15 days. Keep acquisitions, emission, deposits, and external buys closed; the FWA rewards contract has no claim-pause switch, but has no claimable emission before activation.
10. Publish the new production manifest and migration UI; label v1 token/pool as legacy.
11. Run the complete read-only verification gate, then activate only after a separate final owner confirmation of the emitted addresses and amounts.