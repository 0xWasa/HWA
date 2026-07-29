// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";

import {FWATokenHyperEVM} from "../src/hyperevm/FWATokenHyperEVM.sol";
import {FWATokenHyperEVMFactory} from "../src/hyperevm/FWATokenHyperEVMFactory.sol";
import {HWAProjectXLiquidityLocker} from "../src/hyperevm/HWAProjectXLiquidityLocker.sol";
import {
    MockFWABuybackRouter,
    MockFWATokenAdapter,
    MockHyperSwapERC20,
    MockHyperSwapV3Factory,
    MockHyperSwapV3Pool,
    MockHyperSwapV3PositionManager
} from "./mocks/MockHyperSwapV3.sol";
import {TestBase} from "./utils/TestBase.sol";

contract FWATokenHyperEVMTest is TestBase {
    uint256 internal constant SUPPLY = 1_000_000_000 ether;
    uint256 internal constant LP_SUPPLY = 500_000_000 ether;

    address internal constant OWNER = address(0xA11CE);
    address internal constant FEE_RECIPIENT = address(0x1A);
    address internal constant USER = address(0xB0B);
    address internal constant OTHER = address(0xCAFE);
    address internal constant CALLER = address(0xC011);

    MockHyperSwapERC20 internal whype;
    MockHyperSwapV3Factory internal factory;
    MockHyperSwapV3PositionManager internal positionManager;
    MockHyperSwapV3Pool internal marketPool;
    FWATokenHyperEVM internal token;
    HWAProjectXLiquidityLocker internal locker;

    int24 internal tickLower;
    int24 internal tickUpper;
    uint160 internal sqrtPriceX96;

    function setUp() public {
        whype = new MockHyperSwapERC20("Wrapped HYPE", "wHYPE");
        factory = new MockHyperSwapV3Factory();
        factory.setFeeAmount(10_000, 200);
        positionManager = new MockHyperSwapV3PositionManager(address(factory), address(whype));

        token = new FWATokenHyperEVM(
            "Hyper World Assets",
            "HWA",
            SUPPLY,
            LP_SUPPLY,
            address(factory),
            address(positionManager),
            address(whype),
            OWNER
        );
        locker = new HWAProjectXLiquidityLocker(address(positionManager), address(token), FEE_RECIPIENT, OWNER);

        (address token0, address token1) =
            address(token) < address(whype) ? (address(token), address(whype)) : (address(whype), address(token));
        marketPool = new MockHyperSwapV3Pool(token0, token1, 10_000, 200);
        factory.setPool(address(token), address(whype), 10_000, address(marketPool));

        if (token0 == address(token)) {
            tickLower = 0;
            tickUpper = 400;
            sqrtPriceX96 = TickMath.getSqrtPriceAtTick(-400);
        } else {
            tickLower = -400;
            tickUpper = 0;
            sqrtPriceX96 = TickMath.getSqrtPriceAtTick(400);
        }
    }

    function _launch() internal {
        vm.prank(OWNER);
        token.launch(sqrtPriceX96, tickLower, tickUpper, address(locker));
    }

    function testFixedSupplyAndSingleSidedLaunch() public {
        assertEq(keccak256(bytes(token.name())), keccak256(bytes("Hyper World Assets")));
        assertEq(keccak256(bytes(token.symbol())), keccak256(bytes("HWA")));
        assertEq(token.totalSupply(), SUPPLY);
        assertEq(token.balanceOf(address(token)), LP_SUPPLY);
        assertEq(token.balanceOf(OWNER), SUPPLY - LP_SUPPLY);

        _launch();

        assertTrue(token.launched());
        assertEq(token.pool(), address(marketPool));
        assertEq(token.lpTokenId(), 1);
        assertEq(token.liquidityLocker(), address(locker));
        assertEq(positionManager.ownerOf(1), address(locker));
        assertTrue(locker.bound());
        assertEq(token.balanceOf(address(token)), 0);
        assertEq(token.balanceOf(address(marketPool)), LP_SUPPLY);
        assertTrue(token.buybackSqrtPriceLimitX96() != 0);

        (,,,,, uint256 amount0Desired, uint256 amount1Desired,,,,) = positionManager.lastMintParams();
        if (address(token) < address(whype)) {
            assertEq(amount0Desired, LP_SUPPLY);
            assertEq(amount1Desired, 0);
        } else {
            assertEq(amount0Desired, 0);
            assertEq(amount1Desired, LP_SUPPLY);
        }
    }

    function testPreOpenGuardAllowsProtocolBuysAndSellsButBlocksExternalBuys() public {
        _launch();

        vm.prank(address(marketPool));
        vm.expectRevert(FWATokenHyperEVM.InvalidTransfer.selector);
        token.transfer(USER, 1 ether);

        vm.prank(OWNER);
        token.setProtocolBuyer(USER, true);
        vm.prank(address(marketPool));
        token.transfer(USER, 1 ether);
        assertEq(token.balanceOf(USER), 1 ether);

        vm.prank(USER);
        token.transfer(address(marketPool), 0.5 ether);

        vm.prank(OWNER);
        token.transfer(USER, 2 ether);
        vm.prank(USER);
        vm.expectRevert(FWATokenHyperEVM.InvalidTransfer.selector);
        token.transfer(OTHER, 1 ether);

        vm.prank(OWNER);
        MockFWATokenAdapter marketAdapter =
            new MockFWATokenAdapter(address(token), address(whype), address(marketPool), 10_000);
        MockFWABuybackRouter rewardsRouter = new MockFWABuybackRouter();
        vm.startPrank(OWNER);
        token.setAdapter(address(marketAdapter));
        token.setRewardsPool(address(rewardsRouter));
        token.setExternalBuysEnabled(true);
        vm.stopPrank();
        vm.prank(address(marketPool));
        token.transfer(OTHER, 1 ether);
        assertEq(token.balanceOf(OTHER), 1 ether);
    }

    function testAdapterBindingChecksPoolAndBuybackRoutesFortyFortyTwenty() public {
        _launch();

        MockFWATokenAdapter marketAdapter =
            new MockFWATokenAdapter(address(token), address(whype), address(marketPool), 10_000);
        MockFWABuybackRouter rewardsRouter = new MockFWABuybackRouter();

        vm.startPrank(OWNER);
        token.setAdapter(address(marketAdapter));
        token.setRewardsPool(address(rewardsRouter));
        token.transfer(address(marketAdapter), 10 ether);
        vm.stopPrank();

        uint256 supplyBefore = token.totalSupply();
        vm.deal(address(token), 1 ether);
        vm.warp(block.timestamp + token.BUYBACK_TWAP_SECONDS() + 1);
        vm.roll(10);
        vm.prank(CALLER);
        uint256 amountOut = token.buyback();

        uint256 hypeSpent = 0.995 ether;
        uint256 expectedOut = hypeSpent * 2;
        uint256 expectedDep = expectedOut * 4_000 / 10_000;
        uint256 expectedPurchaser = expectedOut * 4_000 / 10_000;
        uint256 expectedBurn = expectedOut - expectedDep - expectedPurchaser;

        assertEq(amountOut, expectedOut);
        assertEq(CALLER.balance, 0.005 ether);
        assertEq(address(marketAdapter).balance, hypeSpent);
        assertEq(address(token).balance, 0);
        assertEq(rewardsRouter.depositorAmount(), expectedDep);
        assertEq(rewardsRouter.purchaserAmount(), expectedPurchaser);
        assertEq(token.balanceOf(address(rewardsRouter)), expectedDep + expectedPurchaser);
        assertEq(token.totalSupply(), supplyBefore - expectedBurn);
    }

    function testBuybackRebasesPriceLimitAfterMarketMovesPastLaunchBand() public {
        _launch();
        uint160 launchLimit = token.buybackSqrtPriceLimitX96();
        uint160 movedPrice;
        if (address(token) < address(whype)) {
            movedPrice = launchLimit + 1;
        } else {
            movedPrice = launchLimit - 1;
        }
        marketPool.setPriceMock(movedPrice, 0, 0);

        MockFWATokenAdapter marketAdapter =
            new MockFWATokenAdapter(address(token), address(whype), address(marketPool), 10_000);
        MockFWABuybackRouter rewardsRouter = new MockFWABuybackRouter();
        vm.startPrank(OWNER);
        token.setAdapter(address(marketAdapter));
        token.setRewardsPool(address(rewardsRouter));
        token.transfer(address(marketAdapter), 10 ether);
        vm.stopPrank();

        vm.deal(address(token), 1 ether);
        vm.warp(block.timestamp + token.BUYBACK_TWAP_SECONDS() + 1);
        vm.roll(10);
        uint160 rebasedLimit = token.buybackSqrtPriceLimitX96();
        if (address(token) < address(whype)) assertTrue(rebasedLimit > movedPrice);
        else assertTrue(rebasedLimit < movedPrice);

        vm.prank(CALLER);
        assertTrue(token.buyback() != 0);
        assertEq(address(token).balance, 0);
    }

    function testBuybackFailsClosedUntilTwapWindowExists() public {
        _launch();
        MockFWATokenAdapter marketAdapter =
            new MockFWATokenAdapter(address(token), address(whype), address(marketPool), 10_000);
        vm.prank(OWNER);
        token.setAdapter(address(marketAdapter));
        vm.deal(address(token), 1 ether);
        vm.roll(10);

        vm.prank(CALLER);
        vm.expectRevert(FWATokenHyperEVM.BuybackOracleNotReady.selector);
        token.buyback();
        assertEq(address(token).balance, 1 ether);
    }

    function testAdapterCanOnlyBeBoundOnce() public {
        _launch();
        MockFWATokenAdapter marketAdapter =
            new MockFWATokenAdapter(address(token), address(whype), address(marketPool), 10_000);

        vm.prank(OWNER);
        token.setAdapter(address(marketAdapter));

        vm.prank(OWNER);
        vm.expectRevert(FWATokenHyperEVM.AdapterAlreadySet.selector);
        token.setAdapter(address(marketAdapter));
    }

    function testLaunchRejectsRangeThatIsNotTokenOnly() public {
        vm.prank(OWNER);
        vm.expectRevert(FWATokenHyperEVM.InvalidRange.selector);
        token.launch(TickMath.getSqrtPriceAtTick(200), 0, 400, address(locker));
    }

    function testFactoryDeploysAndLaunchesAtomically() public {
        MockHyperSwapERC20 freshWhype = new MockHyperSwapERC20("Wrapped HYPE", "wHYPE");
        MockHyperSwapV3Factory freshFactory = new MockHyperSwapV3Factory();
        freshFactory.setFeeAmount(10_000, 200);
        MockHyperSwapV3PositionManager freshPositionManager =
            new MockHyperSwapV3PositionManager(address(freshFactory), address(freshWhype));
        FWATokenHyperEVMFactory launchFactory = new FWATokenHyperEVMFactory(
            "Hyper World Assets",
            "HWA",
            SUPPLY,
            LP_SUPPLY,
            address(freshFactory),
            address(freshPositionManager),
            address(freshWhype),
            OWNER,
            OWNER,
            FEE_RECIPIENT,
            TickMath.getSqrtPriceAtTick(0),
            400
        );
        FWATokenHyperEVM launchedToken = launchFactory.token();
        int24 lower = launchFactory.tickLower();
        int24 upper = launchFactory.tickUpper();

        assertTrue(launchedToken.launched());
        assertTrue(launchedToken.pool() != address(0));
        assertEq(launchedToken.owner(), OWNER);
        assertEq(launchedToken.balanceOf(OWNER), SUPPLY - LP_SUPPLY);
        assertEq(launchedToken.balanceOf(address(launchFactory)), 0);
        HWAProjectXLiquidityLocker launchedLocker = HWAProjectXLiquidityLocker(launchedToken.liquidityLocker());
        assertEq(freshPositionManager.ownerOf(launchedToken.lpTokenId()), address(launchedLocker));
        assertTrue(launchedLocker.bound());
        assertEq(launchedLocker.feeRecipient(), FEE_RECIPIENT);
        assertEq(uint256(uint24(upper - lower)), 400);
    }

    function testFactoryRoundsAboveAlignedTickWhenPriceIsNotExactBoundary() public {
        address highWhype = address(0xF000000000000000000000000000000000000001);
        MockHyperSwapERC20 codeSource = new MockHyperSwapERC20("Wrapped HYPE", "wHYPE");
        vm.etch(highWhype, address(codeSource).code);
        MockHyperSwapV3Factory freshFactory = new MockHyperSwapV3Factory();
        freshFactory.setFeeAmount(10_000, 200);
        MockHyperSwapV3PositionManager freshPositionManager =
            new MockHyperSwapV3PositionManager(address(freshFactory), highWhype);
        uint160 priceJustAboveTickZero = TickMath.getSqrtPriceAtTick(0) + 1;

        FWATokenHyperEVMFactory launchFactory = new FWATokenHyperEVMFactory(
            "Hyper World Assets",
            "HWA",
            SUPPLY,
            LP_SUPPLY,
            address(freshFactory),
            address(freshPositionManager),
            highWhype,
            OWNER,
            OWNER,
            FEE_RECIPIENT,
            priceJustAboveTickZero,
            400
        );

        assertTrue(address(launchFactory.token()) < highWhype);
        assertEq(uint256(uint24(launchFactory.tickLower())), 200);
        assertEq(uint256(uint24(launchFactory.tickUpper())), 600);
    }

    function testOpeningRequiresCompleteMarketWiring() public {
        _launch();
        vm.prank(OWNER);
        vm.expectRevert(FWATokenHyperEVM.MarketNotConfigured.selector);
        token.setExternalBuysEnabled(true);
    }

    function testLaunchAndTwapQuotesAreExposedForSeasonCap() public {
        _launch();
        assertTrue(token.launchHwaPerHypeX96() != 0);
        assertEq(token.twapHwaPerHypeX96(), 0);

        vm.warp(block.timestamp + token.BUYBACK_TWAP_SECONDS() + 1);
        assertTrue(token.twapHwaPerHypeX96() != 0);
    }

    function testCanonicalDistributorsCannotBeRevokedAfterBinding() public {
        _launch();
        MockFWATokenAdapter marketAdapter =
            new MockFWATokenAdapter(address(token), address(whype), address(marketPool), 10_000);
        MockFWABuybackRouter rewardsRouter = new MockFWABuybackRouter();
        vm.startPrank(OWNER);
        token.setAdapter(address(marketAdapter));
        token.setRewardsPool(address(rewardsRouter));

        vm.expectRevert(FWATokenHyperEVM.InvalidTransfer.selector);
        token.setDistributor(address(marketAdapter), false);
        vm.expectRevert(FWATokenHyperEVM.InvalidTransfer.selector);
        token.setDistributor(address(rewardsRouter), false);
        vm.stopPrank();

        assertTrue(token.isDistributor(address(marketAdapter)));
        assertTrue(token.isDistributor(address(rewardsRouter)));
    }

    function testLockerPositionCannotBeWithdrawnAndFeesRemainCollectable() public {
        _launch();
        assertEq(positionManager.ownerOf(1), address(locker));
        positionManager.setCollectAmounts(12, 34);
        vm.prank(USER);
        (uint256 amount0, uint256 amount1) = locker.collectFees();
        assertEq(amount0, 12);
        assertEq(amount1, 34);
        assertEq(positionManager.ownerOf(1), address(locker));
    }
}
