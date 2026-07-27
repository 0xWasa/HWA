// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {FWANestLiquidityLocker} from "../src/hyperevm/FWANestLiquidityLocker.sol";
import {FWANestPlugin} from "../src/hyperevm/FWANestPlugin.sol";
import {FWANestSwapAdapter} from "../src/hyperevm/FWANestSwapAdapter.sol";
import {FWATokenNest} from "../src/hyperevm/FWATokenNest.sol";
import {
    NestTestnetFactory,
    NestTestnetPool,
    NestTestnetPositionManager,
    NestTestnetSwapRouter
} from "../src/hyperevm/testnet/NestTestnetHarness.sol";
import {MockNestERC20} from "./mocks/MockNestAlgebra.sol";
import {TestBase} from "./utils/TestBase.sol";

contract NestTestnetHarnessTest is TestBase {
    MockNestERC20 internal whype;
    NestTestnetFactory internal factory;
    NestTestnetPositionManager internal positionManager;
    NestTestnetSwapRouter internal router;

    function setUp() public {
        whype = new MockNestERC20("Wrapped HYPE", "wHYPE");
        factory = new NestTestnetFactory(address(this));
        positionManager = new NestTestnetPositionManager(address(factory), address(whype));
        router = new NestTestnetSwapRouter(address(factory), address(whype));
        factory.setInfrastructure(address(positionManager), address(router));
    }

    function testHarnessRestrictsFactoryAndPoolAdministration() public {
        address token = address(new MockNestERC20("Token", "TKN"));

        vm.prank(address(0xBEEF));
        vm.expectRevert(NestTestnetFactory.Unauthorized.selector);
        factory.createPool(address(whype), token);

        address pool = factory.createPool(address(whype), token);
        vm.prank(address(0xBEEF));
        vm.expectRevert(NestTestnetPool.Unauthorized.selector);
        NestTestnetPool(pool).setFee(10_000);
    }

    function testFullNestFwaLifecycleAndProtocolBuy() public {
        FWATokenNest token = new FWATokenNest(
            "Hyper World Assets",
            "HWA",
            1_000_000_000 ether,
            500_000_000 ether,
            address(factory),
            address(positionManager),
            address(whype),
            address(this)
        );
        FWANestLiquidityLocker locker =
            new FWANestLiquidityLocker(address(positionManager), address(token), address(this), address(this));
        address poolAddress = factory.createPool(address(whype), address(token));
        NestTestnetPool pool = NestTestnetPool(poolAddress);
        FWANestPlugin plugin = new FWANestPlugin(poolAddress, address(token), address(whype));
        token.setMarketInfrastructure(address(plugin), address(locker));

        pool.setPlugin(address(plugin));
        pool.setPluginConfig(token.REQUIRED_PLUGIN_CONFIG());
        token.initializeMarket(uint160(1 << 96));

        pool.setFee(token.POOL_FEE());
        pool.setCommunityFee(token.REQUIRED_COMMUNITY_FEE());
        pool.setTickSpacing(token.POOL_TICK_SPACING());
        (int24 lower, int24 upper) =
            address(token) < address(whype) ? (int24(0), int24(3_600)) : (int24(-3_600), int24(0));
        token.finalizeLaunch(lower, upper);

        assertEq(keccak256(bytes(token.name())), keccak256(bytes("Hyper World Assets")));
        assertEq(keccak256(bytes(token.symbol())), keccak256(bytes("HWA")));
        assertTrue(token.launched());
        assertTrue(locker.bound());
        assertEq(positionManager.ownerOf(token.lpTokenId()), address(locker));
        assertEq(token.balanceOf(poolAddress), 500_000_000 ether);

        FWANestSwapAdapter adapter =
            new FWANestSwapAdapter(address(factory), address(router), address(whype), address(token), address(this));
        token.setAdapter(address(adapter));
        token.setBuybackMinOutPerHypeX96(1 << 96);
        vm.deal(address(token), 0.01 ether);
        vm.roll(block.number + 1);

        uint256 supplyBefore = token.totalSupply();
        uint256 bought = token.buyback();
        assertTrue(bought != 0);
        assertEq(token.totalSupply(), supplyBefore - bought);
        assertEq(address(adapter).balance, 0);
        assertFalse(token.externalBuysEnabled());
    }
}
