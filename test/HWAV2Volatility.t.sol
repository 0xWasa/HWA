// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {TestBase} from "./utils/TestBase.sol";

/// @notice Documents the FWA-parity full-range approximation used for the $40k launch decision.
contract HWAV2VolatilityTest is TestBase {
    uint256 internal constant WAD = 1e18;
    uint256 internal constant INITIAL_FDV_USD = 40_000 ether;
    uint256 internal constant LP_SHARE_BPS = 5_000; // 500M / 1B, exactly FWA
    uint256 internal constant PROJECT_X_FEE_BPS = 100;

    function testFortyThousandDollarFwaParityPressureTable() public pure {
        assertEq(_priceMultiplierAfterBuy(1_000 ether), 1_101_450_250_000_000_000); // +10.145025%
        assertEq(_priceMultiplierAfterBuy(5_000 ether), 1_556_256_250_000_000_000); // +55.625625%
        assertEq(_priceMultiplierAfterBuy(10_000 ether), 2_235_025_000_000_000_000); // +123.5025%
        assertEq(_priceMultiplierAfterBuy(40_000 ether), 8_880_400_000_000_000_000); // +788.04%
    }

    function testInitialLpMarkValueMatchesFwaHalfSupplyAllocation() public pure {
        assertEq(INITIAL_FDV_USD * LP_SHARE_BPS / 10_000, 20_000 ether);
    }

    function _priceMultiplierAfterBuy(uint256 grossBuyUsd) private pure returns (uint256) {
        uint256 initialLpValue = INITIAL_FDV_USD * LP_SHARE_BPS / 10_000;
        uint256 netBuy = grossBuyUsd * (10_000 - PROJECT_X_FEE_BPS) / 10_000;
        uint256 ratio = WAD + netBuy * WAD / initialLpValue;
        return ratio * ratio / WAD;
    }
}