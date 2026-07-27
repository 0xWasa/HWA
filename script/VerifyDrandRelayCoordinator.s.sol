// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {FWA} from "fwa-reference/src/FWA.sol";

import {DrandRelayCoordinator} from "../src/hyperevm/DrandRelayCoordinator.sol";

interface VmVerifyDrandRelay {
    function envAddress(string calldata name) external view returns (address value);
}

/// @notice Read-only verification of the active HyperEVM testnet drand-relay wiring.
contract VerifyDrandRelayCoordinator {
    VmVerifyDrandRelay internal constant vm =
        VmVerifyDrandRelay(address(uint160(uint256(keccak256("hevm cheat code")))));

    uint256 internal constant HYPEREVM_TESTNET_CHAIN_ID = 998;
    bytes32 internal constant EVMNET_CHAIN_HASH = 0x04f1e9062b8a81f848fded9c12306733282b2727ecced50032187751166ec8c3;

    error WrongChain(uint256 actual);
    error MissingCode(address target);
    error InvalidWiring();

    function run() external view {
        if (block.chainid != HYPEREVM_TESTNET_CHAIN_ID) revert WrongChain(block.chainid);

        FWA fwa = FWA(vm.envAddress("FWA_ADDRESS"));
        DrandRelayCoordinator coordinator =
            DrandRelayCoordinator(payable(vm.envAddress("FWA_DRAND_COORDINATOR_ADDRESS")));
        if (address(fwa).code.length == 0) revert MissingCode(address(fwa));
        if (address(coordinator).code.length == 0) revert MissingCode(address(coordinator));

        (address activeCoordinator, uint256 subId) = fwa.vrfCoordinatorAndSubId();
        (,,, address subscriptionOwner, address[] memory consumers) = coordinator.getSubscription(subId);
        if (
            activeCoordinator != address(coordinator) || subId != coordinator.SUBSCRIPTION_ID()
                || coordinator.consumer() != address(fwa) || coordinator.DRAND_CHAIN_HASH() != EVMNET_CHAIN_HASH
                || coordinator.DRAND_PERIOD_SECONDS() != 3 || subscriptionOwner != coordinator.owner()
                || consumers.length != 1 || consumers[0] != address(fwa)
        ) revert InvalidWiring();
    }
}
