/**
 * Launch controls that intentionally require a reviewed code release to change.
 *
 * HWA rewards started accruing during the mainnet canary, but distribution must
 * stay closed until the public token launch. Keep the write-path guard in the
 * protocol client as well as the disabled controls in the UI.
 */
export const HWA_REWARD_CLAIMS_PAUSED = true;

/** Public NFT deposits are open; acquisition spins remain independently gated. */
export const HWA_NFT_DEPOSITS_PAUSED = false;

/**
 * Master write gate. Deposits are open; per-flow and on-chain gates keep
 * acquisition spins and reward claims closed independently.
 */
export const HWA_PROTOCOL_OPERATIONS_PAUSED = false;
