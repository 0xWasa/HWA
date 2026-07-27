// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {
    IHyperSwapV3Factory,
    IHyperSwapV3Router
} from "../src/hyperevm/interfaces/IHyperSwapV3.sol";
import {FWAHyperSwapAdapter} from "../src/hyperevm/FWAHyperSwapAdapter.sol";
import {FWARewardsHyperEVM} from "../src/hyperevm/FWARewardsHyperEVM.sol";
import {FWATokenHyperEVM} from "../src/hyperevm/FWATokenHyperEVM.sol";
import {FWATokenHyperEVMFactory} from "../src/hyperevm/FWATokenHyperEVMFactory.sol";
import {HWAProjectXLiquidityLocker} from "../src/hyperevm/HWAProjectXLiquidityLocker.sol";
import {TestBase} from "../test/utils/TestBase.sol";

contract HyperSwapDeploymentTest is TestBase {
    address internal constant FACTORY = 0x22B0768972bB7f1F5ea7a8740BB8f94b32483826;
    address internal constant ROUTER01 = 0xD81F56576B1FF2f3Ef18e9Cc71Adaa42516fD990;
    address internal constant ROUTER02 = 0x51c5958FFb3e326F8d7AA945948159f1FF27e14A;
    address internal constant QUOTER = 0x7FEd8993828A61A5985F384Cee8bDD42177Aa263;
    address internal constant NFPM = 0x09Aca834543b5790DB7a52803d5F9d48c5b87e80;
    address internal constant WHYPE = 0xADcb2f358Eae6492F61A5F87eb8893d09391d160;
    address internal constant USER = address(0xB0B);

    function testHyperSwapV3OfficialContractsExistOn998() public view {
        assertEq(block.chainid, 998);
        assertTrue(FACTORY.code.length != 0);
        assertTrue(ROUTER01.code.length != 0);
        assertTrue(ROUTER02.code.length != 0);
        assertTrue(QUOTER.code.length != 0);
        assertTrue(NFPM.code.length != 0);
        assertTrue(WHYPE.code.length != 0);
    }

    function testRouterWiringMatchesOfficialFactoryAndWHYPE() public view {
        IHyperSwapV3Router router = IHyperSwapV3Router(ROUTER01);
        assertEq(router.factory(), FACTORY);
        assertEq(router.WETH9(), WHYPE);
    }

    function testFactoryFeeTiersAndTickSpacings() public view {
        IHyperSwapV3Factory factory = IHyperSwapV3Factory(FACTORY);
        assertEq(uint256(uint24(factory.feeAmountTickSpacing(100))), 1);
        assertEq(uint256(uint24(factory.feeAmountTickSpacing(500))), 10);
        assertEq(uint256(uint24(factory.feeAmountTickSpacing(3_000))), 60);
        assertEq(uint256(uint24(factory.feeAmountTickSpacing(10_000))), 200);
        assertEq(uint256(uint24(factory.feeAmountTickSpacing(0))), 0);
    }

    function testAtomicLaunchAndProtocolBuyAgainstRealHyperSwap998() public {
        FWATokenHyperEVMFactory launchFactory = new FWATokenHyperEVMFactory(
            "Hyper World Assets Test",
            "tHWA",
            1_000_000 ether,
            500_000 ether,
            FACTORY,
            NFPM,
            WHYPE,
            address(this),
            address(this),
            address(this),
            uint160(1 << 96),
            4_000
        );
        FWATokenHyperEVM token = launchFactory.token();

        address pool = IHyperSwapV3Factory(FACTORY).getPool(WHYPE, address(token), 10_000);
        assertTrue(pool != address(0));
        assertEq(token.pool(), pool);
        assertEq(token.balanceOf(pool), 500_000 ether);
        HWAProjectXLiquidityLocker locker = HWAProjectXLiquidityLocker(token.liquidityLocker());
        assertTrue(locker.bound());
        assertEq(locker.tokenId(), token.lpTokenId());

        FWAHyperSwapAdapter adapter =
            new FWAHyperSwapAdapter(FACTORY, ROUTER01, WHYPE, address(token), 10_000, address(this));
        FWARewardsHyperEVM rewards = new FWARewardsHyperEVM(address(token), address(adapter), address(this));

        adapter.setRewardsBuyer(address(rewards));
        token.setAdapter(address(adapter));
        token.setRewardsPool(address(rewards));
        rewards.setFWA(address(this));

        vm.deal(address(this), 1 ether);
        uint256 tokenOut = rewards.buyFor{value: 0.01 ether}(USER, 0);

        assertTrue(tokenOut != 0);
        assertEq(token.balanceOf(USER), tokenOut);
        assertEq(address(adapter).balance, 0);
        assertEq(address(rewards).balance, 0);
    }
}
