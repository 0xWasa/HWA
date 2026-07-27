// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {
    NestTestnetFactory,
    NestTestnetPositionManager,
    NestTestnetSwapRouter
} from "../src/hyperevm/testnet/NestTestnetHarness.sol";

interface VmNestTestnetHarnessDeploy {
    function envUint(string calldata name) external returns (uint256 value);
    function envBool(string calldata name) external returns (bool value);
    function envOr(string calldata name, address defaultValue) external returns (address value);
    function addr(uint256 privateKey) external returns (address keyAddr);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

/// @notice Deploys a clearly-labelled, non-official Algebra harness for chain-998 E2E tests.
contract DeployNestTestnetHarness {
    VmNestTestnetHarnessDeploy internal constant vm =
        VmNestTestnetHarnessDeploy(address(uint160(uint256(keccak256("hevm cheat code")))));

    uint256 internal constant HYPEREVM_TESTNET_CHAIN_ID = 998;
    address internal constant TESTNET_WHYPE = 0x5555555555555555555555555555555555555555;

    event NestTestnetHarnessDeployed(
        address indexed administrator,
        address indexed factory,
        address indexed positionManager,
        address router,
        address whype
    );

    error WrongChain(uint256 actual);
    error DeploymentNotConfirmed();
    error InvalidContract();
    error VerificationFailed();

    function run()
        external
        returns (NestTestnetFactory factory, NestTestnetPositionManager positionManager, NestTestnetSwapRouter router)
    {
        if (block.chainid != HYPEREVM_TESTNET_CHAIN_ID) revert WrongChain(block.chainid);
        if (!vm.envBool("FWA_NEST_TEST_STACK_CONFIRMED")) revert DeploymentNotConfirmed();

        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);
        address whype = vm.envOr("NEST_WHYPE", TESTNET_WHYPE);
        if (deployer == address(0) || whype.code.length == 0) revert InvalidContract();

        vm.startBroadcast(deployerKey);
        factory = new NestTestnetFactory(deployer);
        positionManager = new NestTestnetPositionManager(address(factory), whype);
        router = new NestTestnetSwapRouter(address(factory), whype);
        factory.setInfrastructure(address(positionManager), address(router));
        vm.stopBroadcast();

        if (
            factory.owner() != deployer || factory.positionManager() != address(positionManager)
                || factory.router() != address(router) || positionManager.factory() != address(factory)
                || router.factory() != address(factory) || positionManager.WNativeToken() != whype
                || router.WNativeToken() != whype
        ) revert VerificationFailed();

        emit NestTestnetHarnessDeployed(deployer, address(factory), address(positionManager), address(router), whype);
    }
}
