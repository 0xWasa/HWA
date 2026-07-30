/**
 * Launch controls that intentionally require a reviewed code release to change.
 *
 * HWA v2 rewards use the FWA-parity 300M / 15-day reserve. Claims are
 * available after the explicit mainnet cutover. Keep the write-path guard in the
 * protocol client as well as the disabled controls in the UI.
 */
export const HWA_REWARD_CLAIMS_PAUSED = false;

/** Public NFT deposits are open; acquisition spins remain independently gated. */
export const HWA_NFT_DEPOSITS_PAUSED = false;

/**
 * Master write gate. Deposits are open; per-flow and on-chain gates keep
 * acquisition spins and reward claims closed independently.
 */
export const HWA_PROTOCOL_OPERATIONS_PAUSED = false;
