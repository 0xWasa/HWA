// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {SplitterHyperEVM} from "../src/hyperevm/SplitterHyperEVM.sol";
import {MockSplitterSnapshotNFT} from "./mocks/MockSplitterSnapshotNFT.sol";
import {TestBase} from "./utils/TestBase.sol";

contract SplitterHyperEVMTest is TestBase {
    address internal constant OWNER = address(0xA11CE);
    address internal constant SECONDARY = address(0x5EC0);
    address internal constant ALICE = address(0xB0B);
    address internal constant BOB = address(0xCAFE);

    MockSplitterSnapshotNFT internal nft;
    SplitterHyperEVM internal splitter;

    function setUp() public {
        nft = new MockSplitterSnapshotNFT();
        nft.seed(1, ALICE);
        nft.seed(2, ALICE);
        nft.seed(3, BOB);
        nft.seed(4, address(this));
        nft.burn(4);

        splitter = new SplitterHyperEVM(OWNER, SECONDARY, address(nft), 4);
        vm.startPrank(OWNER);
        splitter.freezeSplit();
        splitter.startRevenueClock();
        vm.stopPrank();
        vm.deal(address(this), 1_000 ether);
    }

    function testConstructorCapturesSameSnapshotInvariantsAsFWA() public view {
        assertEq(splitter.owner(), OWNER);
        assertEq(splitter.SECONDARY_OWNER(), SECONDARY);
        assertEq(splitter.NFT_ADDRESS(), address(nft));
        assertEq(splitter.SNAPSHOT_SUPPLY(), 3);
        assertEq(splitter.MAX_TOKEN_ID(), 4);
        assertEq(uint256(splitter.ownerShareBps()), 7_000);
        assertEq(uint256(splitter.nftShareBps()), 3_000);
        assertEq(splitter.SWEEP_AVAILABLE_AT(), block.timestamp + 365 days);
    }

    function testDepositAndOwnerClaimMatchFWASeventyThirtyAndSecondaryTenth() public {
        _deposit(100 ether);

        assertEq(splitter.totalReceived(), 100 ether);
        assertEq(splitter.ownerAllocated(), 70 ether);
        assertEq(splitter.nftAllocated(), 30 ether);
        assertEq(splitter.claimablePerToken(), 10 ether);
        assertEq(splitter.pendingOwner(), 63 ether);
        assertEq(splitter.pendingSecondaryOwner(), 7 ether);

        uint256 ownerBefore = OWNER.balance;
        uint256 secondaryBefore = SECONDARY.balance;
        uint256 ownerAmount = splitter.claimOwner();
        assertEq(ownerAmount, 63 ether);
        assertEq(OWNER.balance - ownerBefore, 63 ether);
        assertEq(SECONDARY.balance - secondaryBefore, 7 ether);
        assertEq(splitter.ownerClaimed(), 70 ether);
    }

    function testZeroSecondaryRoutesEntireOwnerShareToSafeOwner() public {
        SplitterHyperEVM treasuryOnly = new SplitterHyperEVM(OWNER, address(0), address(nft), 4);
        vm.prank(OWNER);
        treasuryOnly.freezeSplit();
        (bool sent,) = address(treasuryOnly).call{value: 100 ether}("");
        assertTrue(sent);

        assertEq(treasuryOnly.pendingOwner(), 70 ether);
        assertEq(treasuryOnly.pendingSecondaryOwner(), 0);
        uint256 ownerBefore = OWNER.balance;
        treasuryOnly.claimOwner();
        assertEq(OWNER.balance - ownerBefore, 70 ether);
    }

    function testFirstDepositFitsTheNoGriefNativeTransferStipend() public {
        (bool sent,) = address(splitter).call{value: 1 ether, gas: 100_000}("");
        assertTrue(sent);
        assertEq(splitter.totalReceived(), 1 ether);
        assertEq(splitter.ownerAllocated(), 0.7 ether);
        assertEq(splitter.nftAllocated(), 0.3 ether);
    }

    function testDuplicateIdsAreHarmlessAndClaimsCheckpointPerToken() public {
        _deposit(100 ether);
        uint256[] memory tokenIds = new uint256[](3);
        tokenIds[0] = 1;
        tokenIds[1] = 2;
        tokenIds[2] = 1;

        uint256 beforeBalance = ALICE.balance;
        vm.prank(ALICE);
        uint256 amount = splitter.claim(tokenIds);
        assertEq(amount, 20 ether);
        assertEq(ALICE.balance - beforeBalance, 20 ether);
        assertEq(splitter.claimed(1), 10 ether);
        assertEq(splitter.claimed(2), 10 ether);

        vm.prank(ALICE);
        vm.expectRevert(SplitterHyperEVM.NothingToClaim.selector);
        splitter.claim(tokenIds);
    }

    function testClaimRightsFollowCurrentNFTOwnerWithoutResettingCheckpoint() public {
        _deposit(100 ether);
        uint256[] memory aliceIds = new uint256[](1);
        aliceIds[0] = 1;
        vm.prank(ALICE);
        splitter.claim(aliceIds);

        vm.prank(ALICE);
        nft.transfer(1, BOB);
        _deposit(30 ether);

        uint256[] memory bobIds = new uint256[](2);
        bobIds[0] = 1;
        bobIds[1] = 3;
        uint256 beforeBalance = BOB.balance;
        vm.prank(BOB);
        uint256 amount = splitter.claim(bobIds);

        // Token 1 was checkpointed at 10 HYPE, token 3 was never claimed; cumulative is now 13.
        assertEq(amount, 16 ether);
        assertEq(BOB.balance - beforeBalance, 16 ether);
    }

    function testSplitUpdateOnlyAffectsFutureDeposits() public {
        // A production splitter is frozen in setUp; exercise the configurable pre-launch state on
        // a fresh instance, then freeze it before accepting revenue.
        MockSplitterSnapshotNFT freshNft = new MockSplitterSnapshotNFT();
        freshNft.seed(1, ALICE);
        SplitterHyperEVM fresh = new SplitterHyperEVM(OWNER, SECONDARY, address(freshNft), 1);
        vm.prank(OWNER);
        fresh.setOwnerShareBps(5_000);
        vm.prank(OWNER);
        fresh.freezeSplit();
        vm.prank(OWNER);
        fresh.startRevenueClock();

        (bool sent,) = address(fresh).call{value: 100 ether}("");
        assertTrue(sent);
        assertEq(fresh.ownerAllocated(), 50 ether);
        assertEq(fresh.nftAllocated(), 50 ether);
    }

    function testFrozenSplitCannotBeChanged() public {
        _deposit(100 ether);
        vm.prank(OWNER);
        vm.expectRevert(SplitterHyperEVM.ClaimsClosed.selector);
        splitter.setOwnerShareBps(5_000);
    }

    function testBurnedAndPostSnapshotIdsCannotClaim() public {
        uint256[] memory tokenIds = new uint256[](1);
        tokenIds[0] = 4;
        _deposit(10 ether);

        vm.expectRevert(SplitterHyperEVM.NotTokenOwner.selector);
        splitter.claim(tokenIds);

        tokenIds[0] = 5;
        vm.expectRevert(SplitterHyperEVM.InvalidTokenId.selector);
        splitter.claim(tokenIds);
    }

    function testSweepAfterOneYearPermanentlyClosesClaims() public {
        _deposit(100 ether);
        vm.prank(OWNER);
        vm.expectRevert(SplitterHyperEVM.SweepNotAvailable.selector);
        splitter.sweep();

        vm.warp(splitter.SWEEP_AVAILABLE_AT());
        uint256 ownerBefore = OWNER.balance;
        vm.prank(OWNER);
        uint256 swept = splitter.sweep();
        assertEq(swept, 100 ether);
        assertEq(OWNER.balance - ownerBefore, 100 ether);
        assertTrue(splitter.claimsClosed());
        assertEq(splitter.pending(1), 0);
        assertEq(splitter.pendingOwner(), 0);

        uint256[] memory tokenIds = new uint256[](1);
        tokenIds[0] = 1;
        vm.prank(ALICE);
        vm.expectRevert(SplitterHyperEVM.ClaimsClosed.selector);
        splitter.claim(tokenIds);

        _deposit(1 ether);
        assertEq(splitter.totalReceived(), 100 ether);
        assertEq(address(splitter).balance, 1 ether);

        uint256 ownerAfterFirstSweep = OWNER.balance;
        vm.prank(OWNER);
        splitter.sweep();
        assertEq(OWNER.balance, ownerAfterFirstSweep + 1 ether);
    }

    function testRevenueReadinessExpiresBeforeClaimsCanBeSwept() public {
        assertTrue(splitter.revenueReady());
        vm.warp(block.timestamp + 2 days);
        assertFalse(splitter.revenueReady());
    }

    function testOwnerCannotRenounceAndStrandClaims() public {
        vm.prank(OWNER);
        vm.expectRevert(SplitterHyperEVM.OwnershipRenounceDisabled.selector);
        splitter.renounceOwnership();
        assertEq(splitter.owner(), OWNER);
    }

    function testConstructorRejectsSnapshotSupplyMismatch() public {
        vm.expectRevert(SplitterHyperEVM.InvalidMaxTokenId.selector);
        new SplitterHyperEVM(OWNER, SECONDARY, address(nft), 5);
    }

    function testFuzzEveryDepositIsFullyAllocated(uint96 rawAmount) public {
        uint256 amount = bound(uint256(rawAmount), 1, 100 ether);
        _deposit(amount);

        assertEq(splitter.ownerAllocated() + splitter.nftAllocated(), amount);
        assertEq(splitter.totalReceived(), amount);
        assertEq(address(splitter).balance, amount);
    }

    function _deposit(uint256 amount) private {
        (bool sent,) = address(splitter).call{value: amount}("");
        assertTrue(sent);
    }
}
