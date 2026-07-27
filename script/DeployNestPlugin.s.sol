// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {FWANestPlugin} from "../src/hyperevm/FWANestPlugin.sol";
import {FWATokenNest} from "../src/hyperevm/FWATokenNest.sol";
import {INestAlgebraPool} from "../src/hyperevm/interfaces/INestAlgebra.sol";

interface VmNestPluginDeploy {
    function envUint(string calldata name) external returns (uint256 value);
    function envAddress(string calldata name) external returns (address value);
    function envBool(string calldata name) external returns (bool value);
    function addr(uint256 privateKey) external returns (address keyAddr);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

/// @notice Nest phase B: deploy the FWA plugin after Nest has created the uninitialized pair.
contract DeployNestPlugin {
    VmNestPluginDeploy internal constant vm =
        VmNestPluginDeploy(address(uint160(uint256(keccak256("hevm cheat code")))));
    uint256 internal constant HYPEREVM_TESTNET_CHAIN_ID = 998;
    uint256 internal constant HYPEREVM_MAINNET_CHAIN_ID = 999;

    event NestPluginPrepared(
        address indexed token,
        address indexed pool,
        address indexed plugin,
        address liquidityLocker,
        uint16 requiredFee,
        uint16 requiredCommunityFee,
        uint8 requiredPluginConfig
    );

    error UnauthorizedDeployer();
    error MainnetNotConfirmed();
    error InvalidPool();
    error PoolAlreadyInitialized();
    error WrongChain(uint256 actual);

    function run() external returns (FWANestPlugin plugin) {
        if (block.chainid != HYPEREVM_TESTNET_CHAIN_ID && block.chainid != HYPEREVM_MAINNET_CHAIN_ID) {
            revert WrongChain(block.chainid);
        }
        if (block.chainid == HYPEREVM_MAINNET_CHAIN_ID && !vm.envBool("NEST_MAINNET_DEPLOYMENT_CONFIRMED")) {
            revert MainnetNotConfirmed();
        }
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);
        FWATokenNest token = FWATokenNest(payable(vm.envAddress("FWA_TOKEN_ADDRESS")));
        address locker = vm.envAddress("FWA_NEST_LIQUIDITY_LOCKER_ADDRESS");
        if (token.owner() != deployer) revert UnauthorizedDeployer();

        address pool = token.FACTORY().poolByPair(token.WHYPE(), address(token));
        if (pool == address(0) || pool.code.length == 0) revert InvalidPool();
        (uint160 price,,,,,) = INestAlgebraPool(pool).globalState();
        if (price != 0) revert PoolAlreadyInitialized();

        vm.startBroadcast(deployerKey);
        plugin = new FWANestPlugin(pool, address(token), token.WHYPE());
        token.setMarketInfrastructure(address(plugin), locker);
        vm.stopBroadcast();

        emit NestPluginPrepared(
            address(token),
            pool,
            address(plugin),
            locker,
            token.POOL_FEE(),
            token.REQUIRED_COMMUNITY_FEE(),
            token.REQUIRED_PLUGIN_CONFIG()
        );
    }
}
