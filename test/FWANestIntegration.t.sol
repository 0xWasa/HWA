// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {FWANestLiquidityLocker} from "../src/hyperevm/FWANestLiquidityLocker.sol";
import {FWANestPlugin} from "../src/hyperevm/FWANestPlugin.sol";
import {FWANestSwapAdapter} from "../src/hyperevm/FWANestSwapAdapter.sol";
import {FWATokenNest} from "../src/hyperevm/FWATokenNest.sol";
import {FWARewardsHyperEVM} from "../src/hyperevm/FWARewardsHyperEVM.sol";
import {INestSwapRouter} from "../src/hyperevm/interfaces/INestAlgebra.sol";
import {
    MockNestAlgebraFactory,
    MockNestAlgebraPool,
    MockNestERC20,
    MockNestPositionManager,
    MockNestSwapRouter
} from "./mocks/MockNestAlgebra.sol";
import {TestBase} from "./utils/TestBase.sol";

contract FWANestIntegrationTest is TestBase {
    address internal constant USER = address(0xB0B);
    address internal constant FEE_RECIPIENT = address(0xFEE);
    uint160 internal constant INITIAL_PRICE = uint160(1 << 96);

    MockNestERC20 internal whype;
    MockNestAlgebraFactory internal factory;
    MockNestPositionManager internal positionManager;
    MockNestSwapRouter internal router;
    FWATokenNest internal token;
    MockNestAlgebraPool internal pool;
    FWANestPlugin internal plugin;
    FWANestLiquidityLocker internal locker;
    FWANestSwapAdapter internal adapter;
    FWARewardsHyperEVM internal rewards;
    bool internal rescueAllowed;

    function setUp() public {
        whype = new MockNestERC20("Wrapped HYPE", "wHYPE");
        factory = new MockNestAlgebraFactory();
        positionManager = new MockNestPositionManager(address(factory), address(whype));
        router = new MockNestSwapRouter(address(factory), address(whype));
        token = new FWATokenNest(
            "Hyper World Assets",
            "HWA",
            1_000_000 ether,
            500_000 ether,
            address(factory),
            address(positionManager),
            address(whype),
            address(this)
        );

        pool = MockNestAlgebraPool(factory.createPool(address(whype), address(token)));
        plugin = new FWANestPlugin(address(pool), address(token), address(whype));
        locker = new FWANestLiquidityLocker(address(positionManager), address(token), FEE_RECIPIENT, address(this));

        pool.setPlugin(address(plugin));
        pool.setPluginConfig(plugin.REQUIRED_PLUGIN_CONFIG());
        token.setMarketInfrastructure(address(plugin), address(locker));

        token.initializeMarket(INITIAL_PRICE);
        // Algebra applies the factory defaults during initialization; Nest then configures this pool.
        pool.setFee(token.POOL_FEE());
        pool.setCommunityFee(token.REQUIRED_COMMUNITY_FEE());
        pool.setTickSpacing(token.POOL_TICK_SPACING());

        (int24 lower, int24 upper) = _launchRange(address(token) < address(whype));
        token.finalizeLaunch(lower, upper);
        adapter =
            new FWANestSwapAdapter(address(factory), address(router), address(whype), address(token), address(this));
        rewards = new FWARewardsHyperEVM(address(token), address(adapter), address(this));
        token.setAdapter(address(adapter));
        token.setRewardsPool(address(rewards));
        token.setBuybackMinOutPerHypeX96(1 << 96);
        adapter.setRewardsBuyer(address(rewards));
        rewards.setFWA(address(this));
    }

    function testLaunchBindsPluginAndIrrevocableLocker() public view {
        assertEq(keccak256(bytes(token.name())), keccak256(bytes("Hyper World Assets")));
        assertEq(keccak256(bytes(token.symbol())), keccak256(bytes("HWA")));
        assertTrue(token.launched());
        assertEq(token.pool(), address(pool));
        assertEq(token.plugin(), address(plugin));
        assertEq(token.liquidityLocker(), address(locker));
        assertTrue(locker.bound());
        assertEq(locker.tokenId(), token.lpTokenId());
        assertEq(positionManager.ownerOf(token.lpTokenId()), address(locker));
        assertTrue(plugin.deploymentBlock() != 0);
        assertEq(token.balanceOf(address(pool)), 500_000 ether);
    }

    function testExternalBuyIsBlockedUntilExplicitOpen() public {
        whype.mint(USER, 1 ether);
        vm.startPrank(USER);
        whype.approve(address(router), type(uint256).max);

        INestSwapRouter.ExactInputSingleParams memory params = INestSwapRouter.ExactInputSingleParams({
            tokenIn: address(whype),
            tokenOut: address(token),
            recipient: USER,
            deadline: block.timestamp,
            amountIn: 0.01 ether,
            amountOutMinimum: 0,
            limitSqrtPrice: 0
        });
        vm.expectRevert(FWANestPlugin.ExternalBuysDisabled.selector);
        router.exactInputSingle(params);
        vm.stopPrank();

        token.setExternalBuysEnabled(true);
        vm.prank(USER);
        uint256 amountOut = router.exactInputSingle(params);
        assertEq(token.balanceOf(USER), amountOut);
    }

    function testOnlyOwnerCanManuallyOpenAndCloseExternalBuys() public {
        assertFalse(token.externalBuysEnabled());

        vm.prank(USER);
        vm.expectRevert();
        token.setExternalBuysEnabled(true);
        assertFalse(token.externalBuysEnabled());

        token.setExternalBuysEnabled(true);
        assertTrue(token.externalBuysEnabled());

        token.setExternalBuysEnabled(false);
        assertFalse(token.externalBuysEnabled());
    }

    function testProtocolBuybackWorksWhileExternalBuysAreClosed() public {
        vm.deal(address(token), 1 ether);
        vm.roll(block.number + 1);

        uint256 supplyBefore = token.totalSupply();
        vm.prank(USER);
        uint256 amountOut = token.buyback();

        assertTrue(amountOut != 0);
        // With no active depositor weight, the depositor route is burned by
        // rewards in addition to the token's explicit burn route.
        uint256 burnedBps = token.routeBurnBps() + token.routeDepositorBps();
        assertEq(token.totalSupply(), supplyBefore - amountOut * burnedBps / 10_000);
        assertEq(address(adapter).balance, 0);
        assertFalse(token.externalBuysEnabled());
    }

    function testPurchaserAccruedClaimUsesNestWhileExternalBuysStayClosed() public {
        rewards.setForcedTokenShareBps(10_000);
        (uint256 slice,) = rewards.registerAcquisition(77, USER, 1.1 ether, 1_000);
        vm.deal(address(this), slice);
        rewards.settleAcquisition{value: slice}(77);

        vm.prank(USER);
        uint256 amountOut = rewards.claimAccruedTokens(0.09 ether);

        assertTrue(amountOut >= 0.09 ether);
        assertEq(token.balanceOf(USER), amountOut);
        assertEq(rewards.tokenBuyAllowance(USER), 0);
        assertEq(address(adapter).balance, 0);
        assertFalse(token.externalBuysEnabled());
    }

    function testBuybackRoutesIntoRealRewardsAccounting() public {
        rewards.onListingActivated(9, USER, 4 ether);
        vm.deal(address(token), 1 ether);
        vm.roll(block.number + 1);

        token.buyback();

        assertTrue(rewards.accTokenPerSqrt() > 0);
        assertTrue(rewards.purchaserEpochPot(rewards.currentEpoch()) > 0);
        assertTrue(rewards.pendingDepositorTokens(9) > 0);
    }

    function testRewardsRescueRequiresCoreWindDownSignal() public {
        rewards.setEmission(15 ether, 15 ether);
        token.transfer(address(rewards), 40 ether);
        vm.expectRevert(FWARewardsHyperEVM.RescueNotAllowed.selector);
        rewards.rescueTokens(USER);

        rescueAllowed = true;
        uint256 expectedSurplus = token.balanceOf(address(rewards)) - rewards.tokenLiability();
        uint256 rescued = rewards.rescueTokens(USER);
        assertEq(rescued, expectedSurplus);
        assertEq(token.balanceOf(USER), expectedSurplus);
        assertEq(token.balanceOf(address(rewards)), rewards.tokenLiability());
        assertEq(rewards.depositorRatePerSec(), 15 ether / rewards.EMISSION_DURATION());
        assertEq(rewards.purchaserDailyPot(), 1 ether);
    }

    function testOutsiderCannotSpoofProtocolRecipientWhileMarketIsClosed() public {
        whype.mint(USER, 1 ether);
        vm.startPrank(USER);
        whype.approve(address(router), type(uint256).max);
        vm.expectRevert(FWANestPlugin.ExternalBuysDisabled.selector);
        router.exactInputSingle(
            INestSwapRouter.ExactInputSingleParams({
                tokenIn: address(whype),
                tokenOut: address(token),
                recipient: address(token),
                deadline: block.timestamp,
                amountIn: 0.01 ether,
                amountOutMinimum: 0,
                limitSqrtPrice: 0
            })
        );
        vm.stopPrank();
    }

    function testPluginRejectsExactOutput() public {
        bool zeroToOne = address(whype) == pool.token0();
        vm.expectRevert(FWANestPlugin.ExactOutputNotAllowed.selector);
        pool.swapMock(USER, zeroToOne, -1, 0);
    }

    function testPluginRejectsAdditionalLiquidityAfterLaunch() public {
        vm.expectRevert(FWANestPlugin.NotLaunching.selector);
        pool.beforeMintMock(USER, 1);
    }

    function testPluginRejectsSwapBetweenInitializationAndFinalLaunch() public {
        FWATokenNest otherToken = new FWATokenNest(
            "Pending",
            "PENDING",
            1_000 ether,
            500 ether,
            address(factory),
            address(positionManager),
            address(whype),
            address(this)
        );
        MockNestAlgebraPool otherPool = MockNestAlgebraPool(factory.createPool(address(whype), address(otherToken)));
        FWANestPlugin otherPlugin = new FWANestPlugin(address(otherPool), address(otherToken), address(whype));
        FWANestLiquidityLocker otherLocker =
            new FWANestLiquidityLocker(address(positionManager), address(otherToken), FEE_RECIPIENT, address(this));
        otherPool.setPlugin(address(otherPlugin));
        otherPool.setPluginConfig(otherPlugin.REQUIRED_PLUGIN_CONFIG());
        otherToken.setMarketInfrastructure(address(otherPlugin), address(otherLocker));
        otherToken.initializeMarket(INITIAL_PRICE);

        bool zeroToOne = address(whype) == otherPool.token0();
        vm.expectRevert(FWANestPlugin.MarketNotLaunched.selector);
        otherPool.swapMock(USER, zeroToOne, 1, 0);
    }

    function testLaunchRejectsNestCommunityFeeCapture() public {
        FWATokenNest otherToken = new FWATokenNest(
            "Other",
            "OTHER",
            1_000 ether,
            500 ether,
            address(factory),
            address(positionManager),
            address(whype),
            address(this)
        );
        MockNestAlgebraPool otherPool = MockNestAlgebraPool(factory.createPool(address(whype), address(otherToken)));
        FWANestPlugin otherPlugin = new FWANestPlugin(address(otherPool), address(otherToken), address(whype));
        FWANestLiquidityLocker otherLocker =
            new FWANestLiquidityLocker(address(positionManager), address(otherToken), FEE_RECIPIENT, address(this));
        otherPool.setPlugin(address(otherPlugin));
        otherPool.setPluginConfig(otherPlugin.REQUIRED_PLUGIN_CONFIG());
        otherToken.setMarketInfrastructure(address(otherPlugin), address(otherLocker));
        otherToken.initializeMarket(INITIAL_PRICE);
        otherPool.setFee(otherToken.POOL_FEE());
        // Deliberately retain Nest's post-init default communityFee = 1000.
        (int24 lower, int24 upper) = _launchRange(address(otherToken) < address(whype));

        vm.expectRevert(FWATokenNest.InvalidPoolConfiguration.selector);
        otherToken.finalizeLaunch(lower, upper);
    }

    function testPoolConfigDriftStopsEverySwap() public {
        token.setExternalBuysEnabled(true);
        pool.setFee(500);
        whype.mint(USER, 1 ether);
        vm.startPrank(USER);
        whype.approve(address(router), type(uint256).max);
        vm.expectRevert(FWANestPlugin.InvalidPoolConfiguration.selector);
        router.exactInputSingle(
            INestSwapRouter.ExactInputSingleParams({
                tokenIn: address(whype),
                tokenOut: address(token),
                recipient: USER,
                deadline: block.timestamp,
                amountIn: 0.01 ether,
                amountOutMinimum: 0,
                limitSqrtPrice: 0
            })
        );
        vm.stopPrank();
    }

    function testConfigDriftHypeRescueIsDelayedPinnedAndSafeOnly() public {
        vm.deal(address(token), 2 ether);
        pool.setFee(500);
        token.scheduleEmergencyHypeRescue();

        vm.expectRevert(FWATokenNest.RescueDelayNotElapsed.selector);
        token.executeEmergencyHypeRescue();

        vm.warp(block.timestamp + token.EMERGENCY_RESCUE_DELAY());
        pool.setFee(600);
        vm.expectRevert(FWATokenNest.RescueConditionChanged.selector);
        token.executeEmergencyHypeRescue();

        token.scheduleEmergencyHypeRescue();
        vm.warp(block.timestamp + token.EMERGENCY_RESCUE_DELAY());
        uint256 ownerBefore = address(this).balance;
        vm.prank(USER);
        uint256 rescued = token.executeEmergencyHypeRescue();
        assertEq(rescued, 2 ether);
        assertEq(address(token).balance, 0);
        assertEq(address(this).balance, ownerBefore + 2 ether);
    }

    function testRemovingPluginCannotBypassTokenCircuitBreaker() public {
        token.setExternalBuysEnabled(true);
        pool.setPlugin(address(0));
        whype.mint(USER, 1 ether);
        vm.startPrank(USER);
        whype.approve(address(router), type(uint256).max);
        // The mock pool wraps the token transfer in require(), so it strips the nested custom error.
        vm.expectRevert();
        router.exactInputSingle(
            INestSwapRouter.ExactInputSingleParams({
                tokenIn: address(whype),
                tokenOut: address(token),
                recipient: USER,
                deadline: block.timestamp,
                amountIn: 0.01 ether,
                amountOutMinimum: 0,
                limitSqrtPrice: 0
            })
        );
        vm.stopPrank();
    }

    function _launchRange(bool hwaIsToken0) private pure returns (int24 lower, int24 upper) {
        if (hwaIsToken0) return (0, 3_600);
        return (-3_600, 0);
    }

    function canRescueRewards() external view returns (bool) {
        return rescueAllowed;
    }
}
