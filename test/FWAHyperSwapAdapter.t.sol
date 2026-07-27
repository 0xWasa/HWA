// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {FWAHyperSwapAdapter} from "../src/hyperevm/FWAHyperSwapAdapter.sol";
import {
    MockHypeSink,
    MockHyperSwapBuyer,
    MockHyperSwapERC20,
    MockHyperSwapV3Factory,
    MockHyperSwapV3Pool,
    MockHyperSwapV3Router
} from "./mocks/MockHyperSwapV3.sol";
import {TestBase} from "./utils/TestBase.sol";

contract FWAHyperSwapAdapterTest is TestBase {
    uint24 internal constant POOL_FEE = 10_000;
    int24 internal constant TICK_SPACING = 200;

    address internal constant OWNER = address(0xA11CE);
    address internal constant STRANGER = address(0xBAD);
    address internal constant RECOVERY = address(0xCAFE);

    MockHyperSwapERC20 internal token;
    MockHyperSwapERC20 internal whype;
    MockHyperSwapV3Factory internal factory;
    MockHyperSwapV3Pool internal pool;
    MockHypeSink internal sink;
    MockHyperSwapV3Router internal router;
    MockHyperSwapBuyer internal rewardsBuyer;
    FWAHyperSwapAdapter internal adapter;

    function setUp() public {
        token = new MockHyperSwapERC20("Hyper World Assets", "HWA");
        whype = new MockHyperSwapERC20("Wrapped HYPE", "wHYPE");
        factory = new MockHyperSwapV3Factory();
        sink = new MockHypeSink();
        router = new MockHyperSwapV3Router(address(factory), address(whype), token, payable(address(sink)));
        rewardsBuyer = new MockHyperSwapBuyer();

        (address token0, address token1) =
            address(whype) < address(token) ? (address(whype), address(token)) : (address(token), address(whype));
        pool = new MockHyperSwapV3Pool(token0, token1, POOL_FEE, TICK_SPACING);
        factory.setFeeAmount(POOL_FEE, TICK_SPACING);
        factory.setPool(address(whype), address(token), POOL_FEE, address(pool));

        adapter =
            new FWAHyperSwapAdapter(address(factory), address(router), address(whype), address(token), POOL_FEE, OWNER);
    }

    function testConstructorAttestsHyperSwapWiring() public view {
        assertEq(address(adapter.FACTORY()), address(factory));
        assertEq(address(adapter.ROUTER()), address(router));
        assertEq(address(adapter.TOKEN()), address(token));
        assertEq(adapter.WHYPE(), address(whype));
        assertEq(adapter.POOL(), address(pool));
        assertEq(uint256(adapter.POOL_FEE()), POOL_FEE);
        assertEq(uint256(uint24(adapter.TICK_SPACING())), uint256(uint24(TICK_SPACING)));
        assertEq(adapter.TOKEN_BUYER(), address(token));
        assertEq(adapter.owner(), OWNER);
    }

    function testTokenBuyIsFullExactInputAndCallerIsRecipient() public {
        vm.deal(address(token), 1 ether);
        uint256 amountOut = token.buy{value: 1 ether}(address(adapter), 2 ether, 12345);

        assertEq(amountOut, 2 ether);
        assertEq(token.balanceOf(address(token)), 2 ether);
        assertEq(address(sink).balance, 0);
        assertEq(whype.balanceOf(address(sink)), 1 ether);
        assertEq(address(adapter).balance, 0);
        assertEq(whype.balanceOf(address(adapter)), 0);

        (address tokenIn, address tokenOut, uint24 fee, address recipient,,, uint256 minOut, uint160 limit) =
            router.lastParams();
        assertEq(tokenIn, address(whype));
        assertEq(tokenOut, address(token));
        assertEq(uint256(fee), POOL_FEE);
        assertEq(recipient, address(token));
        assertEq(minOut, 2 ether);
        assertEq(uint256(limit), 12345);
    }

    function testOnlyConfiguredProtocolBuyerCanBuy() public {
        vm.deal(STRANGER, 1 ether);
        vm.prank(STRANGER);
        vm.expectRevert(FWAHyperSwapAdapter.OnlyProtocolBuyer.selector);
        adapter.buyExactInput{value: 1 ether}(0, 0);
    }

    function testOwnerBindsRewardsBuyerOnce() public {
        vm.prank(OWNER);
        adapter.setRewardsBuyer(address(rewardsBuyer));
        assertEq(adapter.rewardsBuyer(), address(rewardsBuyer));

        vm.deal(address(rewardsBuyer), 1 ether);
        uint256 amountOut = rewardsBuyer.buy{value: 1 ether}(address(adapter), 2 ether, 0);
        assertEq(amountOut, 2 ether);
        assertEq(token.balanceOf(address(rewardsBuyer)), 2 ether);

        vm.prank(OWNER);
        vm.expectRevert(FWAHyperSwapAdapter.RewardsBuyerAlreadySet.selector);
        adapter.setRewardsBuyer(address(token));
    }

    function testPartialFillRefundRevertsAtomically() public {
        router.setSwapResult(2, 0.1 ether, 0, 0);
        vm.deal(address(token), 1 ether);

        vm.expectRevert(FWAHyperSwapAdapter.PartialFill.selector);
        token.buy{value: 1 ether}(address(adapter), 0, 0);

        assertEq(token.balanceOf(address(token)), 0);
        assertEq(address(token).balance, 1 ether);
        assertEq(address(sink).balance, 0);
        assertEq(address(adapter).balance, 0);
    }

    function testRouterReportedOutputMustMatchBalanceDelta() public {
        router.setSwapResult(2, 0, 3 ether, 2 ether);
        vm.deal(address(token), 1 ether);

        vm.expectRevert(FWAHyperSwapAdapter.OutputMismatch.selector);
        token.buy{value: 1 ether}(address(adapter), 0, 0);

        assertEq(token.balanceOf(address(token)), 0);
        assertEq(address(token).balance, 1 ether);
    }

    function testAdapterEnforcesMinOutEvenIfRouterDoesNot() public {
        router.setSwapResult(1, 0, 1 ether, 1 ether);
        vm.deal(address(token), 1 ether);

        vm.expectRevert(FWAHyperSwapAdapter.SlippageBuy.selector);
        token.buy{value: 1 ether}(address(adapter), 2 ether, 0);

        assertEq(token.balanceOf(address(token)), 0);
    }

    function testZeroOutputReverts() public {
        router.setSwapResult(0, 0, 0, 0);
        vm.deal(address(token), 1 ether);

        vm.expectRevert(FWAHyperSwapAdapter.NoTokenOut.selector);
        token.buy{value: 1 ether}(address(adapter), 0, 0);
    }

    function testOnlyRouterMaySendHypeNormally() public {
        vm.deal(STRANGER, 1 ether);
        vm.prank(STRANGER);
        vm.expectRevert(FWAHyperSwapAdapter.DirectHypeRejected.selector);
        (bool ok,) = address(adapter).call{value: 1 ether}("");
        ok;
    }

    function testOwnerRecoversOnlyForcedHypeBalance() public {
        vm.deal(address(adapter), 1 ether);
        vm.prank(OWNER);
        uint256 recovered = adapter.recoverForcedHype(RECOVERY);
        assertEq(recovered, 1 ether);
        assertEq(RECOVERY.balance, 1 ether);
        assertEq(address(adapter).balance, 0);
    }

    function testConstructorRejectsMismatchedRouter() public {
        MockHyperSwapV3Factory otherFactory = new MockHyperSwapV3Factory();
        vm.expectRevert(FWAHyperSwapAdapter.InvalidRouter.selector);
        new FWAHyperSwapAdapter(address(otherFactory), address(router), address(whype), address(token), POOL_FEE, OWNER);
    }
}
