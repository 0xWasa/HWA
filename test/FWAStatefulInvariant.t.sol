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
import {TestBase} from "./utils/TestBase.sol";

contract FWAInvariantHandler is IERC721Receiver {
    FWA public immutable pool;
    MockERC721 public immutable nft;
    MockProofOfPlayVRNG public immutable provider;
    uint256 public nextTokenId = 1;

    constructor(FWA pool_, MockERC721 nft_, MockProofOfPlayVRNG provider_) payable {
        pool = pool_;
        nft = nft_;
        provider = provider_;
    }

    function list(uint96 rawBacking) external {
        if (nextTokenId > 24) return;
        uint256 backing = 0.01 ether + uint256(rawBacking) % 5 ether;
        uint256 tokenId = nextTokenId++;
        nft.mint(address(this), tokenId);
        nft.approve(address(pool), tokenId);
        // Handler actions are deliberately total: an unavailable protocol
        // transition becomes a no-op rather than invalidating the campaign.
        _attempt(address(pool), backing, abi.encodeCall(FWA.listNFT, (address(nft), tokenId)));
    }

    function withdraw(uint256 rawId) external {
        uint256 count = pool.nextListingId();
        if (count <= 1) return;
        uint256 listingId = 1 + rawId % (count - 1);
        _attempt(address(pool), 0, abi.encodeCall(FWA.withdrawListing, (listingId)));
    }

    function updateBacking(uint256 rawId, uint96 rawBacking) external {
        uint256 count = pool.nextListingId();
        if (count <= 1) return;
        uint256 listingId = 1 + rawId % (count - 1);
        uint256 backing = 0.01 ether + uint256(rawBacking) % 5 ether;
        _attempt(address(pool), backing, abi.encodeCall(FWA.updateBacking, (listingId, backing)));
    }

    function acquire() external {
        if (pool.activeListingCount() == 0) return;
        uint256 cost = pool.acquisitionFee() + pool.vrfServiceFee();
        _attempt(address(pool), cost, abi.encodeWithSignature("acquire(uint256,uint256)", 0, 0));
    }

    function fulfill(uint256 word) external {
        uint256 requestId = provider.lastRequestId();
        if (requestId == 0) return;
        _attempt(address(provider), 0, abi.encodeCall(MockProofOfPlayVRNG.fulfill, (requestId, word)));
    }

    function process() external {
        _attempt(address(pool), 0, abi.encodeCall(FWA.processAcquisitions, (4)));
        _attempt(address(pool), 0, abi.encodeCall(FWA.activateListings, (4)));
    }

    function settle(uint256 rawId, bool acceptBid) external {
        uint256 count = pool.nextListingId();
        if (count <= 1) return;
        uint256 listingId = 1 + rawId % (count - 1);
        if (acceptBid) _attempt(address(pool), 0, abi.encodeCall(FWA.acceptDepositorBid, (listingId)));
        else _attempt(address(pool), 0, abi.encodeCall(FWA.keepNFT, (listingId)));
    }

    function claim(uint256 rawId) external {
        uint256 count = pool.nextListingId();
        if (count > 1) {
            uint256[] memory ids = new uint256[](1);
            ids[0] = 1 + rawId % (count - 1);
            _attempt(address(pool), 0, abi.encodeCall(FWA.claimListingFees, (ids)));
        }
        _attempt(address(pool), 0, abi.encodeCall(FWA.withdrawEarnings, ()));
        _attempt(address(pool), 0, abi.encodeCall(FWA.withdrawAcquisitionRefund, ()));
    }

    function _attempt(address target, uint256 value, bytes memory data) private {
        (bool success,) = target.call{value: value}(data);
        if (!success) return;
    }

    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return IERC721Receiver.onERC721Received.selector;
    }

    receive() external payable {}
}

contract FWAStatefulInvariantTest is TestBase, StdInvariant {
    MockProofOfPlayVRNG internal provider;
    PoPRandomnessAdapter internal adapter;
    FWAVRFService internal service;
    FWA internal pool;
    FWAWhitelist internal whitelist;
    MockERC721 internal nft;
    FWAInvariantHandler internal handler;

    function setUp() public {
        vm.txGasPrice(0);
        provider = new MockProofOfPlayVRNG();
        adapter = new PoPRandomnessAdapter(address(provider), address(this));
        service = new FWAVRFService(1, 1);
        pool = new FWA(address(adapter), 1, keccak256("INVARIANT_VRNG"), 900_000, address(service));
        whitelist = new FWAWhitelist(address(pool), address(0), 0, address(this));
        nft = new MockERC721();
        handler = new FWAInvariantHandler(pool, nft, provider);

        vm.deal(address(handler), 10_000 ether);
        adapter.setConsumer(address(pool));
        service.setFWA(address(pool));
        service.setFeeConfig(1, 0, 2);
        pool.setAddr(FWAConfigKeys.WHITELIST_MANAGER, address(whitelist));
        address[] memory collections = new address[](1);
        collections[0] = address(nft);
        whitelist.setCollections(collections, true);
        pool.setBool(FWAConfigKeys.ACQUISITIONS_ENABLED, true);

        bytes4[] memory selectors = new bytes4[](8);
        selectors[0] = handler.list.selector;
        selectors[1] = handler.withdraw.selector;
        selectors[2] = handler.updateBacking.selector;
        selectors[3] = handler.acquire.selector;
        selectors[4] = handler.fulfill.selector;
        selectors[5] = handler.process.selector;
        selectors[6] = handler.settle.selector;
        selectors[7] = handler.claim.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
        targetContract(address(handler));
    }

    function invariant_TreeAndRunningTotalsMatchEveryActiveListing() public view {
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

    function invariant_CoreAlwaysCustodiesEveryUnsettledNFT() public view {
        uint256 next = pool.nextListingId();
        for (uint256 listingId = 1; listingId < next; ++listingId) {
            (address collection,,, uint256 tokenId,,,,,,, FWA.ListingStatus status) = pool.listings(listingId);
            if (
                status == FWA.ListingStatus.Active || status == FWA.ListingStatus.Staged
                    || status == FWA.ListingStatus.Allocated
            ) {
                assertEq(collection, address(nft));
                assertEq(nft.ownerOf(tokenId), address(pool));
            }
        }
    }

    function invariant_NativeBalanceCoversAllEnumeratedLiabilities() public view {
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
            + pool.accruedOwnerFees() + pool.feeCredit(address(handler)) + pool.acquisitionRefundCreditTotal();
        assertTrue(address(pool).balance >= liabilities);
    }
}
