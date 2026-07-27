// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {FWA} from "fwa-reference/src/FWA.sol";

import {DrandRelayCoordinator} from "../src/hyperevm/DrandRelayCoordinator.sol";

interface VmDeployDrandRelay {
    function envUint(string calldata name) external returns (uint256 value);
    function envBool(string calldata name) external returns (bool value);
    function envAddress(string calldata name) external returns (address value);
    function envOr(string calldata name, uint256 defaultValue) external returns (uint256 value);
    function envOr(string calldata name, address defaultValue) external returns (address value);
    function addr(uint256 privateKey) external returns (address keyAddr);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

/// @notice Deploys and binds a drand-relay coordinator to the existing FWA consumer.
/// @dev This script does not activate the coordinator in FWA. Activation is deliberately separate.
contract DeployDrandRelayCoordinator {
    VmDeployDrandRelay internal constant vm =
        VmDeployDrandRelay(address(uint160(uint256(keccak256("hevm cheat code")))));

    uint256 internal constant HYPEREVM_TESTNET_CHAIN_ID = 998;

    event DrandRelayCoordinatorDeployed(
        uint256 indexed chainId,
        address indexed coordinator,
        address indexed fwa,
        address relayer,
        address owner,
        uint64 minRoundDelaySeconds
    );

    error WrongChain(uint256 actual);
    error DeploymentNotConfirmed();
    error InvalidAddress();
    error InvalidDelay();
    error VerificationFailed();

    function run() external returns (DrandRelayCoordinator coordinator) {
        if (block.chainid != HYPEREVM_TESTNET_CHAIN_ID) revert WrongChain(block.chainid);
        if (!vm.envBool("FWA_DRAND_DEPLOYMENT_CONFIRMED")) revert DeploymentNotConfirmed();

        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);
        address finalOwner = vm.envOr("FWA_OWNER", deployer);
        address relayer = vm.envAddress("FWA_DRAND_RELAYER");
        address fwaAddress = vm.envAddress("FWA_ADDRESS");
        uint256 delay = vm.envOr("FWA_DRAND_MIN_ROUND_DELAY_SECONDS", uint256(6));
        if (
            deployer == address(0) || finalOwner == address(0) || relayer == address(0) || fwaAddress == address(0)
                || fwaAddress.code.length == 0
        ) revert InvalidAddress();
        if (delay > type(uint64).max) revert InvalidDelay();

        vm.startBroadcast(deployerKey);
        coordinator = new DrandRelayCoordinator(relayer, deployer, uint64(delay));
        coordinator.setConsumer(fwaAddress);
        if (finalOwner != deployer) coordinator.transferOwnership(finalOwner);
        vm.stopBroadcast();

        if (
            coordinator.owner() != finalOwner || coordinator.consumer() != fwaAddress || !coordinator.isRelayer(relayer)
                || coordinator.SUBSCRIPTION_ID() != 1
        ) revert VerificationFailed();

        // A code-bearing FWA target is also checked through a stable view to reject unrelated contracts.
        FWA(fwaAddress).vrfCoordinatorAndSubId();
        emit DrandRelayCoordinatorDeployed(
            block.chainid, address(coordinator), fwaAddress, relayer, finalOwner, uint64(delay)
        );
    }
}
