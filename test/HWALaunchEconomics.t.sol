// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {FixedPointMathLib} from "solady/src/utils/FixedPointMathLib.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {TestBase} from "./utils/TestBase.sol";

contract HWALaunchEconomicsTest is TestBase {
    uint256 internal constant Q96 = 1 << 96;
    uint256 internal constant TOTAL_SUPPLY = 1_000_000_000 ether;
    uint256 internal constant MIN_FDV = 600 ether;
    uint256 internal constant TARGET_FDV = 640 ether;
    uint256 internal constant MAX_FDV = 700 ether;
    uint160 internal constant SQRT_HWA_TOKEN0 = 63_382_530_011_411_470_074_835_160;
    uint160 internal constant SQRT_HWA_TOKEN1 = 99_035_203_142_830_421_991_929_937_920_000;

    function testIndependentFdvDerivationMatchesBothTokenOrderings() public pure {
        uint256 price0X96 = FixedPointMathLib.fullMulDiv(SQRT_HWA_TOKEN0, SQRT_HWA_TOKEN0, Q96);
        uint256 price1X96 = FixedPointMathLib.fullMulDiv(SQRT_HWA_TOKEN1, SQRT_HWA_TOKEN1, Q96);
        uint256 fdv0 = FixedPointMathLib.fullMulDiv(TOTAL_SUPPLY, price0X96, Q96);
        uint256 fdv1 = FixedPointMathLib.fullMulDiv(TOTAL_SUPPLY, Q96, price1X96);

        assertEq(fdv0, TARGET_FDV - 1);
        assertEq(fdv1, TARGET_FDV);
        assertTrue(fdv0 >= MIN_FDV && fdv0 <= MAX_FDV);
        assertTrue(fdv1 >= MIN_FDV && fdv1 <= MAX_FDV);
    }

    function testTickMathConfirmsOneSidedLaunchRanges() public pure {
        int24 tick0 = TickMath.getTickAtSqrtPrice(SQRT_HWA_TOKEN0);
        int24 tick1 = TickMath.getTickAtSqrtPrice(SQRT_HWA_TOKEN1);
        assertEq(uint256(int256(tick0 + 142_626)), 0);
        assertEq(uint256(int256(tick1 - 142_625)), 0);

        int24 lower0 = -142_600;
        int24 upper0 = -139_000;
        int24 lower1 = 139_000;
        int24 upper1 = 142_600;
        assertTrue(SQRT_HWA_TOKEN0 < TickMath.getSqrtPriceAtTick(lower0));
        assertTrue(SQRT_HWA_TOKEN1 > TickMath.getSqrtPriceAtTick(upper1));
        assertEq(uint256(uint24(upper0 - lower0)), 3_600);
        assertEq(uint256(uint24(upper1 - lower1)), 3_600);
    }
}

