// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {FWAHyperSwapAdapter} from "../src/hyperevm/FWAHyperSwapAdapter.sol";
import {FWARewardsHyperEVM} from "../src/hyperevm/FWARewardsHyperEVM.sol";
import {
    MockHypeSink,
    MockHyperSwapERC20,
    MockHyperSwapV3Factory,
    MockHyperSwapV3Pool,
    MockHyperSwapV3Router
} from "./mocks/MockHyperSwapV3.sol";
import {TestBase} from "./utils/TestBase.sol";

contract MockRewardsCoreV2 {
    bool public rescueAllowed;

    function setRescueAllowed(bool allowed) external {
        rescueAllowed = allowed;
    }

    function canRescueRewards() external view returns (bool) {
        return rescueAllowed;
    }

    function start(FWARewardsHyperEVM rewards) external {
        rewards.startEmission();
    }

    function register(FWARewardsHyperEVM rewards, uint256 id, address buyer, uint256 fee)
        external
        returns (uint256 slice, uint64 epoch)
    {
        return rewards.registerAcquisition(id, buyer, fee, 1_000);
    }

    function settle(FWARewardsHyperEVM rewards, uint256 id) external payable {
        rewards.settleAcquisition{value: msg.value}(id);
    }

    function refund(FWARewardsHyperEVM rewards, uint256 id) external {
        rewards.refundAcquisition(id);
    }
}

contract FWARewardsHyperEVMTest is TestBase {
    uint256 internal constant Q96 = 1 << 96;
    address internal constant OWNER = address(0xA11CE);
    address internal constant DEPOSITOR = address(0xDE00);
    address internal constant BUYER_A = address(0xB0B);
    address internal constant BUYER_B = address(0xB0C);

    MockHyperSwapERC20 internal token;
    FWAHyperSwapAdapter internal adapter;
    FWARewardsHyperEVM internal rewards;
    MockRewardsCoreV2 internal core;

    function setUp() public {
        token = new MockHyperSwapERC20("HWA", "HWA");
        MockHyperSwapERC20 whype = new MockHyperSwapERC20("Wrapped HYPE", "wHYPE");
        MockHyperSwapV3Factory factory = new MockHyperSwapV3Factory();
        MockHypeSink sink = new MockHypeSink();
        MockHyperSwapV3Router router =
            new MockHyperSwapV3Router(address(factory), address(whype), token, payable(address(sink)));
        (address token0, address token1) =
            address(whype) < address(token) ? (address(whype), address(token)) : (address(token), address(whype));
        MockHyperSwapV3Pool pool = new MockHyperSwapV3Pool(token0, token1, 10_000, 200);
        factory.setFeeAmount(10_000, 200);
        factory.setPool(address(whype), address(token), 10_000, address(pool));
        adapter =
            new FWAHyperSwapAdapter(address(factory), address(router), address(whype), address(token), 10_000, OWNER);
        rewards = new FWARewardsHyperEVM(address(token), address(adapter), OWNER);
        core = new MockRewardsCoreV2();
        vm.startPrank(OWNER);
        adapter.setRewardsBuyer(address(rewards));
        rewards.setFWA(address(core));
        rewards.setEmission(50_000_000 ether, 50_000_000 ether);
        vm.stopPrank();
        token.mint(address(rewards), 100_000_000 ether);
    }

    function _start() internal {
        core.start(rewards);
    }

    function _settle(uint256 id, address buyer, uint256 fee) internal returns (uint64 epoch) {
        (uint256 slice, uint64 e) = core.register(rewards, id, buyer, fee);
        vm.deal(address(core), address(core).balance + slice);
        core.settle{value: slice}(rewards, id);
        return e;
    }

    function testReviewedSeasonBudgetsAreExact() public view {
        uint256 total;
        for (uint256 epoch; epoch < 45; ++epoch) {
            total += rewards.seasonEpochCap(epoch);
        }
        assertEq(total, 100_000_000 ether);
        assertEq(rewards.seasonBudget(0), 50_000_000 ether);
        assertEq(rewards.seasonBudget(1), 30_000_000 ether);
        assertEq(rewards.seasonBudget(2), 20_000_000 ether);
        assertEq(rewards.seasonBudget(3), 0);
    }

    function testClaimsAndEmissionRemainClosedBeforeExplicitLaunch() public {
        assertFalse(rewards.claimsEnabled());
        assertEq(rewards.emissionStart(), 0);
        vm.prank(DEPOSITOR);
        vm.expectRevert(FWARewardsHyperEVM.ClaimsPaused.selector);
        rewards.claimDepositorTokens(_single(1));
    }

    function testLowerOfLaunchAndTwapCapsFivePercentValue() public {
        token.setSeasonQuotes(2 * Q96, 3 * Q96);
        _start();
        vm.prank(address(core));
        rewards.onListingActivated(1, DEPOSITOR, 1 ether);
        _settle(1, BUYER_A, 1 ether);
        assertEq(rewards.effectiveSeasonQuoteX96(), 2 * Q96);
        assertEq(rewards.epochSeasonalEmitted(0), 0.1 ether);
        assertEq(rewards.pendingDepositorTokens(1), 0.05 ether);
        assertEq(rewards.purchaserSeasonalEpochPot(0), 0.05 ether);
    }

    function testFallingPriceNeverUnlocksMoreTokens() public {
        token.setSeasonQuotes(4 * Q96, 1 * Q96);
        _start();
        vm.prank(address(core));
        rewards.onListingActivated(1, DEPOSITOR, 1 ether);
        _settle(1, BUYER_A, 2 ether);
        assertEq(rewards.epochSeasonalEmitted(0), 0.1 ether);
    }

    function testUnavailableTwapUnlocksNothing() public {
        token.setSeasonQuotes(2 * Q96, 0);
        _start();
        vm.prank(address(core));
        rewards.onListingActivated(1, DEPOSITOR, 1 ether);
        _settle(1, BUYER_A, 10 ether);
        assertEq(rewards.epochSeasonalEmitted(0), 0);
    }

    function testProtocolSeedIsExcludedFromSeasonalDepositorRewards() public {
        _start();
        vm.prank(address(core));
        rewards.onListingActivated(1, OWNER, 1 ether);
        uint256 supply = token.totalSupply();
        _settle(1, BUYER_A, 1 ether);
        assertEq(rewards.seasonalSqrtBackingTotal(), 0);
        assertEq(rewards.pendingDepositorTokens(1), 0);
        assertEq(token.totalSupply(), supply - 0.025 ether);
        assertEq(rewards.purchaserSeasonalEpochPot(0), 0.025 ether);
    }

    function testRefundedAcquisitionCreatesNoVolumeOrEmission() public {
        _start();
        (, uint64 epoch) = core.register(rewards, 1, BUYER_A, 4 ether);
        core.refund(rewards, 1);
        assertEq(rewards.settledHypeInEpoch(epoch), 0);
        assertEq(rewards.epochSeasonalEmitted(epoch), 0);
    }

    function testPurchaserRewardsWeightActualHypeSpent() public {
        _start();
        vm.prank(address(core));
        rewards.onListingActivated(1, DEPOSITOR, 1 ether);
        _settle(1, BUYER_A, 1 ether);
        _settle(2, BUYER_B, 3 ether);
        vm.warp(rewards.emissionStart() + 1 days + 1);
        rewards.finalizeEpoch(0);
        vm.prank(OWNER);
        rewards.enableClaims();
        vm.prank(BUYER_A);
        uint256 a = rewards.claimEpochTokens(_single(0));
        vm.prank(BUYER_B);
        uint256 b = rewards.claimEpochTokens(_single(0));
        assertEq(b, a * 3);
        assertEq(a + b, 0.1 ether);
    }

    function testUnusedDailyCapacityBurnsAndDoesNotCarry() public {
        _start();
        vm.warp(rewards.emissionStart() + 1 days + 1);
        uint256 cap = rewards.seasonEpochCap(0);
        uint256 supply = token.totalSupply();
        uint256 burned = rewards.finalizeEpoch(0);
        assertEq(burned, cap);
        assertEq(token.totalSupply(), supply - cap);
        assertTrue(rewards.epochFinalized(0));
    }

    function testBuybackRewardsAreTrackedSeparately() public {
        _start();
        vm.prank(address(core));
        rewards.onListingActivated(1, DEPOSITOR, 1 ether);
        token.mint(address(rewards), 30 ether);
        vm.prank(address(token));
        rewards.onTokenReceived(10 ether, 20 ether);
        assertEq(rewards.buybackDepositorRouted(), 10 ether);
        assertEq(rewards.buybackPurchaserRouted(), 20 ether);
        assertEq(rewards.purchaserEpochPot(0), 20 ether);
        assertEq(rewards.purchaserSeasonalEpochPot(0), 0);
    }

    function testColdGapCurveAndCanonicalConfig() public view {
        assertEq(rewards.tokenShareBps(60), 0);
        assertEq(rewards.tokenShareBps(3600), 10_000);
        assertEq(rewards.tokenShareBps(1830), 5_000);
        assertEq(rewards.seasonExcludedDepositor(), OWNER);
        assertEq(rewards.tokenLiability(), 100_000_000 ether);
    }

    function testEmissionConfigurationIsFixedAndOneShot() public {
        FWARewardsHyperEVM fresh = new FWARewardsHyperEVM(address(token), address(adapter), OWNER);
        vm.prank(OWNER);
        vm.expectRevert(FWARewardsHyperEVM.InvalidConfig.selector);
        fresh.setEmission(49_000_000 ether, 51_000_000 ether);
        vm.prank(OWNER);
        fresh.setEmission(50_000_000 ether, 50_000_000 ether);
        vm.prank(OWNER);
        vm.expectRevert(FWARewardsHyperEVM.EmissionAlreadyStarted.selector);
        fresh.setEmission(50_000_000 ether, 50_000_000 ether);
    }

    function testRescuePreservesEntireUnallocatedReserve() public {
        token.mint(address(rewards), 5 ether);
        core.setRescueAllowed(true);
        vm.prank(OWNER);
        uint256 amount = rewards.rescueTokens(BUYER_A);
        assertEq(amount, 5 ether);
        assertEq(token.balanceOf(address(rewards)), rewards.tokenLiability());
    }

    function _single(uint256 value) private pure returns (uint256[] memory values) {
        values = new uint256[](1);
        values[0] = value;
    }
}
