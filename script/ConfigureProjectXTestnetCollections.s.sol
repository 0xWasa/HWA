// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {FWA} from "fwa-reference/src/FWA.sol";
import {FWAWhitelist} from "fwa-whitelist-reference/src/FWAWhitelist.sol";

interface VmProjectXTestnetCollections {
    function envUint(string calldata name) external returns (uint256 value);
    function envAddress(string calldata name) external returns (address value);
    function envBool(string calldata name) external returns (bool value);
    function addr(uint256 privateKey) external returns (address keyAddr);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

/// @notice Allowlists one reviewed chain-998 fixture without enabling acquisitions.
contract ConfigureProjectXTestnetCollections {
    VmProjectXTestnetCollections internal constant vm =
        VmProjectXTestnetCollections(address(uint160(uint256(keccak256("hevm cheat code")))));

    uint256 internal constant TESTNET = 998;

    event ProjectXTestnetCollectionConfigured(address indexed collection, address indexed whitelist);

    error WrongChain(uint256 actual);
    error ConfigurationNotConfirmed();
    error UnauthorizedOwner();
    error InvalidWiring();
    error UnsafeState();

    function run() external {
        if (block.chainid != TESTNET) revert WrongChain(block.chainid);
        if (!vm.envBool("PROJECTX_TESTNET_COLLECTION_CONFIRMED")) revert ConfigurationNotConfirmed();

        uint256 ownerKey = vm.envUint("OWNER_PRIVATE_KEY");
        address owner = vm.addr(ownerKey);
        FWA fwa = FWA(vm.envAddress("FWA_ADDRESS"));
        FWAWhitelist whitelist = FWAWhitelist(vm.envAddress("FWA_WHITELIST_ADDRESS"));
        address collection = vm.envAddress("FWA_TESTNET_GAMEPLAY_COLLECTION");

        if (fwa.owner() != owner || whitelist.owner() != owner) revert UnauthorizedOwner();
        if (whitelist.fwa() != address(fwa) || collection.code.length == 0) revert InvalidWiring();
        if (fwa.acquisitionsEnabled() || fwa.activeListingCount() != 0 || fwa.unsettledAcquisitionCount() != 0) {
            revert UnsafeState();
        }

        address[] memory collections = new address[](1);
        collections[0] = collection;
        vm.startBroadcast(ownerKey);
        whitelist.setCollections(collections, true);
        vm.stopBroadcast();

        if (!fwa.collectionWhitelisted(collection)) revert InvalidWiring();
        emit ProjectXTestnetCollectionConfigured(collection, address(whitelist));
    }
}
