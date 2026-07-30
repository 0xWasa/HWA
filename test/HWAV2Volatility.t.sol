// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {TestBase} from "./utils/TestBase.sol";

/// @notice Documents the full-range constant-product approximation used for the $20k launch decision.
contract HWAV2VolatilityTest is TestBase {
    uint256 internal constant WAD = 1e18;
    uint256 internal constant INITIAL_FDV_USD = 20_000 ether;
    uint256 internal constant LP_SHARE_BPS = 1_250; // 125M / 1B
    uint256 internal constant PROJECT_X_FEE_BPS = 100;

    function testTwentyThousandDollarLaunchPressureTable() public pure {
        assertEq(_priceMultiplierAfterBuy(1_000 ether), 1_948_816_000_000_000_000); // +94.8816%
        assertEq(_priceMultiplierAfterBuy(5_000 ether), 8_880_400_000_000_000_000); // +788.04%
        assertEq(_priceMultiplierAfterBuy(10_000 ether), 24_601_600_000_000_000_000); // +2,360.16%
        assertEq(_priceMultiplierAfterBuy(40_000 ether), 283_585_600_000_000_000_000); // +28,258.56%
    }

    function testInitialLpMarkValueIsOnlyTwentyFiveHundredDollars() public pure {
        assertEq(INITIAL_FDV_USD * LP_SHARE_BPS / 10_000, 2_500 ether);
    }

    function _priceMultiplierAfterBuy(uint256 grossBuyUsd) private pure returns (uint256) {
        uint256 initialLpValue = INITIAL_FDV_USD * LP_SHARE_BPS / 10_000;
        uint256 netBuy = grossBuyUsd * (10_000 - PROJECT_X_FEE_BPS) / 10_000;
        uint256 ratio = WAD + netBuy * WAD / initialLpValue;
        return ratio * ratio / WAD;
    }
}