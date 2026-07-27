// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {FWA} from "fwa-reference/src/FWA.sol";
import {FWAConfigKeys} from "fwa-reference/src/FWAConfigKeys.sol";

import {DrandRelayCoordinator} from "../src/hyperevm/DrandRelayCoordinator.sol";

interface VmActivateDrandRelay {
    function envUint(string calldata name) external returns (uint256 value);
    function envBool(string calldata name) external returns (bool value);
    function envAddress(string calldata name) external returns (address value);
    function addr(uint256 privateKey) external returns (address keyAddr);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

interface IPendingCoordinator {
    function pendingRequestExists(uint256 subId) external view returns (bool);
}

/// @notice Safely migrates an idle FWA core from its current coordinator to DrandRelayCoordinator.
/// @dev If acquisitions are enabled, they are disabled before the coordinator switch and restored only
///      after success. A failed migration therefore leaves the system in the safer disabled state.
contract ActivateDrandRelayCoordinator {
    VmActivateDrandRelay internal constant vm =
        VmActivateDrandRelay(address(uint160(uint256(keccak256("hevm cheat code")))));

    uint256 internal constant HYPEREVM_TESTNET_CHAIN_ID = 998;

    event DrandRelayCoordinatorActivated(
        uint256 indexed chainId,
        address indexed fwa,
        address indexed previousCoordinator,
        address newCoordinator,
        bool acquisitionsRestored
    );

    error WrongChain(uint256 actual);
    error ActivationNotConfirmed();
    error InvalidAddress();
    error InvalidOwner();
    error InvalidWiring();
    error RequestsInFlight();
    error VerificationFailed();

    function run() external {
        if (block.chainid != HYPEREVM_TESTNET_CHAIN_ID) revert WrongChain(block.chainid);
        if (!vm.envBool("FWA_DRAND_ACTIVATION_CONFIRMED")) revert ActivationNotConfirmed();

        uint256 ownerKey = vm.envUint("PRIVATE_KEY");
        address owner = vm.addr(ownerKey);
        FWA fwa = FWA(vm.envAddress("FWA_ADDRESS"));
        DrandRelayCoordinator coordinator =
            DrandRelayCoordinator(payable(vm.envAddress("FWA_DRAND_COORDINATOR_ADDRESS")));
        if (address(fwa) == address(0) || address(coordinator) == address(0)) revert InvalidAddress();
        if (address(fwa).code.length == 0 || address(coordinator).code.length == 0) revert InvalidAddress();
        if (fwa.owner() != owner) revert InvalidOwner();
        if (coordinator.consumer() != address(fwa) || coordinator.SUBSCRIPTION_ID() != 1) revert InvalidWiring();

        (address previousCoordinator, uint256 subId) = fwa.vrfCoordinatorAndSubId();
        if (previousCoordinator == address(coordinator)) revert InvalidWiring();
        if (fwa.unsettledAcquisitionCount() != 0 || fwa.unfulfilledVrfCount() != 0) revert RequestsInFlight();
        if (IPendingCoordinator(previousCoordinator).pendingRequestExists(subId)) revert RequestsInFlight();
        if (coordinator.pendingRequestExists(subId)) revert RequestsInFlight();

        // FWA deliberately keeps this flag internal, so restoring it must be an explicit operator
        // decision rather than an inferred state. The safe default in .env.example is false.
        bool restoreAcquisitions = vm.envBool("FWA_DRAND_RESTORE_ACQUISITIONS");
        vm.startBroadcast(ownerKey);
        fwa.setBool(FWAConfigKeys.ACQUISITIONS_ENABLED, false);
        fwa.setAddr(FWAConfigKeys.VRF_COORDINATOR, address(coordinator));
        if (restoreAcquisitions) fwa.setBool(FWAConfigKeys.ACQUISITIONS_ENABLED, true);
        vm.stopBroadcast();

        (address activeCoordinator, uint256 activeSubId) = fwa.vrfCoordinatorAndSubId();
        if (activeCoordinator != address(coordinator) || activeSubId != coordinator.SUBSCRIPTION_ID()) {
            revert VerificationFailed();
        }

        emit DrandRelayCoordinatorActivated(
            block.chainid, address(fwa), previousCoordinator, address(coordinator), restoreAcquisitions
        );
    }
}
