// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {FWARewards as FWARewardsReference} from "fwa-rewards-reference/src/FWARewards.sol";

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

contract MockRewardsCore {
    bool public rescueAllowed;

    function setRescueAllowed(bool allowed) external {
        rescueAllowed = allowed;
    }

    function canRescueRewards() external view returns (bool) {
        return rescueAllowed;
    }

    function register(FWARewardsHyperEVM rewards, uint256 requestId, address purchaser, uint256 fee, uint256 surcharge)
        external
        returns (uint256 slice, uint64 epoch)
    {
        return rewards.registerAcquisition(requestId, purchaser, fee, surcharge);
    }

    function settle(FWARewardsHyperEVM rewards, uint256 requestId) external payable {
        rewards.settleAcquisition{value: msg.value}(requestId);
    }
}

contract FWARewardsHyperEVMTest is TestBase {
    uint24 internal constant POOL_FEE = 10_000;
    int24 internal constant TICK_SPACING = 200;

    address internal constant OWNER = address(0xA11CE);
    address internal constant CORE = address(0xF0A);
    address internal constant DEPOSITOR = address(0xDE00);
    address internal constant PURCHASER = address(0xB0B);

    MockHyperSwapERC20 internal token;
    FWAHyperSwapAdapter internal adapter;
    FWARewardsHyperEVM internal rewards;
    FWARewardsReference internal referenceRewards;

    function setUp() public {
        token = new MockHyperSwapERC20("Hyper World Assets", "HWA");
        MockHyperSwapERC20 whype = new MockHyperSwapERC20("Wrapped HYPE", "wHYPE");
        MockHyperSwapV3Factory factory = new MockHyperSwapV3Factory();
        MockHypeSink sink = new MockHypeSink();
        MockHyperSwapV3Router router =
            new MockHyperSwapV3Router(address(factory), address(whype), token, payable(address(sink)));

        (address token0, address token1) =
            address(whype) < address(token) ? (address(whype), address(token)) : (address(token), address(whype));
        MockHyperSwapV3Pool pool = new MockHyperSwapV3Pool(token0, token1, POOL_FEE, TICK_SPACING);
        factory.setFeeAmount(POOL_FEE, TICK_SPACING);
        factory.setPool(address(whype), address(token), POOL_FEE, address(pool));

        adapter =
            new FWAHyperSwapAdapter(address(factory), address(router), address(whype), address(token), POOL_FEE, OWNER);
        rewards = new FWARewardsHyperEVM(address(token), address(adapter), OWNER);
        referenceRewards = new FWARewardsReference(address(token), IPoolManager(address(1)), address(2), OWNER);

        vm.startPrank(OWNER);
        adapter.setRewardsBuyer(address(rewards));
        rewards.setFWA(CORE);
        referenceRewards.setFWA(CORE);
        vm.stopPrank();
    }

    function testConstructorAndCoreWiring() public view {
        assertEq(rewards.token(), address(token));
        assertEq(address(rewards.swapAdapter()), address(adapter));
        assertEq(rewards.fwa(), CORE);
        assertEq(adapter.rewardsBuyer(), address(rewards));
    }

    function testFuzzHotColdCurveMatchesReference(uint32 rawGap) public view {
        uint256 gap = bound(rawGap, 0, 10_000);
        assertEq(rewards.tokenShareBps(gap), referenceRewards.tokenShareBps(gap));
    }

    function testListingEmissionAccountingMatchesReference() public {
        uint256 depositorTotal = 15 days * 1 ether;
        uint256 purchaserTotal = 150_000_000 ether;

        vm.startPrank(OWNER);
        rewards.setEmission(depositorTotal, purchaserTotal);
        referenceRewards.setEmission(depositorTotal, purchaserTotal);
        vm.stopPrank();

        vm.startPrank(CORE);
        rewards.onListingActivated(7, DEPOSITOR, 4 ether);
        referenceRewards.onListingActivated(7, DEPOSITOR, 4 ether);
        rewards.startEmission();
        referenceRewards.startEmission();
        vm.stopPrank();

        vm.warp(block.timestamp + 1 days);

        assertEq(rewards.sqrtBackingTotal(), referenceRewards.sqrtBackingTotal());
        assertEq(rewards.pendingDepositorTokens(7), referenceRewards.pendingDepositorTokens(7));
        assertEq(rewards.currentEpoch(), referenceRewards.currentEpoch());

        (address depositorA, bool activeA, uint256 sqrtA, uint256 debtA) = rewards.listingRewards(7);
        (address depositorB, bool activeB, uint256 sqrtB, uint256 debtB) = referenceRewards.listingRewards(7);
        assertEq(depositorA, depositorB);
        assertTrue(activeA == activeB);
        assertEq(sqrtA, sqrtB);
        assertEq(debtA, debtB);
    }

    function testAcquisitionAccountingMatchesThenClaimsThroughHyperSwap() public {
        vm.startPrank(OWNER);
        rewards.setForcedTokenShareBps(10_000);
        referenceRewards.setForcedTokenShareBps(10_000);
        vm.stopPrank();

        uint256 fee = 1.1 ether;
        uint256 sliceA;
        uint256 sliceB;
        uint64 epochA;
        uint64 epochB;

        vm.prank(CORE);
        (sliceA, epochA) = rewards.registerAcquisition(42, PURCHASER, fee, 1_000);
        vm.prank(CORE);
        (sliceB, epochB) = referenceRewards.registerAcquisition(42, PURCHASER, fee, 1_000);

        assertEq(sliceA, 0.1 ether);
        assertEq(sliceA, sliceB);
        assertEq(epochA, epochB);

        vm.deal(CORE, sliceA + sliceB);
        vm.prank(CORE);
        rewards.settleAcquisition{value: sliceA}(42);
        vm.prank(CORE);
        referenceRewards.settleAcquisition{value: sliceB}(42);

        assertEq(rewards.tokenBuyAllowance(PURCHASER), referenceRewards.tokenBuyAllowance(PURCHASER));
        assertEq(rewards.tokenBuyAllowanceTotal(), referenceRewards.tokenBuyAllowanceTotal());
        assertEq(rewards.acquisitionsInEpoch(epochA), referenceRewards.acquisitionsInEpoch(epochB));
        assertEq(rewards.userAcquisitionsInEpoch(epochA, PURCHASER), 1);

        vm.prank(PURCHASER);
        uint256 tokenOut = rewards.claimAccruedTokens(0.2 ether);

        assertEq(tokenOut, 0.2 ether);
        assertEq(token.balanceOf(PURCHASER), 0.2 ether);
        assertEq(rewards.tokenBuyAllowance(PURCHASER), 0);
        assertEq(rewards.tokenBuyAllowanceTotal(), 0);
        assertEq(address(rewards).balance, 0);
        assertEq(address(adapter).balance, 0);
    }

    function testCoreBuyForUsesExactInputAdapterAndTransfersRecipient() public {
        vm.deal(CORE, 0.5 ether);
        vm.prank(CORE);
        uint256 tokenOut = rewards.buyFor{value: 0.5 ether}(PURCHASER, 1 ether);

        assertEq(tokenOut, 1 ether);
        assertEq(token.balanceOf(PURCHASER), 1 ether);
        assertEq(token.balanceOf(address(rewards)), 0);
        assertEq(address(rewards).balance, 0);
        assertEq(address(adapter).balance, 0);
    }

    function testRefundAcquisitionDrainsPendingEpochAndCannotRepeat() public {
        vm.prank(CORE);
        (, uint64 epoch) = rewards.registerAcquisition(91, PURCHASER, 1.1 ether, 1_000);
        assertEq(rewards.pendingAcquisitionsInEpoch(epoch), 1);

        vm.prank(CORE);
        rewards.refundAcquisition(91);
        assertEq(rewards.pendingAcquisitionsInEpoch(epoch), 0);
        assertEq(rewards.acquisitionsInEpoch(epoch), 0);

        vm.prank(CORE);
        vm.expectRevert(FWARewardsHyperEVM.AcquisitionAlreadyTerminal.selector);
        rewards.refundAcquisition(91);
    }

    function testClosedEpochClaimIsUnitWeightedAndCannotRepeat() public {
        vm.prank(OWNER);
        rewards.setEmission(0, 150 ether);
        token.mint(address(rewards), 20 ether);

        vm.prank(CORE);
        rewards.startEmission();
        vm.prank(CORE);
        (uint256 sliceA,) = rewards.registerAcquisition(101, PURCHASER, 1.1 ether, 1_000);
        vm.prank(CORE);
        (uint256 sliceB,) = rewards.registerAcquisition(102, DEPOSITOR, 1.1 ether, 1_000);
        vm.deal(CORE, sliceA + sliceB);
        vm.prank(CORE);
        rewards.settleAcquisition{value: sliceA}(101);
        vm.prank(CORE);
        rewards.settleAcquisition{value: sliceB}(102);

        vm.warp(rewards.emissionStart() + 3 days);
        uint256[] memory epochs = new uint256[](1);
        epochs[0] = 0;
        vm.prank(PURCHASER);
        uint256 claimed = rewards.claimEpochTokens(epochs);
        assertEq(claimed, 5 ether);

        vm.prank(PURCHASER);
        vm.expectRevert(FWARewardsHyperEVM.AlreadyClaimed.selector);
        rewards.claimEpochTokens(epochs);
    }

    function testClosedEpochCannotClaimWhileRequestIsPending() public {
        vm.prank(OWNER);
        rewards.setEmission(0, 15 ether);
        token.mint(address(rewards), 15 ether);
        vm.prank(CORE);
        rewards.startEmission();
        vm.prank(CORE);
        rewards.registerAcquisition(111, PURCHASER, 1.1 ether, 1_000);

        vm.warp(rewards.emissionStart() + 1 days + 1);
        uint256[] memory epochs = new uint256[](1);
        epochs[0] = 0;
        vm.prank(PURCHASER);
        vm.expectRevert(FWARewardsHyperEVM.EpochStillPending.selector);
        rewards.claimEpochTokens(epochs);
    }

    function testEmptyEpochSweepBurnsOnceAndRejectsNonEmptyEpoch() public {
        vm.prank(OWNER);
        rewards.setEmission(0, 15 ether);
        token.mint(address(rewards), 15 ether);
        vm.prank(CORE);
        rewards.startEmission();
        vm.warp(rewards.emissionStart() + 2 days + 1);

        uint256 supplyBefore = token.totalSupply();
        uint256 liabilityBefore = rewards.tokenLiability();
        vm.prank(OWNER);
        uint256 swept = rewards.sweepEmptyEpoch(0, PURCHASER);
        assertEq(swept, 1 ether);
        assertEq(token.balanceOf(PURCHASER), 0);
        assertEq(token.totalSupply(), supplyBefore - swept);
        assertEq(rewards.tokenLiability(), liabilityBefore - swept);

        vm.prank(OWNER);
        vm.expectRevert(FWARewardsHyperEVM.AlreadyClaimed.selector);
        rewards.sweepEmptyEpoch(0, PURCHASER);

        vm.prank(CORE);
        (uint256 slice, uint64 epoch) = rewards.registerAcquisition(121, PURCHASER, 1.1 ether, 1_000);
        vm.deal(CORE, slice);
        vm.prank(CORE);
        rewards.settleAcquisition{value: slice}(121);
        vm.warp(block.timestamp + 1 days + 1);
        vm.prank(OWNER);
        vm.expectRevert(FWARewardsHyperEVM.EpochNotEmpty.selector);
        rewards.sweepEmptyEpoch(epoch, PURCHASER);
    }

    function testNewListingCannotFarmPreActivationEmissionAndDuplicateIdsDoNotDoubleClaim() public {
        uint256 depositorTotal = 15 days * 1 ether;
        vm.prank(OWNER);
        rewards.setEmission(depositorTotal, 0);
        token.mint(address(rewards), depositorTotal);
        vm.prank(CORE);
        rewards.startEmission();
        vm.warp(rewards.emissionStart() + 1 days);

        vm.prank(CORE);
        rewards.onListingActivated(7, DEPOSITOR, 4 ether);
        uint256[] memory one = new uint256[](1);
        one[0] = 7;
        vm.prank(DEPOSITOR);
        vm.expectRevert(FWARewardsHyperEVM.NoTokenReward.selector);
        rewards.claimDepositorTokens(one);

        vm.warp(rewards.emissionStart() + 2 days);
        uint256[] memory duplicate = new uint256[](2);
        duplicate[0] = 7;
        duplicate[1] = 7;
        vm.prank(DEPOSITOR);
        uint256 claimed = rewards.claimDepositorTokens(duplicate);
        assertEq(claimed, 1 days * 1 ether);
        assertEq(token.balanceOf(DEPOSITOR), claimed);
    }

    function testEmptyPoolPausesDepositorBudgetUntilAListingIsActive() public {
        uint256 depositorTotal = 15 days * 1 ether;
        vm.prank(OWNER);
        rewards.setEmission(depositorTotal, 0);
        token.mint(address(rewards), depositorTotal);
        vm.prank(CORE);
        rewards.startEmission();

        vm.warp(block.timestamp + 30 days);
        assertEq(rewards.depositorEmissionRemaining(), depositorTotal);

        vm.prank(CORE);
        rewards.onListingActivated(8, DEPOSITOR, 1 ether);
        assertEq(rewards.pendingDepositorTokens(8), 0);

        vm.warp(block.timestamp + 1 days);
        vm.prank(DEPOSITOR);
        uint256 claimed = rewards.claimDepositorTokens(_single(8));
        assertEq(claimed, 1 days * 1 ether);
        assertEq(rewards.depositorEmissionRemaining(), depositorTotal - claimed);
    }

    function testEmissionCanOnlyBeConfiguredOnce() public {
        vm.prank(OWNER);
        rewards.setEmission(15 ether, 15 ether);

        vm.prank(OWNER);
        vm.expectRevert(FWARewardsHyperEVM.EmissionAlreadyStarted.selector);
        rewards.setEmission(15 ether, 15 ether);
    }

    function testRescueOnlyTransfersSurplusAndPreservesParticipantLiability() public {
        MockRewardsCore mockCore = new MockRewardsCore();
        FWARewardsHyperEVM protectedRewards = new FWARewardsHyperEVM(address(token), address(adapter), OWNER);
        vm.prank(OWNER);
        protectedRewards.setFWA(address(mockCore));
        vm.prank(OWNER);
        protectedRewards.setEmission(15 ether, 15 ether);
        token.mint(address(protectedRewards), 35 ether);
        mockCore.setRescueAllowed(true);

        uint256 expectedSurplus = token.balanceOf(address(protectedRewards)) - protectedRewards.tokenLiability();
        vm.prank(OWNER);
        uint256 rescued = protectedRewards.rescueTokens(PURCHASER);
        assertEq(rescued, expectedSurplus);
        assertEq(token.balanceOf(address(protectedRewards)), protectedRewards.tokenLiability());
        assertEq(protectedRewards.depositorRatePerSec(), 15 ether / protectedRewards.EMISSION_DURATION());
        assertEq(protectedRewards.purchaserDailyPot(), 1 ether);

        vm.prank(OWNER);
        assertEq(protectedRewards.rescueTokens(PURCHASER), 0);
    }

    function testEmergencyAllowanceWithdrawalRequiresCoreWindDownAndPreservesSolvency() public {
        MockRewardsCore mockCore = new MockRewardsCore();
        FWARewardsHyperEVM emergencyRewards = new FWARewardsHyperEVM(address(token), address(adapter), address(this));
        emergencyRewards.setFWA(address(mockCore));
        emergencyRewards.setForcedTokenShareBps(10_000);

        (uint256 slice,) = mockCore.register(emergencyRewards, 131, PURCHASER, 1.1 ether, 1_000);
        vm.deal(address(mockCore), slice);
        mockCore.settle{value: slice}(emergencyRewards, 131);
        assertEq(address(emergencyRewards).balance, slice);

        vm.prank(PURCHASER);
        vm.expectRevert(FWARewardsHyperEVM.RescueNotAllowed.selector);
        emergencyRewards.withdrawTokenBuyAllowanceAsETH();

        mockCore.setRescueAllowed(true);
        uint256 balanceBefore = PURCHASER.balance;
        vm.prank(PURCHASER);
        uint256 withdrawn = emergencyRewards.withdrawTokenBuyAllowanceAsETH();
        assertEq(withdrawn, slice);
        assertEq(PURCHASER.balance, balanceBefore + slice);
        assertEq(emergencyRewards.tokenBuyAllowanceTotal(), 0);
        assertEq(address(emergencyRewards).balance, 0);
    }

    function _single(uint256 value) private pure returns (uint256[] memory values) {
        values = new uint256[](1);
        values[0] = value;
    }
}
