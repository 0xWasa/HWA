// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {FWA} from "fwa-reference/src/FWA.sol";

import {FWATokenHyperEVM} from "../src/hyperevm/FWATokenHyperEVM.sol";
import {HWAGenesisNFT} from "../src/hyperevm/HWAGenesisNFT.sol";
import {SplitterHyperEVM} from "../src/hyperevm/SplitterHyperEVM.sol";
import {FWATestnetNFT} from "../src/hyperevm/testnet/FWATestnetNFT.sol";

interface VmVerifyProjectXTestnetV2Release {
    function envAddress(string calldata name) external view returns (address value);
    function envUint(string calldata name) external view returns (uint256 value);
}

/// @notice Read-only post-E2E attestation for the canonical chain-998 v2 release.
contract VerifyProjectXTestnetV2Release {
    VmVerifyProjectXTestnetV2Release internal constant vm =
        VmVerifyProjectXTestnetV2Release(address(uint160(uint256(keccak256("hevm cheat code")))));

    event ProjectXTestnetV2ReleaseVerified(
        address indexed fwa,
        address indexed token,
        address indexed gameplayCollection,
        uint256 requestId,
        address purchaser
    );

    error WrongChain(uint256 actual);
    error InvalidState();

    function run() external {
        if (block.chainid != 998) revert WrongChain(block.chainid);

        FWA fwa = FWA(vm.envAddress("FWA_ADDRESS"));
        FWATokenHyperEVM token = FWATokenHyperEVM(payable(vm.envAddress("FWA_TOKEN_ADDRESS")));
        HWAGenesisNFT genesis = HWAGenesisNFT(vm.envAddress("FWA_TEST_SNAPSHOT_NFT"));
        FWATestnetNFT gameplay = FWATestnetNFT(vm.envAddress("FWA_TEST_GAMEPLAY_NFT"));
        FWATestnetNFT hostile = FWATestnetNFT(vm.envAddress("FWA_TEST_HOSTILE_NFT"));
        SplitterHyperEVM splitter = SplitterHyperEVM(payable(vm.envAddress("FWA_SPLITTER_ADDRESS")));
        address purchaser = vm.envAddress("FWA_TEST_PURCHASER");
        uint256 requestId = vm.envUint("FWA_DRAND_GAMEPLAY_REQUEST_ID");
        uint256 listingId = vm.envUint("FWA_DRAND_GAMEPLAY_LISTING_ID");
        uint256 tokenId = vm.envUint("FWA_DRAND_GAMEPLAY_TOKEN_ID");

        (,,, uint256 selectedListing, FWA.AcquisitionStatus status) = fwa.acquisitions(requestId);
        if (
            address(fwa).code.length == 0 || address(token).code.length == 0 || address(genesis).code.length == 0
                || address(gameplay).code.length == 0 || address(hostile).code.length == 0
                || address(splitter).code.length == 0 || !genesis.snapshotFrozen() || genesis.maxSupply() != 333
                || genesis.currentSupply() != 4 || !gameplay.mintingClosed() || gameplay.getCurrentSupply() != 6
                || !hostile.mintingClosed() || !hostile.transfersBlocked() || hostile.getCurrentSupply() != 2
                || splitter.NFT_ADDRESS() != address(genesis) || !splitter.splitFrozen()
                || splitter.SWEEP_AVAILABLE_AT() == 0 || fwa.owner() != token.owner() || fwa.owner() != splitter.owner()
                || fwa.acquisitionsEnabled() || fwa.withdrawOnly() || fwa.activeListingCount() != 0
                || fwa.stagedCount() != 0 || fwa.unsettledAcquisitionCount() != 0 || fwa.unfulfilledVrfCount() != 0
                || !fwa.collectionWhitelisted(address(gameplay)) || token.externalBuysEnabled()
                || status != FWA.AcquisitionStatus.Fulfilled || selectedListing != listingId
                || gameplay.ownerOf(tokenId) != purchaser
        ) revert InvalidState();

        emit ProjectXTestnetV2ReleaseVerified(address(fwa), address(token), address(gameplay), requestId, purchaser);
    }
}
