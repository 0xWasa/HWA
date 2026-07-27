// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Ownable} from "solady/src/auth/Ownable.sol";

import {SplitterHyperEVM} from "../src/hyperevm/SplitterHyperEVM.sol";
import {FWATestnetNFT} from "../src/hyperevm/testnet/FWATestnetNFT.sol";
import {TestBase} from "./utils/TestBase.sol";

contract FWATestnetNFTTest is TestBase {
    address internal constant ALICE = address(0xA11CE);
    address internal constant BOB = address(0xB0B);
    address internal constant SECONDARY = address(0x5EC0);

    FWATestnetNFT internal nft;

    function setUp() public {
        nft = new FWATestnetNFT("HWA Test Snapshot", "HWATS", "ipfs://hwa-test/", 4, address(this));
    }

    function testSequentialMintAndPermanentClose() public {
        address[] memory recipients = new address[](4);
        recipients[0] = ALICE;
        recipients[1] = BOB;
        recipients[2] = ALICE;
        recipients[3] = BOB;

        (uint256 first, uint256 last) = nft.batchMint(recipients);
        assertEq(first, 1);
        assertEq(last, 4);
        assertEq(nft.currentSupply(), 4);
        assertEq(nft.highestMintedTokenId(), 4);
        assertEq(nft.ownerOf(1), ALICE);

        vm.expectRevert(FWATestnetNFT.MaxSupplyReached.selector);
        nft.mint(ALICE);

        nft.closeMinting();
        assertTrue(nft.mintingClosed());
        vm.expectRevert(FWATestnetNFT.MintingIsClosed.selector);
        nft.mint(ALICE);
    }

    function testOnlyOwnerCanMintOrConfigure() public {
        vm.prank(ALICE);
        vm.expectRevert(Ownable.Unauthorized.selector);
        nft.mint(ALICE);

        vm.prank(ALICE);
        vm.expectRevert(Ownable.Unauthorized.selector);
        nft.setTransfersBlocked(true);
    }

    function testRemintIsForbiddenAfterSnapshotFreeze() public {
        nft.mint(ALICE);
        nft.closeMinting();

        vm.prank(ALICE);
        nft.burn(1);
        assertEq(nft.currentSupply(), 0);
        assertEq(nft.burnedTokenCount(), 1);
        assertTrue(nft.isBurned(1));

        vm.expectRevert(FWATestnetNFT.MintingIsClosed.selector);
        nft.remint(BOB, 1);
    }

    function testHostileTransferToggleExercisesCustodyFailure() public {
        nft.mint(ALICE);
        nft.setTransfersBlocked(true);

        vm.prank(ALICE);
        vm.expectRevert(FWATestnetNFT.TestTransfersBlocked.selector);
        nft.transferFrom(ALICE, BOB, 1);

        nft.setTransfersBlocked(false);
        vm.prank(ALICE);
        nft.transferFrom(ALICE, BOB, 1);
        assertEq(nft.ownerOf(1), BOB);
    }

    function testCollectionSatisfiesSplitterSnapshotInvariantWithBurnedId() public {
        nft.mint(ALICE);
        nft.mint(BOB);
        nft.mint(ALICE);
        nft.mint(BOB);
        nft.closeMinting();

        vm.prank(BOB);
        nft.burn(4);

        SplitterHyperEVM splitter = new SplitterHyperEVM(address(this), SECONDARY, address(nft), 4);
        assertEq(splitter.NFT_ADDRESS(), address(nft));
        assertEq(splitter.SNAPSHOT_SUPPLY(), 3);
        assertEq(splitter.MAX_TOKEN_ID(), 4);
    }
}
