// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {FWA} from "fwa-reference/src/FWA.sol";
import {FWAConfigKeys} from "fwa-reference/src/FWAConfigKeys.sol";
import {FWAVRFService} from "fwa-vrf-reference/src/FWAVRFService.sol";
import {FWAWhitelist} from "fwa-whitelist-reference/src/FWAWhitelist.sol";

import {PoPRandomnessAdapter} from "../src/hyperevm/PoPRandomnessAdapter.sol";
import {MockProofOfPlayVRNG} from "./mocks/MockProofOfPlayVRNG.sol";
import {MockERC721, IERC721Receiver} from "./mocks/MockERC721.sol";
import {TestBase} from "./utils/TestBase.sol";

/// @dev Contract purchaser under test, so settlement is driven by a non-EOA acquirer.
contract SettlementBuyer is IERC721Receiver {
    function call(address target, uint256 value, bytes calldata data) external returns (bool ok) {
        (ok,) = target.call{value: value}(data);
    }

    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return IERC721Receiver.onERC721Received.selector;
    }

    receive() external payable {}
}

/// @notice Deterministic proof that every FWA settlement branch is reachable and that custody and
///         solvency hold at each one.
///
/// @dev The stateful campaign in `FWAStatefulInvariant.t.sol` never enters the allocated state at
///      all: its handler can only fulfil the newest randomness request, and Foundry never advances
///      the block height, so `processAcquisitions` head-of-line blocks on a `Pending` head that can
///      neither be fulfilled nor expire. Its three invariants therefore only ever observed staged
///      and active listings. These tests pin the post-allocation state space explicitly so that
///      reachability is asserted rather than assumed.
contract FWASettlementBranchesTest is TestBase, IERC721Receiver {
    MockProofOfPlayVRNG internal provider;
    PoPRandomnessAdapter internal adapter;
    FWAVRFService internal service;
    FWA internal pool;
    FWAWhitelist internal whitelist;
    MockERC721 internal nft;
    SettlementBuyer internal buyer;

    address internal constant DEPOSITOR = address(0xDEB0);
    uint256 internal constant BACKING = 1 ether;

    function setUp() public {
        vm.txGasPrice(0);
        provider = new MockProofOfPlayVRNG();
        adapter = new PoPRandomnessAdapter(address(provider), address(this));
        service = new FWAVRFService(1, 1);
        pool = new FWA(address(adapter), 1, keccak256("BRANCHES_VRNG"), 900_000, address(service));
        whitelist = new FWAWhitelist(address(pool), address(0), 0, address(this));
        nft = new MockERC721();
        buyer = new SettlementBuyer();

        adapter.setConsumer(address(pool));
        service.setFWA(address(pool));
        service.setFeeConfig(1, 0, 2);
        pool.setAddr(FWAConfigKeys.WHITELIST_MANAGER, address(whitelist));
        address[] memory collections = new address[](1);
        collections[0] = address(nft);
        whitelist.setCollections(collections, true);
        pool.setBool(FWAConfigKeys.ACQUISITIONS_ENABLED, true);

        vm.deal(address(this), 10_000 ether);
        vm.deal(address(buyer), 10_000 ether);
        vm.deal(DEPOSITOR, 10_000 ether);
        vm.roll(block.number + 1000);
        vm.warp(block.timestamp + 1000);
    }

    // --- branch coverage ----------------------------------------------------

    function testKeepNFTDeliversToPurchaser() public {
        uint256 listingId = _allocate(1);
        assertTrue(_call(abi.encodeCall(FWA.keepNFT, (listingId))));

        assertTrue(_status(listingId) == FWA.ListingStatus.Settled);
        assertEq(nft.ownerOf(1), address(buyer));
        _assertSolvent();
    }

    function testAcceptDepositorBidReturnsNFTToDepositor() public {
        uint256 listingId = _allocate(2);
        assertTrue(_call(abi.encodeCall(FWA.acceptDepositorBid, (listingId))));

        assertTrue(_status(listingId) == FWA.ListingStatus.Settled);
        assertEq(nft.ownerOf(2), DEPOSITOR);
        _assertSolvent();
    }

    function testRelistKeepsCustodyAndOpensNewListing() public {
        uint256 listingId = _allocate(3);
        uint256 nextBefore = pool.nextListingId();

        assertTrue(_call(0.5 ether, abi.encodeCall(FWA.relistNFT, (listingId))));

        assertTrue(_status(listingId) == FWA.ListingStatus.Settled);
        assertEq(pool.nextListingId(), nextBefore + 1);
        // The NFT never leaves custody across a relist.
        assertEq(nft.ownerOf(3), address(pool));
        _assertSolvent();
    }

    function testDepositorReclaimBackingAfterSettlementWindow() public {
        uint256 listingId = _allocate(4);
        vm.warp(block.timestamp + pool.settlementWindow() + 1);

        vm.prank(DEPOSITOR);
        pool.depositorReclaimBacking(listingId);

        assertTrue(_status(listingId) == FWA.ListingStatus.Settled);
        assertEq(nft.ownerOf(4), address(buyer));
        _assertSolvent();
    }

    function testDepositorReclaimNFTAfterSettlementWindow() public {
        uint256 listingId = _allocate(5);
        vm.warp(block.timestamp + pool.settlementWindow() + 1);

        vm.prank(DEPOSITOR);
        pool.depositorReclaimNFT(listingId);

        assertTrue(_status(listingId) == FWA.ListingStatus.Settled);
        assertEq(nft.ownerOf(5), DEPOSITOR);
        _assertSolvent();
    }

    function testFinalizeUnsettledIsPermissionlessAfterFinalizeWindow() public {
        uint256 listingId = _allocate(6);
        vm.warp(block.timestamp + pool.finalizeWindow() + 1);

        // Neither purchaser nor depositor: anyone may finalize the default.
        vm.prank(address(0xBEEF));
        pool.finalizeUnsettled(listingId);

        assertTrue(_status(listingId) == FWA.ListingStatus.Settled);
        assertEq(nft.ownerOf(6), address(buyer));
        _assertSolvent();
    }

    function testWindowChangesOnlyAffectFutureAllocations() public {
        uint256 listingId = _allocate(11);
        uint64 allocatedAt;
        (,,,,,,,,, allocatedAt,) = pool.listings(listingId);
        uint256 settlementSnapshot = pool.settlementWindowAtAllocation(listingId);
        uint256 finalizeSnapshot = pool.finalizeWindowAtAllocation(listingId);

        pool.setUint(FWAConfigKeys.SETTLEMENT_WINDOW, 1 hours);
        pool.setUint(FWAConfigKeys.FINALIZE_WINDOW, 1 days);
        assertEq(pool.settlementWindowAtAllocation(listingId), settlementSnapshot);
        assertEq(pool.finalizeWindowAtAllocation(listingId), finalizeSnapshot);

        vm.warp(allocatedAt + 1 hours + 1);
        vm.prank(DEPOSITOR);
        vm.expectRevert(FWA.SettlementWindowNotElapsed.selector);
        pool.depositorReclaimBacking(listingId);

        vm.warp(allocatedAt + settlementSnapshot + 1);
        vm.prank(DEPOSITOR);
        pool.depositorReclaimBacking(listingId);
    }

    function testSettlementWindowBoundsAreEnforced() public {
        vm.expectRevert(FWA.InvalidConfig.selector);
        pool.setUint(FWAConfigKeys.SETTLEMENT_WINDOW, 1 hours - 1);
        vm.expectRevert(FWA.InvalidConfig.selector);
        pool.setUint(FWAConfigKeys.SETTLEMENT_WINDOW, 7 days + 1);
        vm.expectRevert(FWA.InvalidConfig.selector);
        pool.setUint(FWAConfigKeys.FINALIZE_WINDOW, 30 days + 1);
    }

    /// @notice A collection that reverts on transfer must not be able to lock a listing: the ETH
    ///         legs still settle, the core keeps custody, and recovery drains it once the
    ///         collection behaves again.
    /// @dev Non-strict delivery uses plain `transferFrom`, so a purchaser that merely refuses the
    ///      ERC-721 receiver hook cannot reach this state — only a misbehaving collection can.
    function testRevertingCollectionLeavesNFTCustodiedThenRecoverable() public {
        uint256 listingId = _allocate(7);
        nft.setTransfersRevert(true);

        vm.warp(block.timestamp + pool.finalizeWindow() + 1);
        vm.prank(address(0xBEEF));
        pool.finalizeUnsettled(listingId);

        // The listing resolved even though delivery failed, and the core still custodies the NFT.
        assertTrue(_status(listingId) == FWA.ListingStatus.Settled);
        assertEq(pool.stuckNFTRecipient(listingId), address(buyer));
        assertEq(nft.ownerOf(7), address(pool));
        _assertSolvent();

        // While the collection is still failing, recovery reverts and entitlement is preserved.
        assertFalse(_call(abi.encodeCall(FWA.recoverStuckNFT, (listingId))));
        assertEq(pool.stuckNFTRecipient(listingId), address(buyer));

        nft.setTransfersRevert(false);

        // Only the owed recipient may pull it.
        vm.prank(address(0xBEEF));
        (bool intruder,) = address(pool).call(abi.encodeCall(FWA.recoverStuckNFT, (listingId)));
        assertFalse(intruder);
        assertEq(nft.ownerOf(7), address(pool));

        assertTrue(_call(abi.encodeCall(FWA.recoverStuckNFT, (listingId))));
        assertEq(nft.ownerOf(7), address(buyer));
        assertEq(pool.stuckNFTRecipient(listingId), address(0));
        _assertSolvent();
    }

    /// @notice An acquisition whose word never arrives must expire and refund rather than wedge the
    ///         FIFO — the exact state the shipped stateful campaign was permanently stuck in.
    function testUnfulfilledAcquisitionExpiresAndRefunds() public {
        _list(8);
        pool.activateListings(8);

        uint256 cost = pool.acquisitionFee() + pool.vrfServiceFee();
        assertTrue(_call(cost, abi.encodeWithSignature("acquire(uint256,uint256)", uint256(0), uint256(0))));

        uint256 requestId = pool.requestIdAtSequence(1);
        (,,,, FWA.AcquisitionStatus pending) = pool.acquisitions(requestId);
        assertTrue(pending == FWA.AcquisitionStatus.Pending);

        // The word never arrives; only block progression can release the queue head.
        vm.roll(block.number + 100_000);
        vm.warp(block.timestamp + 200_000);
        pool.processAcquisitions(8);

        (,,,, FWA.AcquisitionStatus expired) = pool.acquisitions(requestId);
        assertTrue(expired == FWA.AcquisitionStatus.Expired);
        assertEq(pool.nextSequenceToProcess(), 2);
        assertTrue(pool.acquisitionRefundCredit(address(buyer)) > 0);
        _assertSolvent();
    }

    /// @notice Out-of-order callbacks must not let a later request settle ahead of the queue head.
    function testOutOfOrderCallbackDoesNotJumpTheQueue() public {
        _list(9);
        _list(10);
        pool.activateListings(8);

        uint256 cost = pool.acquisitionFee() + pool.vrfServiceFee();
        assertTrue(_call(cost, abi.encodeWithSignature("acquire(uint256,uint256)", uint256(0), uint256(0))));
        uint256 firstRequest = provider.lastRequestId();
        assertTrue(_call(cost, abi.encodeWithSignature("acquire(uint256,uint256)", uint256(0), uint256(0))));
        uint256 secondRequest = provider.lastRequestId();
        assertTrue(firstRequest != secondRequest);

        // Fulfil the SECOND request first.
        provider.fulfill(secondRequest, uint256(keccak256("word-2")));
        pool.processAcquisitions(8);

        // The head is still sequence 1, so nothing settled out of order.
        assertEq(pool.nextSequenceToProcess(), 1);
        (,,,, FWA.AcquisitionStatus second) = pool.acquisitions(pool.requestIdAtSequence(2));
        assertTrue(second == FWA.AcquisitionStatus.Ready);
        _assertSolvent();

        // Once the head is fulfilled, both drain in order.
        provider.fulfill(firstRequest, uint256(keccak256("word-1")));
        pool.processAcquisitions(8);
        assertEq(pool.nextSequenceToProcess(), 3);
        _assertSolvent();
    }

    // --- helpers ------------------------------------------------------------

    function _list(uint256 tokenId) internal returns (uint256 listingId) {
        nft.mint(DEPOSITOR, tokenId);
        vm.prank(DEPOSITOR);
        nft.approve(address(pool), tokenId);
        listingId = pool.nextListingId();
        vm.prank(DEPOSITOR);
        pool.listNFT{value: BACKING}(address(nft), tokenId);
    }

    /// @dev Drives one NFT all the way to `Allocated` with `buyer` as purchaser.
    function _allocate(uint256 tokenId) internal returns (uint256 listingId) {
        _list(tokenId);
        pool.activateListings(8);

        uint256 cost = pool.acquisitionFee() + pool.vrfServiceFee();
        assertTrue(_call(cost, abi.encodeWithSignature("acquire(uint256,uint256)", uint256(0), uint256(0))));

        uint256 requestId = provider.lastRequestId();
        provider.fulfill(requestId, uint256(keccak256(abi.encode(tokenId))));
        pool.processAcquisitions(8);

        uint256 fwaRequestId = pool.requestIdAtSequence(pool.lastIssuedSequence());
        (,,, listingId,) = pool.acquisitions(fwaRequestId);
        assertTrue(listingId != 0);
        assertTrue(_status(listingId) == FWA.ListingStatus.Allocated);
        assertEq(nft.ownerOf(tokenId), address(pool));
    }

    function _status(uint256 listingId) internal view returns (FWA.ListingStatus status) {
        (,,,,,,,,,, status) = pool.listings(listingId);
    }

    function _call(bytes memory data) internal returns (bool) {
        return _call(0, data);
    }

    function _call(uint256 value, bytes memory data) internal returns (bool) {
        return buyer.call(address(pool), value, data);
    }

    /// @dev The solvency property the stateful campaign claims to protect, asserted at a state it
    ///      could never actually reach.
    function _assertSolvent() internal view {
        uint256 liabilities;
        uint256 next = pool.nextListingId();
        for (uint256 listingId = 1; listingId < next; ++listingId) {
            (,,,,, uint256 backing,,,,, FWA.ListingStatus status) = pool.listings(listingId);
            if (
                status == FWA.ListingStatus.Active || status == FWA.ListingStatus.Staged
                    || status == FWA.ListingStatus.Allocated
            ) liabilities += backing;
            if (status == FWA.ListingStatus.Active) liabilities += pool.pendingFees(listingId);
        }

        uint256 lastSequence = pool.lastIssuedSequence();
        for (uint256 sequence = 1; sequence <= lastSequence; ++sequence) {
            (,, uint256 escrow,, FWA.AcquisitionStatus status) =
                pool.acquisitions(pool.requestIdAtSequence(uint64(sequence)));
            if (
                status == FWA.AcquisitionStatus.Pending || status == FWA.AcquisitionStatus.Ready
                    || status == FWA.AcquisitionStatus.TimedOut
            ) liabilities += escrow;
        }

        liabilities += pool.topListingPot() + pool.accruedOwnerFees() + pool.acquisitionRefundCreditTotal()
        + pool.feeCredit(DEPOSITOR) + pool.feeCredit(address(buyer)) + pool.feeCredit(address(this));
        assertTrue(address(pool).balance >= liabilities);
    }

    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return IERC721Receiver.onERC721Received.selector;
    }

    receive() external payable {}
}
