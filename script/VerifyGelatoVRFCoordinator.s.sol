// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {FWA} from "fwa-reference/src/FWA.sol";
import {GelatoVRFCoordinator} from "../src/hyperevm/GelatoVRFCoordinator.sol";

interface VmVerifyGelatoVRF {
    function envAddress(string calldata name) external view returns (address value);
}

/// @notice Read-only mainnet attestation for the Gelato VRF compatibility coordinator.
contract VerifyGelatoVRFCoordinator {
    VmVerifyGelatoVRF internal constant vm = VmVerifyGelatoVRF(address(uint160(uint256(keccak256("hevm cheat code")))));

    uint256 internal constant HYPEREVM_MAINNET_CHAIN_ID = 999;

    error WrongChain(uint256 actual);
    error MissingCode(address target);
    error InvalidWiring();

    function run() external view {
        if (block.chainid != HYPEREVM_MAINNET_CHAIN_ID) revert WrongChain(block.chainid);

        FWA fwa = FWA(vm.envAddress("FWA_ADDRESS"));
        GelatoVRFCoordinator coordinator =
            GelatoVRFCoordinator(payable(vm.envAddress("FWA_GELATO_COORDINATOR_ADDRESS")));
        address expectedOperator = vm.envAddress("GELATO_VRF_OPERATOR_ADDRESS");
        if (address(fwa).code.length == 0) revert MissingCode(address(fwa));
        if (address(coordinator).code.length == 0) revert MissingCode(address(coordinator));
        if (expectedOperator.code.length == 0) revert MissingCode(expectedOperator);

        (address activeCoordinator, uint256 subId) = fwa.vrfCoordinatorAndSubId();
        (,,, address subscriptionOwner, address[] memory consumers) = coordinator.getSubscription(subId);
        if (
            activeCoordinator != address(coordinator) || subId != coordinator.SUBSCRIPTION_ID()
                || coordinator.OPERATOR() != expectedOperator || coordinator.consumer() != address(fwa)
                || coordinator.owner() != fwa.owner() || subscriptionOwner != fwa.owner() || consumers.length != 1
                || consumers[0] != address(fwa)
        ) revert InvalidWiring();
    }
}
