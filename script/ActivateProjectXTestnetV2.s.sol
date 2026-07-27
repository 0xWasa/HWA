// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {FWA} from "fwa-reference/src/FWA.sol";
import {FWAWhitelist} from "fwa-whitelist-reference/src/FWAWhitelist.sol";

import {FWARewardsHyperEVM} from "../src/hyperevm/FWARewardsHyperEVM.sol";
import {SplitterHyperEVM} from "../src/hyperevm/SplitterHyperEVM.sol";

interface VmActivateProjectXTestnetV2 {
    function envUint(string calldata name) external returns (uint256 value);
    function envAddress(string calldata name) external returns (address value);
    function envBool(string calldata name) external returns (bool value);
    function addr(uint256 privateKey) external returns (address keyAddr);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

interface IDrandBN254LaunchReadiness {
    function consumer() external view returns (address);
    function launchReady() external view returns (bool);
    function pendingRequestCount() external view returns (uint256);
}

/// @notice Freezes the testnet-v2 revenue snapshot and allowlists the reviewed gameplay fixture.
/// @dev Acquisitions and public HWA buys intentionally remain closed. The live E2E script opens only
///      acquisitions after it has re-attested a clean core and funded the actors/randomness service.
contract ActivateProjectXTestnetV2 {
    VmActivateProjectXTestnetV2 internal constant vm =
        VmActivateProjectXTestnetV2(address(uint160(uint256(keccak256("hevm cheat code")))));

    uint256 internal constant TESTNET = 998;

    event ProjectXTestnetV2Staged(
        address indexed fwa, address indexed collection, address indexed splitter, uint256 sweepAvailableAt
    );

    error WrongChain(uint256 actual);
    error ActivationNotConfirmed();
    error UnauthorizedOwner();
    error UnsafeState();
    error InvalidWiring();

    function run() external {
        if (block.chainid != TESTNET) revert WrongChain(block.chainid);
        if (!vm.envBool("FWA_TESTNET_V2_ACTIVATION_CONFIRMED")) revert ActivationNotConfirmed();

        uint256 ownerKey = vm.envUint("OWNER_PRIVATE_KEY");
        address owner = vm.addr(ownerKey);
        FWA fwa = FWA(vm.envAddress("FWA_ADDRESS"));
        FWAWhitelist whitelist = FWAWhitelist(vm.envAddress("FWA_WHITELIST_ADDRESS"));
        SplitterHyperEVM splitter = SplitterHyperEVM(payable(vm.envAddress("FWA_SPLITTER_ADDRESS")));
        FWARewardsHyperEVM rewards = FWARewardsHyperEVM(vm.envAddress("FWA_REWARDS_ADDRESS"));
        IDrandBN254LaunchReadiness coordinator =
            IDrandBN254LaunchReadiness(vm.envAddress("FWA_DRAND_COORDINATOR_ADDRESS"));
        address collection = vm.envAddress("FWA_TESTNET_GAMEPLAY_COLLECTION");

        if (fwa.owner() != owner || whitelist.owner() != owner || splitter.owner() != owner) {
            revert UnauthorizedOwner();
        }
        if (
            fwa.acquisitionsEnabled() || fwa.activeListingCount() != 0 || fwa.stagedCount() != 0
                || fwa.unsettledAcquisitionCount() != 0 || fwa.unfulfilledVrfCount() != 0
                || coordinator.pendingRequestCount() != 0
        ) revert UnsafeState();
        if (
            collection.code.length == 0 || whitelist.fwa() != address(fwa) || fwa.payoutAddress() != address(splitter)
                || address(fwa.rewards()) != address(rewards) || rewards.fwa() != address(fwa)
                || coordinator.consumer() != address(fwa) || !coordinator.launchReady()
                || fwa.settlementWindow() != 1 days || fwa.finalizeWindow() != 7 days
        ) revert InvalidWiring();

        address[] memory collections = new address[](1);
        collections[0] = collection;
        vm.startBroadcast(ownerKey);
        if (!splitter.splitFrozen()) splitter.freezeSplit();
        if (splitter.SWEEP_AVAILABLE_AT() == 0) splitter.startRevenueClock();
        whitelist.setCollections(collections, true);
        vm.stopBroadcast();

        if (
            !splitter.splitFrozen() || splitter.SWEEP_AVAILABLE_AT() <= block.timestamp
                || !fwa.collectionWhitelisted(collection) || fwa.acquisitionsEnabled()
        ) revert InvalidWiring();

        emit ProjectXTestnetV2Staged(address(fwa), collection, address(splitter), splitter.SWEEP_AVAILABLE_AT());
    }
}
