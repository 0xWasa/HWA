// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {HWAEcosystemVesting} from "../src/hyperevm/HWAEcosystemVesting.sol";
import {MockHyperSwapERC20} from "./mocks/MockHyperSwapV3.sol";
import {TestBase} from "./utils/TestBase.sol";

contract HWAEcosystemVestingTest is TestBase {
    uint256 internal constant ALLOCATION = 100_000_000 ether;
    address internal constant BENEFICIARY = address(0xBEEF);

    MockHyperSwapERC20 internal token;
    HWAEcosystemVesting internal vesting;
    uint64 internal start;

    function setUp() public {
        token = new MockHyperSwapERC20("Hyper World Assets", "HWA");
        start = uint64(block.timestamp);
        vesting = new HWAEcosystemVesting(address(token), BENEFICIARY, start, ALLOCATION);
        token.mint(address(vesting), ALLOCATION);
    }

    function testNoReleaseBeforeCliff() public {
        vm.warp(uint256(start) + vesting.CLIFF() - 1);
        assertEq(vesting.vestedAmount(block.timestamp), 0);
        vm.expectRevert(HWAEcosystemVesting.NothingToRelease.selector);
        vesting.release();
    }

    function testLinearReleaseAfterCliffCannotAccelerate() public {
        vm.warp(uint256(start) + 365 days);
        uint256 expected = ALLOCATION * 365 days / vesting.DURATION();
        assertEq(vesting.releasable(), expected);
        assertEq(vesting.release(), expected);
        assertEq(token.balanceOf(BENEFICIARY), expected);
        assertEq(vesting.released(), expected);

        vm.expectRevert(HWAEcosystemVesting.NothingToRelease.selector);
        vesting.release();
    }

    function testFullAllocationOnlyAfterDuration() public {
        vm.warp(uint256(start) + vesting.DURATION());
        assertEq(vesting.release(), ALLOCATION);
        assertEq(token.balanceOf(BENEFICIARY), ALLOCATION);
        assertEq(token.balanceOf(address(vesting)), 0);
    }

    function testAnyoneMayReleaseButOnlyBeneficiaryReceives() public {
        vm.warp(uint256(start) + 180 days);
        vm.prank(address(0xCAFE));
        uint256 amount = vesting.release();
        assertTrue(amount > 0);
        assertEq(token.balanceOf(address(0xCAFE)), 0);
        assertEq(token.balanceOf(BENEFICIARY), amount);
    }

    function testConstructorRejectsInvalidConfiguration() public {
        vm.expectRevert(HWAEcosystemVesting.InvalidConfig.selector);
        new HWAEcosystemVesting(address(token), address(0), start, ALLOCATION);
        vm.expectRevert(HWAEcosystemVesting.InvalidConfig.selector);
        new HWAEcosystemVesting(address(token), BENEFICIARY, 0, ALLOCATION);
    }
}
