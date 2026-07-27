// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {FWA} from "fwa-reference/src/FWA.sol";
import {FWAConfigKeys} from "fwa-reference/src/FWAConfigKeys.sol";
import {FWAVRFService} from "fwa-vrf-reference/src/FWAVRFService.sol";
import {FWAWhitelist} from "fwa-whitelist-reference/src/FWAWhitelist.sol";

import {PoPRandomnessAdapter} from "../src/hyperevm/PoPRandomnessAdapter.sol";
import {SplitterHyperEVM} from "../src/hyperevm/SplitterHyperEVM.sol";
import {MockProofOfPlayVRNG} from "./mocks/MockProofOfPlayVRNG.sol";
import {MockERC721} from "./mocks/MockERC721.sol";
import {MockSplitterSnapshotNFT} from "./mocks/MockSplitterSnapshotNFT.sol";
import {TestBase} from "./utils/TestBase.sol";

contract RevertingNativeReceiver {
    function list(MockERC721 nft, FWA pool, uint256 tokenId) external payable returns (uint256 listingId) {
        nft.approve(address(pool), tokenId);
        listingId = pool.listNFT{value: msg.value}(address(nft), tokenId);
    }

    receive() external payable {
        revert("NO_NATIVE_RECEIVE");
    }
}

contract FWAHyperEVMCoreTest is TestBase {
    uint256 internal constant MIN_BACKING = 0.01 ether;
    uint256 internal constant INVERSE_WEIGHT_NUMERATOR = 1e36;

    address internal constant DEPOSITOR_A = address(0xA11CE);
    address internal constant DEPOSITOR_B = address(0xB0B);
    address internal constant PURCHASER_A = address(0xCAFE);
    address internal constant PURCHASER_B = address(0xBEEF);

    MockProofOfPlayVRNG internal provider;
    PoPRandomnessAdapter internal adapter;
    FWAVRFService internal service;
    FWA internal pool;
    FWAWhitelist internal whitelist;
    MockERC721 internal nft;

    function setUp() public {
        vm.txGasPrice(0);
        provider = new MockProofOfPlayVRNG();
        adapter = new PoPRandomnessAdapter(address(provider), address(this));
        service = new FWAVRFService(1, 1);
        pool = new FWA(address(adapter), 1, keccak256("POP_VRNG"), 900_000, address(service));
        whitelist = new FWAWhitelist(address(pool), address(0), 0, address(this));
        nft = new MockERC721();

        adapter.setConsumer(address(pool));
        service.setFWA(address(pool));
        service.setFeeConfig(1, 0, 2);
        pool.setAddr(FWAConfigKeys.WHITELIST_MANAGER, address(whitelist));
        pool.setUint(FWAConfigKeys.TOP_LISTING_SHARE_BPS, 100);

        address[] memory collections = new address[](1);
        collections[0] = address(nft);
        whitelist.setCollections(collections, true);
        pool.setBool(FWAConfigKeys.ACQUISITIONS_ENABLED, true);

        vm.deal(DEPOSITOR_A, 1_000 ether);
        vm.deal(DEPOSITOR_B, 1_000 ether);
        vm.deal(PURCHASER_A, 1_000 ether);
        vm.deal(PURCHASER_B, 1_000 ether);
    }

    function testBuildUsesCurrentLiveParityParameters() public view {
        assertEq(pool.topListingShareBps(), 100);
        assertEq(pool.topThresholdBps(), 1_000);
        assertEq(pool.selectionSlippageBps(), 1_000);
        assertEq(pool.settlementDiscountBps(), 8_500);
        assertEq(pool.settlementWindow(), 1 days);
        assertEq(pool.finalizeWindow(), 7 days);
    }

    function testMainnetLaunchLatchIsOneWayAndCannotOpenWithoutRewards() public {
        MockProofOfPlayVRNG freshProvider = new MockProofOfPlayVRNG();
        PoPRandomnessAdapter freshAdapter = new PoPRandomnessAdapter(address(freshProvider), address(this));
        FWAVRFService freshService = new FWAVRFService(1, 1);
        FWA guardedPool =
            new FWA(address(freshAdapter), 1, keccak256("GUARDED_POP_VRNG"), 900_000, address(freshService));
        freshAdapter.setConsumer(address(guardedPool));
        freshService.setFWA(address(guardedPool));

        guardedPool.setBool(FWAConfigKeys.REWARDS_REQUIRED_FOR_ACTIVATION, true);
        assertTrue(guardedPool.rewardsRequiredForActivation());

        vm.expectRevert(FWA.InvalidConfig.selector);
        guardedPool.setBool(FWAConfigKeys.REWARDS_REQUIRED_FOR_ACTIVATION, false);
        vm.expectRevert(FWA.InvalidConfig.selector);
        guardedPool.setBool(FWAConfigKeys.ACQUISITIONS_ENABLED, true);

        vm.expectRevert(FWA.InvalidConfig.selector);
        pool.setBool(FWAConfigKeys.REWARDS_REQUIRED_FOR_ACTIVATION, true);
    }

    function testWeightTreeAndHarmonicPricing() public {
        _list(DEPOSITOR_A, 1, 1 ether);
        _list(DEPOSITOR_B, 2, 4 ether);

        uint256 weightA = INVERSE_WEIGHT_NUMERATOR / 1 ether;
        uint256 weightB = INVERSE_WEIGHT_NUMERATOR / 4 ether;
        uint256 total = weightA + weightB;
        uint256 weightedBacking = weightA * 1 ether + weightB * 4 ether;
        uint256 expectedFee = (weightedBacking / total) * 11_000 / 10_000;

        assertEq(pool.totalWeight(), total);
        assertEq(pool.treeRootWeight(), total);
        assertEq(pool.weightedBackingTotal(), weightedBacking);
        assertEq(pool.acquisitionFee(), expectedFee);
    }

    function testFuzzWeightAndPriceMatchFormula(uint96 rawA, uint96 rawB) public {
        uint256 backingA = bound(uint256(rawA), MIN_BACKING, 1_000 ether);
        uint256 backingB = bound(uint256(rawB), MIN_BACKING, 1_000 ether);
        _list(DEPOSITOR_A, 1, backingA);
        _list(DEPOSITOR_B, 2, backingB);

        uint256 weightA = INVERSE_WEIGHT_NUMERATOR / backingA;
        uint256 weightB = INVERSE_WEIGHT_NUMERATOR / backingB;
        uint256 expectedWeighted = weightA * backingA + weightB * backingB;
        uint256 expectedFee = (expectedWeighted / (weightA + weightB)) * 11_000 / 10_000;

        assertEq(pool.totalWeight(), weightA + weightB);
        assertEq(pool.weightedBackingTotal(), expectedWeighted);
        assertEq(pool.acquisitionFee(), expectedFee);
    }

    function testSingleAcquisitionAndKeepNFT() public {
        uint256 listingId = _list(DEPOSITOR_A, 1, 10 ether);
        uint256 depositorBalanceBefore = DEPOSITOR_A.balance;
        uint256 requestId = _acquire(PURCHASER_A);

        provider.fulfill(provider.lastRequestId(), 123);

        (uint256 selectedListing, FWA.AcquisitionStatus acquisitionStatus) = _acquisitionResult(requestId);
        assertEq(selectedListing, listingId);
        assertEq(uint256(acquisitionStatus), uint256(FWA.AcquisitionStatus.Fulfilled));
        assertEq(uint256(_listingStatus(listingId)), uint256(FWA.ListingStatus.Allocated));

        vm.prank(PURCHASER_A);
        pool.keepNFT(listingId);

        assertEq(nft.ownerOf(1), PURCHASER_A);
        assertEq(DEPOSITOR_A.balance, depositorBalanceBefore + 9.9 ether);
        assertEq(uint256(_listingStatus(listingId)), uint256(FWA.ListingStatus.Settled));
    }

    function testAcceptDepositorBidReturnsNFTAndPaysEightyFivePercent() public {
        uint256 listingId = _list(DEPOSITOR_A, 1, 10 ether);
        uint256 requestId = _acquire(PURCHASER_A);
        provider.fulfill(provider.lastRequestId(), 999);
        (, FWA.AcquisitionStatus status) = _acquisitionResult(requestId);
        assertEq(uint256(status), uint256(FWA.AcquisitionStatus.Fulfilled));

        uint256 purchaserBalanceBefore = PURCHASER_A.balance;
        vm.prank(PURCHASER_A);
        pool.acceptDepositorBid(listingId);

        assertEq(PURCHASER_A.balance, purchaserBalanceBefore + 8.5 ether);
        assertEq(nft.ownerOf(1), DEPOSITOR_A);
        assertEq(uint256(_listingStatus(listingId)), uint256(FWA.ListingStatus.Settled));
    }

    function testLiabilitiesAreConservedAndFullyClaimable() public {
        uint256 listingId = _list(DEPOSITOR_A, 1, 10 ether);
        _acquire(PURCHASER_A);
        provider.fulfill(provider.lastRequestId(), 123);

        vm.prank(PURCHASER_A);
        pool.keepNFT(listingId);

        uint256 depositorCredit = pool.feeCredit(DEPOSITOR_A);
        uint256 ownerCredit = pool.accruedOwnerFees();
        assertEq(address(pool).balance, depositorCredit + ownerCredit);

        vm.prank(DEPOSITOR_A);
        pool.withdrawEarnings();
        pool.payoutFees();

        assertEq(address(pool).balance, 0);
        assertEq(pool.feeCredit(DEPOSITOR_A), 0);
        assertEq(pool.accruedOwnerFees(), 0);
    }

    function testPayoutFeesRouteIntoFWAParitySplitter() public {
        MockSplitterSnapshotNFT snapshotNft = new MockSplitterSnapshotNFT();
        snapshotNft.seed(1, DEPOSITOR_A);
        SplitterHyperEVM splitter = new SplitterHyperEVM(address(this), address(0x5EC0), address(snapshotNft), 1);
        pool.setAddr(FWAConfigKeys.PAYOUT_ADDRESS, address(splitter));

        uint256 listingId = _list(DEPOSITOR_A, 1, 10 ether);
        _acquire(PURCHASER_A);
        provider.fulfill(provider.lastRequestId(), 123);
        vm.prank(PURCHASER_A);
        pool.keepNFT(listingId);

        uint256 paid = pool.payoutFees();
        assertEq(splitter.totalReceived(), paid);
        assertEq(splitter.ownerAllocated(), paid * 7_000 / 10_000);
        assertEq(splitter.nftAllocated(), paid * 3_000 / 10_000);
        assertEq(address(splitter).balance, paid);
    }

    function testBestEffortNFTDeliveryRecordsAndRecoversStuckNFT() public {
        uint256 listingId = _list(DEPOSITOR_A, 1, 10 ether);
        _acquire(PURCHASER_A);
        provider.fulfill(provider.lastRequestId(), 456);
        nft.setTransfersRevert(true);

        vm.prank(PURCHASER_A);
        pool.acceptDepositorBid(listingId);

        assertEq(pool.stuckNFTRecipient(listingId), DEPOSITOR_A);
        assertEq(uint256(_listingStatus(listingId)), uint256(FWA.ListingStatus.Settled));
        assertEq(nft.ownerOf(1), address(pool));

        nft.setTransfersRevert(false);
        vm.prank(DEPOSITOR_A);
        pool.recoverStuckNFT(listingId);
        assertEq(nft.ownerOf(1), DEPOSITOR_A);
        assertEq(pool.stuckNFTRecipient(listingId), address(0));
    }

    function testStrictKeepRevertsWithoutChangingAllocationWhenNFTFails() public {
        uint256 listingId = _list(DEPOSITOR_A, 1, 10 ether);
        _acquire(PURCHASER_A);
        provider.fulfill(provider.lastRequestId(), 456);
        nft.setTransfersRevert(true);

        vm.prank(PURCHASER_A);
        vm.expectRevert(MockERC721.ForcedTransferFailure.selector);
        pool.keepNFT(listingId);

        assertEq(uint256(_listingStatus(listingId)), uint256(FWA.ListingStatus.Allocated));
        assertEq(nft.ownerOf(1), address(pool));
    }

    function testForceNativeTransferPaysDepositorThatRejectsHYPE() public {
        RevertingNativeReceiver receiver = new RevertingNativeReceiver();
        vm.deal(address(receiver), 100 ether);
        nft.mint(address(receiver), 1);
        uint256 listingId = receiver.list{value: 10 ether}(nft, pool, 1);
        uint256 balanceBefore = address(receiver).balance;

        _acquire(PURCHASER_A);
        provider.fulfill(provider.lastRequestId(), 888);
        vm.prank(PURCHASER_A);
        pool.keepNFT(listingId);

        assertEq(address(receiver).balance, balanceBefore + 9.9 ether);
        assertEq(nft.ownerOf(1), PURCHASER_A);
    }

    function testCallbacksOutOfOrderStillSettleInSequence() public {
        _list(DEPOSITOR_A, 1, 1 ether);
        _list(DEPOSITOR_B, 2, 2 ether);

        uint256 firstRequest = _acquireWithNegativeTolerance(PURCHASER_A, 10_000);
        uint256 firstProviderRequest = provider.lastRequestId();
        uint256 secondRequest = _acquireWithNegativeTolerance(PURCHASER_B, 10_000);
        uint256 secondProviderRequest = provider.lastRequestId();

        provider.fulfill(secondProviderRequest, 777);
        (, FWA.AcquisitionStatus secondBefore) = _acquisitionResult(secondRequest);
        assertEq(uint256(secondBefore), uint256(FWA.AcquisitionStatus.Ready));
        assertEq(pool.nextSequenceToProcess(), 1);

        provider.fulfill(firstProviderRequest, 777);
        pool.processAcquisitions(10);

        (, FWA.AcquisitionStatus firstAfter) = _acquisitionResult(firstRequest);
        (, FWA.AcquisitionStatus secondAfter) = _acquisitionResult(secondRequest);
        assertEq(uint256(firstAfter), uint256(FWA.AcquisitionStatus.Fulfilled));
        assertEq(uint256(secondAfter), uint256(FWA.AcquisitionStatus.Fulfilled));
        assertEq(pool.nextSequenceToProcess(), 3);
        assertTrue(adapter.fulfilledWord(firstRequest) != adapter.fulfilledWord(secondRequest));
    }

    function testLateCallbackExpiresIntoPullRefund() public {
        _list(DEPOSITOR_A, 1, 1 ether);
        uint256 fee = pool.acquisitionFee();
        uint256 requestId = _acquire(PURCHASER_A);
        uint256 requestBlock = block.number;

        vm.roll(requestBlock + pool.selectionTimeoutBlocks() + 1);
        provider.fulfill(provider.lastRequestId(), 1234);
        pool.processAcquisitions(1);

        (, FWA.AcquisitionStatus status) = _acquisitionResult(requestId);
        assertEq(uint256(status), uint256(FWA.AcquisitionStatus.Expired));
        assertEq(pool.acquisitionRefundCredit(PURCHASER_A), fee);

        uint256 balanceBefore = PURCHASER_A.balance;
        vm.prank(PURCHASER_A);
        pool.withdrawAcquisitionRefund();
        assertEq(PURCHASER_A.balance, balanceBefore + fee);
        assertEq(pool.acquisitionRefundCredit(PURCHASER_A), 0);
    }

    function testDepositDuringPendingRequestStagesThenActivates() public {
        _list(DEPOSITOR_A, 1, 1 ether);
        _acquire(PURCHASER_A);
        uint256 secondListing = _list(DEPOSITOR_B, 2, 2 ether);

        assertEq(uint256(_listingStatus(secondListing)), uint256(FWA.ListingStatus.Staged));
        provider.fulfill(provider.lastRequestId(), 55);

        pool.activateListings(10);
        assertEq(uint256(_listingStatus(secondListing)), uint256(FWA.ListingStatus.Active));
    }

    function testBlockedCollectionOnlyStopsNewListings() public {
        uint256 existing = _list(DEPOSITOR_A, 1, 1 ether);
        whitelist.setBlocked(address(nft), true);
        assertEq(uint256(_listingStatus(existing)), uint256(FWA.ListingStatus.Active));

        nft.mint(DEPOSITOR_B, 2);
        vm.startPrank(DEPOSITOR_B);
        nft.approve(address(pool), 2);
        vm.expectRevert(FWA.CollectionNotWhitelisted.selector);
        pool.listNFT{value: 1 ether}(address(nft), 2);
        vm.stopPrank();
    }

    function testWithdrawOnlyRejectsDepositsButAllowsExistingExit() public {
        uint256 listingId = _list(DEPOSITOR_A, 1, 1 ether);
        pool.setBool(FWAConfigKeys.WITHDRAW_ONLY, true);

        nft.mint(DEPOSITOR_B, 2);
        vm.startPrank(DEPOSITOR_B);
        nft.approve(address(pool), 2);
        vm.expectRevert(FWA.WithdrawOnlyActive.selector);
        pool.listNFT{value: 1 ether}(address(nft), 2);
        vm.stopPrank();

        vm.prank(DEPOSITOR_A);
        pool.withdrawListing(listingId);
        assertEq(nft.ownerOf(1), DEPOSITOR_A);
        assertEq(uint256(_listingStatus(listingId)), uint256(FWA.ListingStatus.Withdrawn));
    }

    function _list(address depositor, uint256 tokenId, uint256 backing) internal returns (uint256 listingId) {
        nft.mint(depositor, tokenId);
        vm.startPrank(depositor);
        nft.approve(address(pool), tokenId);
        listingId = pool.listNFT{value: backing}(address(nft), tokenId);
        vm.stopPrank();
    }

    function _acquire(address purchaser) internal returns (uint256 requestId) {
        uint256 totalCost = pool.acquisitionFee() + pool.vrfServiceFee();
        vm.prank(purchaser);
        requestId = pool.acquire{value: totalCost}(0, 0);
    }

    function _acquireWithNegativeTolerance(address purchaser, uint256 negativeToleranceBps)
        internal
        returns (uint256 requestId)
    {
        uint256 totalCost = pool.acquisitionFee() + pool.vrfServiceFee();
        vm.prank(purchaser);
        requestId = pool.acquire{value: totalCost}(0, 0, negativeToleranceBps);
    }

    function _listingStatus(uint256 listingId) internal view returns (FWA.ListingStatus status) {
        (,,,,,,,,,, status) = pool.listings(listingId);
    }

    function _acquisitionResult(uint256 requestId)
        internal
        view
        returns (uint256 listingId, FWA.AcquisitionStatus status)
    {
        (,,, listingId, status) = pool.acquisitions(requestId);
    }
}
