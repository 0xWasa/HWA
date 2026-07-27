// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {FWA} from "fwa-reference/src/FWA.sol";

interface VmSettleDrandE2E {
    function envUint(string calldata name) external returns (uint256 value);
    function envBool(string calldata name) external returns (bool value);
    function envAddress(string calldata name) external returns (address value);
    function addr(uint256 privateKey) external returns (address keyAddr);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

interface IERC721Owner {
    function ownerOf(uint256 tokenId) external view returns (address);
}

/// @notice Completes the one-listing live drand smoke test through FWA's keep-NFT settlement.
contract SettleDrandGameplayE2E {
    VmSettleDrandE2E internal constant vm = VmSettleDrandE2E(address(uint160(uint256(keccak256("hevm cheat code")))));

    uint256 internal constant HYPEREVM_TESTNET_CHAIN_ID = 998;

    event DrandGameplaySettled(
        uint256 indexed requestId,
        uint256 indexed listingId,
        address indexed purchaser,
        address collection,
        uint256 tokenId
    );

    error WrongChain(uint256 actual);
    error SettlementNotConfirmed();
    error InvalidState();

    function run() external {
        if (block.chainid != HYPEREVM_TESTNET_CHAIN_ID) revert WrongChain(block.chainid);
        if (!vm.envBool("FWA_DRAND_GAMEPLAY_SETTLE_CONFIRMED")) revert SettlementNotConfirmed();

        uint256 purchaserKey = vm.envUint("FWA_TEST_PURCHASER_PRIVATE_KEY");
        address purchaser = vm.addr(purchaserKey);
        FWA fwa = FWA(vm.envAddress("FWA_ADDRESS"));
        IERC721Owner collection = IERC721Owner(vm.envAddress("FWA_TEST_GAMEPLAY_NFT"));
        uint256 requestId = vm.envUint("FWA_DRAND_GAMEPLAY_REQUEST_ID");
        uint256 listingId = vm.envUint("FWA_DRAND_GAMEPLAY_LISTING_ID");
        uint256 tokenId = vm.envUint("FWA_DRAND_GAMEPLAY_TOKEN_ID");

        (,,, uint256 selectedListing, FWA.AcquisitionStatus status) = fwa.acquisitions(requestId);
        if (status != FWA.AcquisitionStatus.Fulfilled || selectedListing != listingId) revert InvalidState();

        vm.startBroadcast(purchaserKey);
        fwa.keepNFT(listingId);
        vm.stopBroadcast();

        if (collection.ownerOf(tokenId) != purchaser || fwa.unsettledAcquisitionCount() != 0) revert InvalidState();
        emit DrandGameplaySettled(requestId, listingId, purchaser, address(collection), tokenId);
    }
}
