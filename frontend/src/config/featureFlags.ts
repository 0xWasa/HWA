/**
 * Launch controls that intentionally require a reviewed code release to change.
 *
 * HWA rewards started accruing during the mainnet canary, but distribution must
 * stay closed until the public token launch. Keep the write-path guard in the
 * protocol client as well as the disabled controls in the UI.
 */
export const HWA_REWARD_CLAIMS_PAUSED = true;

/** New NFT deposits are closed while launch inventory and economics are reviewed. */
export const HWA_NFT_DEPOSITS_PAUSED = true;

/**
 * Master public-launch lock. Read access and emergency-safe exits remain
 * available, but every risk-increasing user flow stays disabled until a
 * reviewed release deliberately flips this flag.
 */
export const HWA_PROTOCOL_OPERATIONS_PAUSED = true;
