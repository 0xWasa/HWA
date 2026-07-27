// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {FWA} from "fwa-reference/src/FWA.sol";
import {FWAConfigKeys} from "fwa-reference/src/FWAConfigKeys.sol";
import {FWAVRFService} from "fwa-vrf-reference/src/FWAVRFService.sol";
import {FWAWhitelist} from "fwa-whitelist-reference/src/FWAWhitelist.sol";

import {PoPRandomnessAdapter} from "../src/hyperevm/PoPRandomnessAdapter.sol";
import {SplitterHyperEVM} from "../src/hyperevm/SplitterHyperEVM.sol";

interface VmActivate {
    function envUint(string calldata name) external returns (uint256 value);
    function envAddress(string calldata name) external returns (address value);
    function envAddress(string calldata name, string calldata delimiter) external returns (address[] memory value);
    function envBool(string calldata name) external returns (bool value);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

/// @notice Explicit activation gate after PoP registration and allowlist review.
contract ActivateHyperEVMCore {
    VmActivate internal constant vm = VmActivate(address(uint160(uint256(keccak256("hevm cheat code")))));

    uint256 internal constant HYPEREVM_TESTNET_CHAIN_ID = 998;

    error WrongChain(uint256 actual);
    error RegistrationNotConfirmed();
    error EmptyCollectionList();
    error InvalidWiring();

    function run() external {
        if (block.chainid != HYPEREVM_TESTNET_CHAIN_ID) revert WrongChain(block.chainid);
        if (!vm.envBool("POP_REGISTRATION_CONFIRMED")) revert RegistrationNotConfirmed();

        uint256 ownerKey = vm.envUint("PRIVATE_KEY");
        FWA fwa = FWA(vm.envAddress("FWA_ADDRESS"));
        FWAVRFService service = FWAVRFService(payable(vm.envAddress("FWA_VRF_SERVICE_ADDRESS")));
        PoPRandomnessAdapter adapter = PoPRandomnessAdapter(vm.envAddress("FWA_RANDOMNESS_ADAPTER_ADDRESS"));
        FWAWhitelist whitelist = FWAWhitelist(vm.envAddress("FWA_WHITELIST_ADDRESS"));
        SplitterHyperEVM splitter = SplitterHyperEVM(payable(vm.envAddress("FWA_SPLITTER_ADDRESS")));
        address[] memory collections = vm.envAddress("FWA_COLLECTIONS", ",");
        if (collections.length == 0) revert EmptyCollectionList();

        (address coordinator, uint256 subId) = fwa.vrfCoordinatorAndSubId();
        if (
            coordinator != address(adapter) || subId != adapter.SUBSCRIPTION_ID() || adapter.consumer() != address(fwa)
                || address(service.fwa()) != address(fwa) || address(fwa.vrfService()) != address(service)
                || whitelist.fwa() != address(fwa) || fwa.payoutAddress() != address(splitter)
                || address(splitter).code.length == 0 || splitter.owner() != fwa.owner()
                || splitter.ownerShareBps() != 7_000 || splitter.nftShareBps() != 3_000
        ) revert InvalidWiring();

        vm.startBroadcast(ownerKey);
        whitelist.setCollections(collections, true);
        fwa.setBool(FWAConfigKeys.ACQUISITIONS_ENABLED, true);
        vm.stopBroadcast();
    }
}
