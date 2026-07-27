// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {FWATokenNest} from "../src/hyperevm/FWATokenNest.sol";
import {INestAlgebraPool} from "../src/hyperevm/interfaces/INestAlgebra.sol";

interface VmNestPoolConfigure {
    function envUint(string calldata name) external returns (uint256 value);
    function envAddress(string calldata name) external returns (address value);
    function envBool(string calldata name) external returns (bool value);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

/// @notice Nest phases C and E: install the plugin pre-init, then apply final settings post-init.
/// @dev This transaction requires Nest factory owner/POOLS_ADMINISTRATOR authority and is expected
///      to revert for ordinary FWA deployer keys.
contract ConfigureNestPool {
    VmNestPoolConfigure internal constant vm =
        VmNestPoolConfigure(address(uint160(uint256(keccak256("hevm cheat code")))));
    uint256 internal constant HYPEREVM_TESTNET_CHAIN_ID = 998;
    uint256 internal constant HYPEREVM_MAINNET_CHAIN_ID = 999;

    event NestPoolConfigured(
        address indexed pool, address indexed plugin, uint16 fee, uint16 communityFee, uint8 pluginConfig
    );

    error AdminActionNotConfirmed();
    error MainnetNotConfirmed();
    error InvalidPool();
    error ConfigurationFailed();
    error WrongChain(uint256 actual);

    function run() external {
        if (block.chainid != HYPEREVM_TESTNET_CHAIN_ID && block.chainid != HYPEREVM_MAINNET_CHAIN_ID) {
            revert WrongChain(block.chainid);
        }
        if (!vm.envBool("NEST_ADMIN_ACTIONS_CONFIRMED")) revert AdminActionNotConfirmed();
        if (block.chainid == HYPEREVM_MAINNET_CHAIN_ID && !vm.envBool("NEST_MAINNET_DEPLOYMENT_CONFIRMED")) {
            revert MainnetNotConfirmed();
        }
        uint256 administratorKey = vm.envUint("PRIVATE_KEY");
        FWATokenNest token = FWATokenNest(payable(vm.envAddress("FWA_TOKEN_ADDRESS")));
        INestAlgebraPool pool = INestAlgebraPool(token.pool());
        if (address(pool) == address(0) || address(pool).code.length == 0) revert InvalidPool();
        (uint160 price,, uint16 currentFee, uint8 currentConfig, uint16 currentCommunityFee,) = pool.globalState();
        address currentPlugin = pool.plugin();

        vm.startBroadcast(administratorKey);
        if (currentPlugin != token.plugin()) {
            pool.setPlugin(token.plugin());
            currentConfig = 0;
        }
        if (currentConfig != token.REQUIRED_PLUGIN_CONFIG()) {
            pool.setPluginConfig(token.REQUIRED_PLUGIN_CONFIG());
        }
        // Algebra overwrites fee/communityFee/tickSpacing with factory defaults during initialize.
        // Only apply their final values once the pool has a non-zero price.
        if (price != 0) {
            if (currentFee != token.POOL_FEE()) pool.setFee(token.POOL_FEE());
            if (currentCommunityFee != token.REQUIRED_COMMUNITY_FEE()) {
                pool.setCommunityFee(token.REQUIRED_COMMUNITY_FEE());
            }
            if (pool.tickSpacing() != token.POOL_TICK_SPACING()) {
                pool.setTickSpacing(token.POOL_TICK_SPACING());
            }
        }
        vm.stopBroadcast();

        (,, uint16 lastFee, uint8 config, uint16 communityFee,) = pool.globalState();
        if (pool.plugin() != token.plugin() || config != token.REQUIRED_PLUGIN_CONFIG()) revert ConfigurationFailed();
        if (
            price != 0
                && (pool.fee() != token.POOL_FEE()
                    || lastFee != token.POOL_FEE()
                    || communityFee != token.REQUIRED_COMMUNITY_FEE()
                    || pool.tickSpacing() != token.POOL_TICK_SPACING())
        ) revert ConfigurationFailed();
        emit NestPoolConfigured(address(pool), token.plugin(), pool.fee(), communityFee, config);
    }
}
