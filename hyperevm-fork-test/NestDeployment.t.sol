// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {
    INestAlgebraFactory,
    INestAlgebraPool,
    INestPositionManager,
    INestSwapRouter
} from "../src/hyperevm/interfaces/INestAlgebra.sol";
import {FWANestLiquidityLocker} from "../src/hyperevm/FWANestLiquidityLocker.sol";
import {FWANestPlugin} from "../src/hyperevm/FWANestPlugin.sol";
import {FWANestSwapAdapter} from "../src/hyperevm/FWANestSwapAdapter.sol";
import {FWATokenNest} from "../src/hyperevm/FWATokenNest.sol";
import {TestBase} from "../test/utils/TestBase.sol";

contract NestDeploymentTest is TestBase {
    address internal constant FACTORY = 0xF77Bd082c627aA54591cF2f2EaA811fd1AB3b1F3;
    address internal constant POOL_DEPLOYER = 0x3842CE04380B8655A3A47Ed87eA0D311ADCa161F;
    address internal constant ROUTER = 0xaA26B8e5Cadd04430c32787eCC3AA325e99681e9;
    address internal constant NFPM = 0xEAF58788a405F3253814b4559391a22bE8616250;
    address internal constant WHYPE = 0x5555555555555555555555555555555555555555;
    address internal constant USDC = 0xb88339CB7199b77E23DB6E890353E22632Ba630f;

    function testNestOfficialContractsExistOn999() public view {
        assertEq(block.chainid, 999);
        assertTrue(FACTORY.code.length != 0);
        assertTrue(POOL_DEPLOYER.code.length != 0);
        assertTrue(ROUTER.code.length != 0);
        assertTrue(NFPM.code.length != 0);
        assertTrue(WHYPE.code.length != 0);
    }

    function testNestRouterAndPositionManagerWiring() public view {
        assertEq(INestSwapRouter(ROUTER).factory(), FACTORY);
        assertEq(INestSwapRouter(ROUTER).WNativeToken(), WHYPE);
        assertEq(INestPositionManager(NFPM).factory(), FACTORY);
        assertEq(INestPositionManager(NFPM).WNativeToken(), WHYPE);
    }

    function testNestCurrentDefaultsRequireAdminConfigurationForFWA() public view {
        INestAlgebraFactory factory = INestAlgebraFactory(FACTORY);
        assertFalse(factory.isPublicPoolCreationMode());
        assertEq(uint256(uint24(factory.defaultTickspacing())), 60);
        assertEq(uint256(factory.defaultFee()), 500);
        assertEq(uint256(factory.defaultCommunityFee()), 1000);
    }

    function testKnownNestPoolMatchesAlgebraIntegralInterface() public view {
        address poolAddress = INestAlgebraFactory(FACTORY).poolByPair(WHYPE, USDC);
        assertTrue(poolAddress != address(0));
        INestAlgebraPool pool = INestAlgebraPool(poolAddress);
        assertEq(pool.factory(), FACTORY);
        assertTrue(
            (pool.token0() == WHYPE && pool.token1() == USDC) || (pool.token0() == USDC && pool.token1() == WHYPE)
        );
        // Nest administrators can change tick spacing per pool; this live core pool currently uses 5
        // while the factory default remains 60. FWA therefore attests its own pool value at launch.
        assertEq(uint256(uint24(pool.tickSpacing())), 5);
        assertTrue(pool.plugin() != address(0));
        (uint160 price,,,, uint16 communityFee, bool unlocked) = pool.globalState();
        assertTrue(price != 0);
        assertEq(uint256(communityFee), 1000);
        assertTrue(unlocked);
    }

    function testLaunchAndProtocolBuyAgainstRealNest999() public {
        INestAlgebraFactory factory = INestAlgebraFactory(FACTORY);
        FWATokenNest token = new FWATokenNest(
            "Hyper World Assets Fork Test",
            "tHWA",
            1_000_000 ether,
            500_000 ether,
            FACTORY,
            NFPM,
            WHYPE,
            address(this)
        );

        address nestAdministrator = factory.owner();
        vm.prank(nestAdministrator);
        address poolAddress = factory.createPool(WHYPE, address(token));
        INestAlgebraPool pool = INestAlgebraPool(poolAddress);

        FWANestPlugin plugin = new FWANestPlugin(poolAddress, address(token), WHYPE);
        FWANestLiquidityLocker locker =
            new FWANestLiquidityLocker(NFPM, address(token), address(this), address(this));
        token.setMarketInfrastructure(address(plugin), address(locker));

        vm.startPrank(nestAdministrator);
        pool.setPlugin(address(plugin));
        pool.setPluginConfig(token.REQUIRED_PLUGIN_CONFIG());
        vm.stopPrank();

        token.initializeMarket(uint160(1 << 96));
        (uint160 initializedPrice,,,, uint16 initializedCommunityFee,) = pool.globalState();
        assertEq(uint256(initializedPrice), uint256(uint160(1 << 96)));
        assertEq(uint256(initializedCommunityFee), 1000);

        vm.startPrank(nestAdministrator);
        pool.setFee(token.POOL_FEE());
        pool.setCommunityFee(token.REQUIRED_COMMUNITY_FEE());
        if (pool.tickSpacing() != token.POOL_TICK_SPACING()) {
            pool.setTickSpacing(token.POOL_TICK_SPACING());
        }
        vm.stopPrank();

        (int24 lower, int24 upper) = address(token) < WHYPE ? (int24(0), int24(3_600)) : (int24(-3_600), int24(0));
        token.finalizeLaunch(lower, upper);
        assertEq(token.pool(), poolAddress);
        assertEq(INestPositionManager(NFPM).ownerOf(token.lpTokenId()), address(locker));
        assertTrue(locker.bound());

        FWANestSwapAdapter adapter = new FWANestSwapAdapter(FACTORY, ROUTER, WHYPE, address(token), address(this));
        token.setAdapter(address(adapter));
        token.setBuybackMinOutPerHypeX96((uint256(9) * (uint256(1) << 96)) / 10);
        vm.deal(address(token), 0.01 ether);
        vm.roll(block.number + 1);
        uint256 supplyBefore = token.totalSupply();
        uint256 amountOut = token.buyback();

        assertTrue(amountOut != 0);
        assertEq(token.totalSupply(), supplyBefore - amountOut);
        assertEq(address(adapter).balance, 0);
        assertFalse(token.externalBuysEnabled());

        (uint256 fee0, uint256 fee1) = locker.collectFees();
        assertTrue(fee0 + fee1 != 0);
    }
}
