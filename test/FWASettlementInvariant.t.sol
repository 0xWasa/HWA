// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {StdInvariant} from "../contracts/lib/forge-std/src/StdInvariant.sol";
import {FWA} from "fwa-reference/src/FWA.sol";
import {FWAConfigKeys} from "fwa-reference/src/FWAConfigKeys.sol";
import {FWAVRFService} from "fwa-vrf-reference/src/FWAVRFService.sol";
import {FWAWhitelist} from "fwa-whitelist-reference/src/FWAWhitelist.sol";

import {PoPRandomnessAdapter} from "../src/hyperevm/PoPRandomnessAdapter.sol";
import {MockProofOfPlayVRNG} from "./mocks/MockProofOfPlayVRNG.sol";
import {MockERC721, IERC721Receiver} from "./mocks/MockERC721.sol";
import {TestBase, Vm} from "./utils/TestBase.sol";

/// @notice Adversarial settlement actor.
///
/// @dev This handler deliberately repairs three reachability defects that otherwise make an FWA
///      invariant campaign vacuous over the entire post-allocation state space:
///
///      1. It tracks EVERY outstanding randomness request instead of only the newest one.
///         `processAcquisitions` is a strict FIFO that `break`s while its head is `Pending`, so a
///         handler that can only fulfil `provider.lastRequestId()` permanently head-of-line blocks
///         the queue the moment two acquisitions are outstanding at once.
///      2. It can advance block height and timestamp. Foundry advances neither between invariant
///         calls, so without this the `wordDeadlineBlock` expiry escape hatch, the purchaser
///         `settlementWindow` and the permissionless `finalizeWindow` are all unreachable and the
///         acquisition queue can never drain even in principle.
///      3. It exposes every settlement branch rather than only `keepNFT`/`acceptDepositorBid`.
///
///      Actions are total: an unavailable protocol transition is a no-op rather than a
///      campaign-invalidating revert, so `fail_on_revert` stays meaningful.
contract FWASettlementActor is IERC721Receiver {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    FWA public immutable pool;
    MockERC721 public immutable nft;
    MockProofOfPlayVRNG public immutable provider;

    uint256 public nextTokenId;

    /// @dev While true this actor refuses ERC-721 delivery, which is exactly how a listing enters
    ///      the `stuckNFTRecipient` state that recovery is supposed to drain.
    bool public refuseDelivery;

    /// @dev Every randomness request this actor has opened and not yet seen fulfilled.
    uint256[] public outstanding;

    constructor(FWA pool_, MockERC721 nft_, MockProofOfPlayVRNG provider_, uint256 firstTokenId) payable {
        pool = pool_;
        nft = nft_;
        provider = provider_;
        nextTokenId = firstTokenId;
    }

    function setRefuseDelivery(bool value) external {
        refuseDelivery = value;
    }

    function outstandingCount() external view returns (uint256) {
        return outstanding.length;
    }

    // --- deposit side -------------------------------------------------------

    function list(uint96 rawBacking) external {
        if (nextTokenId % 1000 > 60) return;
        uint256 backing = 0.01 ether + uint256(rawBacking) % 5 ether;
        uint256 tokenId = nextTokenId++;
        nft.mint(address(this), tokenId);
        nft.approve(address(pool), tokenId);
        _attempt(address(pool), backing, abi.encodeCall(FWA.listNFT, (address(nft), tokenId)));
    }

    function withdraw(uint256 rawId) external {
        uint256 listingId = _pickListing(rawId);
        if (listingId == 0) return;
        _attempt(address(pool), 0, abi.encodeCall(FWA.withdrawListing, (listingId)));
    }

    function updateBacking(uint256 rawId, uint96 rawBacking) external {
        uint256 listingId = _pickListing(rawId);
        if (listingId == 0) return;
        uint256 backing = 0.01 ether + uint256(rawBacking) % 5 ether;
        _attempt(address(pool), backing, abi.encodeCall(FWA.updateBacking, (listingId, backing)));
    }

    // --- acquisition side ---------------------------------------------------

    function acquire() external {
        if (pool.activeListingCount() == 0) return;
        uint256 cost = pool.acquisitionFee() + pool.vrfServiceFee();
        if (!_attempt(address(pool), cost, abi.encodeWithSignature("acquire(uint256,uint256)", 0, 0))) return;
        uint256 requestId = provider.lastRequestId();
        if (requestId != 0) outstanding.push(requestId);
    }

    /// @dev Fulfils an ARBITRARY outstanding request so callbacks arrive out of order.
    function fulfillAny(uint256 rawIndex, uint256 word) external {
        uint256 length = outstanding.length;
        if (length == 0) return;
        uint256 index = rawIndex % length;
        uint256 requestId = outstanding[index];
        if (_attempt(address(provider), 0, abi.encodeCall(MockProofOfPlayVRNG.fulfill, (requestId, word)))) {
            outstanding[index] = outstanding[length - 1];
            outstanding.pop();
        }
    }

    function process() external {
        _attempt(address(pool), 0, abi.encodeCall(FWA.processAcquisitions, (4)));
        _attempt(address(pool), 0, abi.encodeCall(FWA.activateListings, (4)));
    }

    /// @dev Non-strict delivery uses plain `transferFrom`, so only a misbehaving COLLECTION can
    ///      push a resolved listing into `stuckNFTRecipient`. Refusing the receiver hook only
    ///      blocks the strict `keepNFT` path.
    function toggleCollectionFailure(bool failing) external {
        _attempt(address(nft), 0, abi.encodeCall(MockERC721.setTransfersRevert, (failing)));
    }

    // --- clock --------------------------------------------------------------

    /// @dev Short hops: reach `wordDeadlineBlock` expiry and ordinary block progression.
    function advanceBlocks(uint16 rawBlocks) external {
        uint256 blocks = 1 + uint256(rawBlocks) % 64;
        vm.roll(block.number + blocks);
        vm.warp(block.timestamp + blocks * 2);
    }

    /// @dev Long hops: reach `settlementWindow` and `finalizeWindow`.
    function advanceWindow(uint8 rawHours) external {
        vm.roll(block.number + 1 + uint256(rawHours) % 32);
        vm.warp(block.timestamp + 1 hours + uint256(rawHours) % (72 hours));
    }

    // --- settlement branches ------------------------------------------------

    function purchaserSettle(uint256 rawId, uint8 branch) external {
        uint256 listingId = _pickListing(rawId);
        if (listingId == 0) return;
        uint8 choice = branch % 4;
        if (choice == 0) {
            _attempt(address(pool), 0, abi.encodeCall(FWA.keepNFT, (listingId)));
        } else if (choice == 1) {
            _attempt(address(pool), 0, abi.encodeCall(FWA.acceptDepositorBid, (listingId)));
        } else if (choice == 2) {
            _attempt(address(pool), 0, abi.encodeCall(FWA.acceptBidAsTokens, (listingId, 0)));
        } else {
            _attempt(address(pool), 0.05 ether, abi.encodeCall(FWA.relistNFT, (listingId)));
        }
    }

    function depositorResolve(uint256 rawId, bool takeNFT) external {
        uint256 listingId = _pickListing(rawId);
        if (listingId == 0) return;
        if (takeNFT) _attempt(address(pool), 0, abi.encodeCall(FWA.depositorReclaimNFT, (listingId)));
        else _attempt(address(pool), 0, abi.encodeCall(FWA.depositorReclaimBacking, (listingId)));
    }

    function finalize(uint256 rawId) external {
        uint256 listingId = _pickListing(rawId);
        if (listingId == 0) return;
        _attempt(address(pool), 0, abi.encodeCall(FWA.finalizeUnsettled, (listingId)));
    }

    function recover(uint256 rawId) external {
        uint256 listingId = _pickListing(rawId);
        if (listingId == 0) return;
        _attempt(address(pool), 0, abi.encodeCall(FWA.recoverStuckNFT, (listingId)));
    }

    function claim(uint256 rawId) external {
        uint256 listingId = _pickListing(rawId);
        if (listingId != 0) {
            uint256[] memory ids = new uint256[](1);
            ids[0] = listingId;
            _attempt(address(pool), 0, abi.encodeCall(FWA.claimListingFees, (ids)));
        }
        _attempt(address(pool), 0, abi.encodeCall(FWA.withdrawEarnings, ()));
        _attempt(address(pool), 0, abi.encodeCall(FWA.withdrawAcquisitionRefund, ()));
    }

    // --- internals ----------------------------------------------------------

    function _pickListing(uint256 rawId) private view returns (uint256) {
        uint256 count = pool.nextListingId();
        if (count <= 1) return 0;
        return 1 + rawId % (count - 1);
    }

    function _attempt(address target, uint256 value, bytes memory data) private returns (bool) {
        if (address(this).balance < value) return false;
        (bool success,) = target.call{value: value}(data);
        return success;
    }

    function onERC721Received(address, address, uint256, bytes calldata) external view returns (bytes4) {
        if (refuseDelivery) return bytes4(0xdeadbeef);
        return IERC721Receiver.onERC721Received.selector;
    }

    receive() external payable {}
}

/// @notice Two-actor stateful campaign over the FULL FWA lifecycle: every settlement branch,
///         out-of-order randomness callbacks, an advancing clock, and a purchaser that refuses
///         NFT delivery so the stuck-NFT state is reachable.
contract FWASettlementInvariantTest is TestBase, StdInvariant {
    MockProofOfPlayVRNG internal provider;
    PoPRandomnessAdapter internal adapter;
    FWAVRFService internal service;
    FWA internal pool;
    FWAWhitelist internal whitelist;
    MockERC721 internal nft;
    FWASettlementActor internal alice;
    FWASettlementActor internal bob;

    function setUp() public {
        vm.txGasPrice(0);
        provider = new MockProofOfPlayVRNG();
        adapter = new PoPRandomnessAdapter(address(provider), address(this));
        service = new FWAVRFService(1, 1);
        pool = new FWA(address(adapter), 1, keccak256("SETTLEMENT_VRNG"), 900_000, address(service));
        whitelist = new FWAWhitelist(address(pool), address(0), 0, address(this));
        nft = new MockERC721();

        alice = new FWASettlementActor(pool, nft, provider, 1);
        bob = new FWASettlementActor(pool, nft, provider, 1001);
        bob.setRefuseDelivery(true);

        vm.deal(address(alice), 10_000 ether);
        vm.deal(address(bob), 10_000 ether);

        adapter.setConsumer(address(pool));
        service.setFWA(address(pool));
        service.setFeeConfig(1, 0, 2);
        pool.setAddr(FWAConfigKeys.WHITELIST_MANAGER, address(whitelist));
        address[] memory collections = new address[](1);
        collections[0] = address(nft);
        whitelist.setCollections(collections, true);
        pool.setBool(FWAConfigKeys.ACQUISITIONS_ENABLED, true);

        bytes4[] memory selectors = new bytes4[](14);
        selectors[0] = FWASettlementActor.list.selector;
        selectors[1] = FWASettlementActor.withdraw.selector;
        selectors[2] = FWASettlementActor.updateBacking.selector;
        selectors[3] = FWASettlementActor.acquire.selector;
        selectors[4] = FWASettlementActor.fulfillAny.selector;
        selectors[5] = FWASettlementActor.process.selector;
        selectors[6] = FWASettlementActor.advanceBlocks.selector;
        selectors[7] = FWASettlementActor.advanceWindow.selector;
        selectors[8] = FWASettlementActor.purchaserSettle.selector;
        selectors[9] = FWASettlementActor.depositorResolve.selector;
        selectors[10] = FWASettlementActor.finalize.selector;
        selectors[11] = FWASettlementActor.recover.selector;
        selectors[12] = FWASettlementActor.claim.selector;
        selectors[13] = FWASettlementActor.toggleCollectionFailure.selector;

        targetSelector(FuzzSelector({addr: address(alice), selectors: selectors}));
        targetSelector(FuzzSelector({addr: address(bob), selectors: selectors}));
        targetContract(address(alice));
        targetContract(address(bob));
    }

    /// @notice The weight tree and every running total agree with the enumerated listings across
    ///         all settlement branches.
    function invariant_TreeAndRunningTotalsSurviveSettlement() public view {
        uint256 activeCount;
        uint256 stagedCount;
        uint256 activeBacking;
        uint256 totalWeight;
        uint256 weightedBacking;
        uint256 next = pool.nextListingId();
        for (uint256 listingId = 1; listingId < next; ++listingId) {
            (,,,, uint256 weight, uint256 backing,,,,, FWA.ListingStatus status) = pool.listings(listingId);
            if (status == FWA.ListingStatus.Active) {
                ++activeCount;
                activeBacking += backing;
                totalWeight += weight;
                weightedBacking += weight * backing;
            } else if (status == FWA.ListingStatus.Staged) {
                ++stagedCount;
            }
        }
        assertEq(pool.activeListingCount(), activeCount);
        assertEq(pool.stagedCount() + pool.reservedStagedCount(), stagedCount);
        assertEq(pool.activeBackingTotal(), activeBacking);
        assertEq(pool.totalWeight(), totalWeight);
        assertEq(pool.treeRootWeight(), totalWeight);
        assertEq(pool.weightedBackingTotal(), weightedBacking);
    }

    /// @notice The core custodies every NFT it still owes to someone — including one whose
    ///         delivery failed and which is awaiting `recoverStuckNFT`.
    function invariant_CoreCustodiesEveryOwedNFT() public view {
        uint256 next = pool.nextListingId();
        for (uint256 listingId = 1; listingId < next; ++listingId) {
            (address collection,,, uint256 tokenId,,,,,,, FWA.ListingStatus status) = pool.listings(listingId);
            bool unsettled = status == FWA.ListingStatus.Active || status == FWA.ListingStatus.Staged
                || status == FWA.ListingStatus.Allocated;
            if (unsettled || pool.stuckNFTRecipient(listingId) != address(0)) {
                assertEq(collection, address(nft));
                assertEq(nft.ownerOf(tokenId), address(pool));
            }
        }
    }

    /// @notice Native balance always covers every enumerated liability, for both actors.
    function invariant_NativeBalanceCoversAllLiabilities() public view {
        uint256 backingLiability;
        uint256 pendingFeeLiability;
        uint256 next = pool.nextListingId();
        for (uint256 listingId = 1; listingId < next; ++listingId) {
            (,,,,, uint256 backing,,,,, FWA.ListingStatus status) = pool.listings(listingId);
            if (
                status == FWA.ListingStatus.Active || status == FWA.ListingStatus.Staged
                    || status == FWA.ListingStatus.Allocated
            ) backingLiability += backing;
            if (status == FWA.ListingStatus.Active) pendingFeeLiability += pool.pendingFees(listingId);
        }

        uint256 requestEscrow;
        uint256 lastSequence = pool.lastIssuedSequence();
        for (uint256 sequence = 1; sequence <= lastSequence; ++sequence) {
            uint256 requestId = pool.requestIdAtSequence(uint64(sequence));
            (,, uint256 escrow,, FWA.AcquisitionStatus status) = pool.acquisitions(requestId);
            if (
                status == FWA.AcquisitionStatus.Pending || status == FWA.AcquisitionStatus.Ready
                    || status == FWA.AcquisitionStatus.TimedOut
            ) requestEscrow += escrow;
        }

        uint256 liabilities = backingLiability + pendingFeeLiability + requestEscrow + pool.topListingPot()
            + pool.accruedOwnerFees() + pool.feeCredit(address(alice)) + pool.feeCredit(address(bob))
            + pool.acquisitionRefundCreditTotal();
        assertTrue(address(pool).balance >= liabilities);
    }
}
