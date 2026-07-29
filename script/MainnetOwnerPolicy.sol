// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @notice Shared fail-closed policy for selecting the administrative owner on HyperEVM mainnet.
/// @dev Contract owners remain supported. An EOA is accepted only when the operator explicitly
///      acknowledges the single-key risk and the EOA is exactly the transaction deployer.
library MainnetOwnerPolicy {
    error InvalidMainnetOwner(address owner, address deployer, bool eoaRiskAccepted);
    error UnexpectedConfiguredOwner(address actual, address configured);

    function validateDeploymentOwner(address owner, address deployer, bool eoaRiskAccepted) internal view {
        if (owner == address(0)) revert InvalidMainnetOwner(owner, deployer, eoaRiskAccepted);
        if (owner.code.length == 0 && (!eoaRiskAccepted || owner != deployer)) {
            revert InvalidMainnetOwner(owner, deployer, eoaRiskAccepted);
        }
    }

    function validateConfiguredOwner(address actual, address configured, bool eoaRiskAccepted) internal view {
        if (actual != configured) revert UnexpectedConfiguredOwner(actual, configured);
        if (actual == address(0) || (actual.code.length == 0 && !eoaRiskAccepted)) {
            revert InvalidMainnetOwner(actual, configured, eoaRiskAccepted);
        }
    }
}
