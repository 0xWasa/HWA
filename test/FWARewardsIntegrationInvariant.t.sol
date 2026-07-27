// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {StdInvariant} from "../contracts/lib/forge-std/src/StdInvariant.sol";
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
import {TestBase, Vm} from "./utils/TestBase.sol";

/// @notice Adversarial actor driving the FULL lifecycle of an FWA core that has a real
///         `FWARewardsHyperEVM` bound through `FWA.setRewards`.
///
/// @dev The shipped suites deliberately or accidentally avoid this configuration: `setRewards` is
///      called by no test in the repository, `FWARewardsHyperEVM.t.sol` impersonates the core with a
///      plain EOA constant, and both stateful campaigns run a core whose `rewards` is the zero
///      address. Mainnet is the opposite: `DeployHyperEVMMainnetCore` latches
///      `REWARDS_REQUIRED_FOR_ACTIVATION` one-way, so acquisitions can only ever open WITH a rewards
///      module bound. Every reward hook — `registerAcquisition`, `settleAcquisition`,
///      `refundAcquisition`, `startEmission`, `buyFor` — was therefore unreachable at the gate.
///
///      Actions are total: an unavailable transition is a no-op rather than a campaign-invalidating
///      revert, so `fail_on_revert` stays meaningful.
contract FWARewardsIntegrationActor is IERC721Receiver {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    FWA public immutable pool;
    MockERC721 public immutable nft;
    MockProofOfPlayVRNG public immutable provider;
    FWARewardsHyperEVM public immutable rewards;

    uint256 public nextTokenId;
    uint256[] public outstanding;

    constructor(
        FWA pool_,
        MockERC721 nft_,
        MockProofOfPlayVRNG provider_,
        FWARewardsHyperEVM rewards_,
        uint256 firstTokenId
    ) payable {
        pool = pool_;
        nft = nft_;
        provider = provider_;
        rewards = rewards_;
        nextTokenId = firstTokenId;
    }

    // --- deposit side -------------------------------------------------------

    function list(uint96 rawBacking) external {
        if (nextTokenId % 1000 > 40) return;
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

    // --- clock --------------------------------------------------------------

    function advanceBlocks(uint16 rawBlocks) external {
        uint256 blocks = 1 + uint256(rawBlocks) % 64;
        vm.roll(block.number + blocks);
        vm.warp(block.timestamp + blocks * 2);
    }

    /// @dev Long hops also cross reward-epoch boundaries, which is what makes closed-epoch
    ///      purchaser claims and cross-epoch farming reachable at all.
    function advanceWindow(uint8 rawHours) external {
        vm.roll(block.number + 1 + uint256(rawHours) % 32);
        vm.warp(block.timestamp + 1 hours + uint256(rawHours) % (72 hours));
    }

    // --- settlement branches ------------------------------------------------

    /// @dev Branch 2 is `acceptBidAsTokens`, the only core path that calls `rewards.buyFor`.
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

    function coreClaim(uint256 rawId) external {
        uint256 listingId = _pickListing(rawId);
        if (listingId != 0) {
            uint256[] memory ids = new uint256[](1);
            ids[0] = listingId;
            _attempt(address(pool), 0, abi.encodeCall(FWA.claimListingFees, (ids)));
        }
        _attempt(address(pool), 0, abi.encodeCall(FWA.withdrawEarnings, ()));
        _attempt(address(pool), 0, abi.encodeCall(FWA.withdrawAcquisitionRefund, ()));
    }

    // --- reward claim paths (previously unreachable) -------------------------

    function claimDepositorTokens(uint256 rawId) external {
        uint256 listingId = _pickListing(rawId);
        if (listingId == 0) return;
        uint256[] memory ids = new uint256[](1);
        ids[0] = listingId;
        _attempt(address(rewards), 0, abi.encodeCall(FWARewardsHyperEVM.claimDepositorTokens, (ids)));
    }

    function withdrawTokens() external {
        _attempt(address(rewards), 0, abi.encodeCall(FWARewardsHyperEVM.withdrawTokens, ()));
    }

    /// @dev Spends the purchaser's ETH allowance through the adapter, exercising `_buyTokens`.
    function claimAccruedTokens() external {
        _attempt(address(rewards), 0, abi.encodeCall(FWARewardsHyperEVM.claimAccruedTokens, (0)));
    }

    function claimEpochTokens(uint8 rawEpoch) external {
        uint256 current = rewards.currentEpoch();
        if (current == 0) return;
        uint256[] memory epochs = new uint256[](1);
        epochs[0] = uint256(rawEpoch) % current;
        _attempt(address(rewards), 0, abi.encodeCall(FWARewardsHyperEVM.claimEpochTokens, (epochs)));
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

    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return IERC721Receiver.onERC721Received.selector;
    }

    receive() external payable {}
}

/// @notice Stateful campaign over the FWA core WITH a real rewards module bound, asserting reward
///         custody and solvency alongside the core's own liability conservation.
contract FWARewardsIntegrationInvariantTest is TestBase, StdInvariant {
    uint24 internal constant POOL_FEE = 10_000;
    int24 internal constant TICK_SPACING = 200;

    uint256 internal constant DEPOSITOR_EMISSION = 150_000_000 ether;
    uint256 internal constant PURCHASER_EMISSION = 150_000_000 ether;
    uint256 internal constant REWARDS_FUNDING = 300_000_000 ether;

    MockProofOfPlayVRNG internal provider;
    PoPRandomnessAdapter internal randomness;
    FWAVRFService internal service;
    FWA internal pool;
    FWAWhitelist internal whitelist;
    MockERC721 internal nft;

    MockHyperSwapERC20 internal token;
    FWAHyperSwapAdapter internal swapAdapter;
    FWARewardsHyperEVM internal rewards;

    FWARewardsIntegrationActor internal alice;
    FWARewardsIntegrationActor internal bob;

    function setUp() public {
        vm.txGasPrice(0);

        // --- market side: adapter + rewards module ---------------------------
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

        // --- core side -------------------------------------------------------
        provider = new MockProofOfPlayVRNG();
        randomness = new PoPRandomnessAdapter(address(provider), address(this));
        service = new FWAVRFService(1, 1);
        pool = new FWA(address(randomness), 1, keccak256("REWARDS_INTEGRATION"), 900_000, address(service));
        whitelist = new FWAWhitelist(address(pool), address(0), 0, address(this));
        nft = new MockERC721();

        randomness.setConsumer(address(pool));
        service.setFWA(address(pool));
        service.setFeeConfig(1, 0, 2);
        pool.setAddr(FWAConfigKeys.WHITELIST_MANAGER, address(whitelist));
        address[] memory collections = new address[](1);
        collections[0] = address(nft);
        whitelist.setCollections(collections, true);

        // --- bind the module the way mainnet does, then open ------------------
        rewards.setEmission(DEPOSITOR_EMISSION, PURCHASER_EMISSION);
        rewards.setFWA(address(pool));
        token.mint(address(rewards), REWARDS_FUNDING);
        pool.setRewards(address(rewards));
        pool.setBool(FWAConfigKeys.ACCEPT_BID_AS_TOKENS_ENABLED, true);
        pool.setBool(FWAConfigKeys.ACQUISITIONS_ENABLED, true);

        assertEq(address(pool.rewards()), address(rewards));
        assertTrue(rewards.emissionStart() != 0);

        alice = new FWARewardsIntegrationActor(pool, nft, provider, rewards, 1);
        bob = new FWARewardsIntegrationActor(pool, nft, provider, rewards, 1001);
        vm.deal(address(alice), 10_000 ether);
        vm.deal(address(bob), 10_000 ether);

        bytes4[] memory selectors = new bytes4[](14);
        selectors[0] = FWARewardsIntegrationActor.list.selector;
        selectors[1] = FWARewardsIntegrationActor.withdraw.selector;
        selectors[2] = FWARewardsIntegrationActor.updateBacking.selector;
        selectors[3] = FWARewardsIntegrationActor.acquire.selector;
        selectors[4] = FWARewardsIntegrationActor.fulfillAny.selector;
        selectors[5] = FWARewardsIntegrationActor.process.selector;
        selectors[6] = FWARewardsIntegrationActor.advanceBlocks.selector;
        selectors[7] = FWARewardsIntegrationActor.advanceWindow.selector;
        selectors[8] = FWARewardsIntegrationActor.purchaserSettle.selector;
        selectors[9] = FWARewardsIntegrationActor.depositorResolve.selector;
        selectors[10] = FWARewardsIntegrationActor.claimDepositorTokens.selector;
        selectors[11] = FWARewardsIntegrationActor.withdrawTokens.selector;
        selectors[12] = FWARewardsIntegrationActor.claimAccruedTokens.selector;
        selectors[13] = FWARewardsIntegrationActor.claimEpochTokens.selector;

        targetSelector(FuzzSelector({addr: address(alice), selectors: selectors}));
        targetSelector(FuzzSelector({addr: address(bob), selectors: selectors}));
        targetContract(address(alice));
        targetContract(address(bob));
    }

    /*//////////////////////////////////////////////////////////////
                          REWARDS-SIDE INVARIANTS
    //////////////////////////////////////////////////////////////*/

    /// @notice The module holds exactly the HYPE it owes purchasers, never less and never more.
    ///
    /// @dev `FWARewardsHyperEVM` has no `receive`/`fallback`, so native value can only enter through
    ///      `settleAcquisition` (which requires `msg.value == tokenSlice`) and `buyFor` (spent in the
    ///      same call). Equality is therefore the correct assertion, not an inequality: any drift
    ///      means an escrowed slice was booked without funding or an allowance was released without
    ///      payment.
    function invariant_RewardsNativeBalanceEqualsPurchaserAllowance() public view {
        assertEq(address(rewards).balance, rewards.tokenBuyAllowanceTotal());
    }

    /// @notice The module can always pay every HWA liability it has already recognised.
    function invariant_RewardsTokenBalanceCoversTokenLiabilities() public view {
        uint256 liabilities = rewards.tokenCredit(address(alice)) + rewards.tokenCredit(address(bob));

        uint256 next = pool.nextListingId();
        for (uint256 listingId = 1; listingId < next; ++listingId) {
            liabilities += rewards.pendingDepositorTokens(listingId);
        }

        uint256 current = rewards.currentEpoch();
        for (uint256 epoch = 0; epoch < current; ++epoch) {
            if (rewards.purchaserEpochSwept(epoch)) continue;
            uint256 settled = rewards.acquisitionsInEpoch(epoch);
            if (settled == 0) continue;
            uint256 potential = rewards.purchaserEpochAmount(epoch);
            liabilities += _unclaimedEpochShare(epoch, potential, settled, address(alice));
            liabilities += _unclaimedEpochShare(epoch, potential, settled, address(bob));
        }

        assertTrue(token.balanceOf(address(rewards)) >= liabilities);
    }

    /// @notice Reward-side acquisition bookkeeping never diverges from the core's own view: a
    ///         request the core has resolved is never still Pending in the module, and the module's
    ///         per-epoch pending counter equals the number of Pending requests in that epoch.
    function invariant_AcquisitionRewardStateTracksCore() public view {
        uint256 lastSequence = pool.lastIssuedSequence();
        uint256 currentEpoch = rewards.currentEpoch();
        uint256[] memory pendingPerEpoch = new uint256[](currentEpoch + 2);

        for (uint256 sequence = 1; sequence <= lastSequence; ++sequence) {
            uint256 requestId = pool.requestIdAtSequence(uint64(sequence));
            (,,,, FWA.AcquisitionStatus coreStatus) = pool.acquisitions(requestId);
            (, uint64 epoch, FWARewardsHyperEVM.AcquisitionRewardStatus rewardStatus,) =
                rewards.acquisitionRewards(requestId);

            // Every request the core opened is known to the module.
            assertTrue(rewardStatus != FWARewardsHyperEVM.AcquisitionRewardStatus.None);

            bool coreResolved = coreStatus == FWA.AcquisitionStatus.Expired
                || coreStatus == FWA.AcquisitionStatus.Refunded || coreStatus == FWA.AcquisitionStatus.Fulfilled;
            if (coreResolved) {
                assertTrue(rewardStatus != FWARewardsHyperEVM.AcquisitionRewardStatus.Pending);
            }
            if (rewardStatus == FWARewardsHyperEVM.AcquisitionRewardStatus.Pending && epoch < pendingPerEpoch.length) {
                pendingPerEpoch[epoch] += 1;
            }
        }

        for (uint256 epoch = 0; epoch < pendingPerEpoch.length; ++epoch) {
            assertEq(rewards.pendingAcquisitionsInEpoch(epoch), pendingPerEpoch[epoch]);
        }
    }

    /*//////////////////////////////////////////////////////////////
                       CORE INVARIANTS, REWARDS BOUND
    //////////////////////////////////////////////////////////////*/

    /// @notice The core still custodies every NFT it owes while a rewards module is wired in.
    function invariant_CoreCustodiesEveryOwedNFTWithRewardsBound() public view {
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

    /// @notice Core native solvency holds even though settlement now forwards a slice of every
    ///         acquisition fee out to the rewards module.
    function invariant_CoreNativeBalanceCoversLiabilitiesWithRewardsBound() public view {
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

    function _unclaimedEpochShare(uint256 epoch, uint256 potential, uint256 settled, address account)
        private
        view
        returns (uint256)
    {
        if (rewards.purchaserClaimed(epoch, account)) return 0;
        uint256 mine = rewards.userAcquisitionsInEpoch(epoch, account);
        if (mine == 0) return 0;
        return potential * mine / settled;
    }
}
