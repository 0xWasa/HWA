// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {FWA} from "fwa-reference/src/FWA.sol";
import {FWAConfigKeys} from "fwa-reference/src/FWAConfigKeys.sol";
import {FWAVRFService} from "fwa-vrf-reference/src/FWAVRFService.sol";
import {FWAWhitelist} from "fwa-whitelist-reference/src/FWAWhitelist.sol";

import {FWAHyperSwapAdapter} from "../src/hyperevm/FWAHyperSwapAdapter.sol";
import {FWARewardsHyperEVM} from "../src/hyperevm/FWARewardsHyperEVM.sol";
import {PoPRandomnessAdapter} from "../src/hyperevm/PoPRandomnessAdapter.sol";
import {
    MockHypeSink,
    MockHyperSwapERC20,
    MockHyperSwapV3Factory,
    MockHyperSwapV3Pool,
    MockHyperSwapV3Router
} from "./mocks/MockHyperSwapV3.sol";
import {MockProofOfPlayVRNG} from "./mocks/MockProofOfPlayVRNG.sol";
import {MockERC721, IERC721Receiver} from "./mocks/MockERC721.sol";
import {TestBase} from "./utils/TestBase.sol";

contract RewardsBuyer is IERC721Receiver {
    function call(address target, uint256 value, bytes calldata data) external returns (bool ok) {
        (ok,) = target.call{value: value}(data);
    }

    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return IERC721Receiver.onERC721Received.selector;
    }

    receive() external payable {}
}

/// @notice Deterministic proof that the FWA core ↔ FWARewardsHyperEVM boundary is reachable and
///         correct at every terminal state.
///
/// @dev Reachability here is ASSERTED, not inferred from a green fuzz campaign. The companion
///      stateful suite in `FWARewardsIntegrationInvariant.t.sol` provides breadth; these tests pin
///      the specific states its invariants are meant to police. Before this file, `FWA.setRewards`
///      was called by no test in the repository, so `registerAcquisition`, `settleAcquisition`,
///      `refundAcquisition`, `startEmission` and `buyFor` were all unexecuted at the release gate
///      even though mainnet latches `REWARDS_REQUIRED_FOR_ACTIVATION` one-way and therefore cannot
///      run without them.
contract FWARewardsIntegrationBranchesTest is TestBase, IERC721Receiver {
    uint24 internal constant POOL_FEE = 10_000;
    int24 internal constant TICK_SPACING = 200;

    uint256 internal constant DEPOSITOR_EMISSION = 150_000_000 ether;
    uint256 internal constant PURCHASER_EMISSION = 150_000_000 ether;
    uint256 internal constant REWARDS_FUNDING = 300_000_000 ether;

    address internal constant DEPOSITOR = address(0xDEB0);
    uint256 internal constant BACKING = 1 ether;

    MockProofOfPlayVRNG internal provider;
    PoPRandomnessAdapter internal randomness;
    FWAVRFService internal service;
    FWA internal pool;
    FWAWhitelist internal whitelist;
    MockERC721 internal nft;
    RewardsBuyer internal buyer;

    MockHyperSwapERC20 internal token;
    FWAHyperSwapAdapter internal swapAdapter;
    FWARewardsHyperEVM internal rewards;

    function setUp() public {
        vm.txGasPrice(0);

        token = new MockHyperSwapERC20("Hyper World Assets", "HWA");
        MockHyperSwapERC20 whype = new MockHyperSwapERC20("Wrapped HYPE", "wHYPE");
        MockHyperSwapV3Factory factory = new MockHyperSwapV3Factory();
        MockHypeSink sink = new MockHypeSink();
        MockHyperSwapV3Router router =
            new MockHyperSwapV3Router(address(factory), address(whype), token, payable(address(sink)));
        (address token0, address token1) =
            address(whype) < address(token) ? (address(whype), address(token)) : (address(token), address(whype));
        MockHyperSwapV3Pool v3Pool = new MockHyperSwapV3Pool(token0, token1, POOL_FEE, TICK_SPACING);
        factory.setFeeAmount(POOL_FEE, TICK_SPACING);
        factory.setPool(address(whype), address(token), POOL_FEE, address(v3Pool));

        swapAdapter = new FWAHyperSwapAdapter(
            address(factory), address(router), address(whype), address(token), POOL_FEE, address(this)
        );
        rewards = new FWARewardsHyperEVM(address(token), address(swapAdapter), address(this));
        swapAdapter.setRewardsBuyer(address(rewards));

        provider = new MockProofOfPlayVRNG();
        randomness = new PoPRandomnessAdapter(address(provider), address(this));
        service = new FWAVRFService(1, 1);
        pool = new FWA(address(randomness), 1, keccak256("REWARDS_BRANCHES"), 900_000, address(service));
        whitelist = new FWAWhitelist(address(pool), address(0), 0, address(this));
        nft = new MockERC721();
        buyer = new RewardsBuyer();

        randomness.setConsumer(address(pool));
        service.setFWA(address(pool));
        service.setFeeConfig(1, 0, 2);
        pool.setAddr(FWAConfigKeys.WHITELIST_MANAGER, address(whitelist));
        address[] memory collections = new address[](1);
        collections[0] = address(nft);
        whitelist.setCollections(collections, true);
        pool.setUint(FWAConfigKeys.SURCHARGE_BPS, 1000);

        rewards.setEmission(DEPOSITOR_EMISSION, PURCHASER_EMISSION);
        rewards.setFWA(address(pool));
        token.mint(address(rewards), REWARDS_FUNDING);
        pool.setRewards(address(rewards));
        pool.setBool(FWAConfigKeys.ACCEPT_BID_AS_TOKENS_ENABLED, true);
        pool.setBool(FWAConfigKeys.ACQUISITIONS_ENABLED, true);

        vm.deal(address(this), 10_000 ether);
        vm.deal(address(buyer), 10_000 ether);
        vm.deal(DEPOSITOR, 10_000 ether);
        vm.roll(block.number + 1000);
        vm.warp(block.timestamp + 1000);
    }

    /*//////////////////////////////////////////////////////////////
                        WIRING AND ACTIVATION GATE
    //////////////////////////////////////////////////////////////*/

    /// @notice The module is really bound and the core really started its emission clock.
    function testCoreIsBoundToRewardsAndStartedEmission() public view {
        assertEq(address(pool.rewards()), address(rewards));
        assertEq(pool.token(), address(token));
        assertEq(rewards.fwa(), address(pool));
        assertTrue(rewards.emissionStart() != 0);
    }

    /// @notice The mainnet activation latch is one-way and refuses to open without a rewards module.
    function testRewardsRequiredForActivationLatchIsOneWayAndBlocksActivation() public {
        FWAVRFService freshService = new FWAVRFService(1, 1);
        FWA fresh = new FWA(address(randomness), 1, keccak256("LATCH"), 900_000, address(freshService));
        freshService.setFWA(address(fresh));

        fresh.setBool(FWAConfigKeys.REWARDS_REQUIRED_FOR_ACTIVATION, true);

        // Cannot be unset once latched.
        vm.expectRevert();
        fresh.setBool(FWAConfigKeys.REWARDS_REQUIRED_FOR_ACTIVATION, false);

        // Cannot open acquisitions while no rewards module is bound.
        vm.expectRevert();
        fresh.setBool(FWAConfigKeys.ACQUISITIONS_ENABLED, true);

        assertFalse(fresh.acquisitionsEnabled());
    }

    /*//////////////////////////////////////////////////////////////
                          ACQUISITION REWARD PATHS
    //////////////////////////////////////////////////////////////*/

    /// @notice A settled acquisition funds the purchaser's HYPE allowance exactly, and that
    ///         allowance is spendable into HWA through the adapter.
    function testSettledAcquisitionFundsAndSpendsPurchaserAllowance() public {
        uint256 listingId = _allocate(1);
        assertTrue(listingId != 0);

        uint256 allowance = rewards.tokenBuyAllowance(address(buyer));
        assertTrue(allowance != 0);
        // The module holds exactly what it owes: no receive/fallback exists, so this is equality.
        assertEq(address(rewards).balance, allowance);
        assertEq(rewards.tokenBuyAllowanceTotal(), allowance);

        uint256 tokensBefore = token.balanceOf(address(buyer));
        assertTrue(buyer.call(address(rewards), 0, abi.encodeCall(FWARewardsHyperEVM.claimAccruedTokens, (0))));

        assertTrue(token.balanceOf(address(buyer)) > tokensBefore);
        assertEq(rewards.tokenBuyAllowance(address(buyer)), 0);
        assertEq(rewards.tokenBuyAllowanceTotal(), 0);
        assertEq(address(rewards).balance, 0);
    }

    /// @notice A second claim of an already-spent allowance yields nothing.
    function testPurchaserAllowanceCannotBeClaimedTwice() public {
        _allocate(2);
        assertTrue(buyer.call(address(rewards), 0, abi.encodeCall(FWARewardsHyperEVM.claimAccruedTokens, (0))));
        // NoTokenReward: the allowance is already zero.
        assertFalse(buyer.call(address(rewards), 0, abi.encodeCall(FWARewardsHyperEVM.claimAccruedTokens, (0))));
        assertEq(address(rewards).balance, 0);
    }

    /// @notice An acquisition whose word never arrives reaches the module's Refunded terminal state,
    ///         releases its epoch, and leaves no HYPE liability behind.
    function testExpiredAcquisitionRefundsRewardStateAndLeavesNoAllowance() public {
        _list(3);
        pool.activateListings(8);

        uint256 cost = pool.acquisitionFee() + pool.vrfServiceFee();
        assertTrue(
            buyer.call(address(pool), cost, abi.encodeWithSignature("acquire(uint256,uint256)", uint256(0), uint256(0)))
        );

        uint256 fwaRequestId = pool.requestIdAtSequence(pool.lastIssuedSequence());
        (,, FWARewardsHyperEVM.AcquisitionRewardStatus pending, uint256 slice) =
            rewards.acquisitionRewards(fwaRequestId);
        assertTrue(pending == FWARewardsHyperEVM.AcquisitionRewardStatus.Pending);
        assertTrue(slice != 0);
        assertEq(rewards.pendingAcquisitionsInEpoch(rewards.currentEpoch()), 1);

        // Never fulfil; let the word deadline lapse, then drain the queue.
        vm.roll(block.number + pool.selectionTimeoutBlocks() + 2);
        pool.processAcquisitions(8);

        (,, FWARewardsHyperEVM.AcquisitionRewardStatus terminal,) = rewards.acquisitionRewards(fwaRequestId);
        assertTrue(terminal == FWARewardsHyperEVM.AcquisitionRewardStatus.Refunded);
        assertEq(rewards.pendingAcquisitionsInEpoch(0), 0);
        assertEq(rewards.tokenBuyAllowance(address(buyer)), 0);
        assertEq(rewards.tokenBuyAllowanceTotal(), 0);
        assertEq(address(rewards).balance, 0);
    }

    /// @notice `acceptBidAsTokens` routes the purchaser payout through `rewards.buyFor` and the
    ///         purchaser receives HWA rather than HYPE, without disturbing the allowance ledger.
    function testAcceptBidAsTokensBuysThroughTheRewardsModule() public {
        uint256 listingId = _allocate(4);
        uint256 allowanceBefore = rewards.tokenBuyAllowanceTotal();
        uint256 tokensBefore = token.balanceOf(address(buyer));

        assertTrue(buyer.call(address(pool), 0, abi.encodeCall(FWA.acceptBidAsTokens, (listingId, 0))));

        assertTrue(_status(listingId) == FWA.ListingStatus.Settled);
        assertTrue(token.balanceOf(address(buyer)) > tokensBefore);
        assertEq(nft.ownerOf(4), DEPOSITOR);
        // The token-denominated settlement is funded by the core, not by the purchaser allowance.
        assertEq(rewards.tokenBuyAllowanceTotal(), allowanceBefore);
        assertEq(address(rewards).balance, allowanceBefore);
    }

    /*//////////////////////////////////////////////////////////////
                            DEPOSITOR EMISSION
    //////////////////////////////////////////////////////////////*/

    /// @notice Depositor emission accrues against a live listing, pays out once, and the same
    ///         accrual cannot be harvested a second time.
    function testDepositorEmissionAccruesAndIsClaimableExactlyOnce() public {
        uint256 listingId = _list(5);
        pool.activateListings(8);

        vm.warp(block.timestamp + 1 days);
        uint256 pendingTokens = rewards.pendingDepositorTokens(listingId);
        assertTrue(pendingTokens != 0);

        uint256[] memory ids = new uint256[](1);
        ids[0] = listingId;
        uint256 before = token.balanceOf(DEPOSITOR);
        vm.prank(DEPOSITOR);
        rewards.claimDepositorTokens(ids);
        uint256 received = token.balanceOf(DEPOSITOR) - before;
        assertTrue(received >= pendingTokens);

        // Nothing further has accrued in the same block, so a repeat harvest reverts.
        assertEq(rewards.pendingDepositorTokens(listingId), 0);
        vm.prank(DEPOSITOR);
        vm.expectRevert();
        rewards.claimDepositorTokens(ids);
    }

    /// @notice Only the depositor of a listing can harvest its emission.
    function testNonDepositorCannotHarvestAnotherListing() public {
        uint256 listingId = _list(6);
        pool.activateListings(8);
        vm.warp(block.timestamp + 1 days);

        uint256[] memory ids = new uint256[](1);
        ids[0] = listingId;
        assertFalse(buyer.call(address(rewards), 0, abi.encodeCall(FWARewardsHyperEVM.claimDepositorTokens, (ids))));
    }

    /*//////////////////////////////////////////////////////////////
                         CLOSED-EPOCH PURCHASER POT
    //////////////////////////////////////////////////////////////*/

    /// @notice A closed epoch with no pending requests pays its purchaser exactly once.
    function testClosedEpochPurchaserClaimIsSingleUse() public {
        _allocate(7);

        uint256 epoch = 0;
        assertEq(rewards.acquisitionsInEpoch(epoch), 1);
        assertEq(rewards.pendingAcquisitionsInEpoch(epoch), 0);

        // Close the epoch.
        vm.warp(block.timestamp + 2 days);
        assertTrue(rewards.currentEpoch() > epoch);

        uint256[] memory epochs = new uint256[](1);
        epochs[0] = epoch;
        uint256 before = token.balanceOf(address(buyer));
        assertTrue(buyer.call(address(rewards), 0, abi.encodeCall(FWARewardsHyperEVM.claimEpochTokens, (epochs))));
        assertTrue(token.balanceOf(address(buyer)) > before);
        assertTrue(rewards.purchaserClaimed(epoch, address(buyer)));

        // AlreadyClaimed on the second attempt.
        assertFalse(buyer.call(address(rewards), 0, abi.encodeCall(FWARewardsHyperEVM.claimEpochTokens, (epochs))));
    }

    /// @notice An epoch that still holds a pending request cannot be claimed, so the denominator can
    ///         never grow underneath a claimant.
    function testEpochWithPendingAcquisitionCannotBeClaimed() public {
        _allocate(8);

        _list(9);
        pool.activateListings(8);
        uint256 cost = pool.acquisitionFee() + pool.vrfServiceFee();
        assertTrue(
            buyer.call(address(pool), cost, abi.encodeWithSignature("acquire(uint256,uint256)", uint256(0), uint256(0)))
        );

        uint256 epoch = 0;
        assertTrue(rewards.pendingAcquisitionsInEpoch(epoch) != 0);
        vm.warp(block.timestamp + 2 days);

        uint256[] memory epochs = new uint256[](1);
        epochs[0] = epoch;
        // EpochStillPending.
        assertFalse(buyer.call(address(rewards), 0, abi.encodeCall(FWARewardsHyperEVM.claimEpochTokens, (epochs))));
    }

    /*//////////////////////////////////////////////////////////////
                                HELPERS
    //////////////////////////////////////////////////////////////*/

    function _list(uint256 tokenId) internal returns (uint256 listingId) {
        nft.mint(DEPOSITOR, tokenId);
        vm.prank(DEPOSITOR);
        nft.approve(address(pool), tokenId);
        listingId = pool.nextListingId();
        vm.prank(DEPOSITOR);
        pool.listNFT{value: BACKING}(address(nft), tokenId);
    }

    function _allocate(uint256 tokenId) internal returns (uint256 listingId) {
        _list(tokenId);
        pool.activateListings(8);

        uint256 cost = pool.acquisitionFee() + pool.vrfServiceFee();
        assertTrue(
            buyer.call(address(pool), cost, abi.encodeWithSignature("acquire(uint256,uint256)", uint256(0), uint256(0)))
        );

        uint256 requestId = provider.lastRequestId();
        provider.fulfill(requestId, uint256(keccak256(abi.encode(tokenId))));
        pool.processAcquisitions(8);

        uint256 fwaRequestId = pool.requestIdAtSequence(pool.lastIssuedSequence());
        (,,, listingId,) = pool.acquisitions(fwaRequestId);
        assertTrue(listingId != 0);
        assertTrue(_status(listingId) == FWA.ListingStatus.Allocated);
    }

    function _status(uint256 listingId) internal view returns (FWA.ListingStatus status) {
        (,,,,,,,,,, status) = pool.listings(listingId);
    }

    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return IERC721Receiver.onERC721Received.selector;
    }

    receive() external payable {}
}
