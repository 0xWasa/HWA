// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {DeployProjectXToken} from "../script/DeployProjectXToken.s.sol";
import {TestBase} from "./utils/TestBase.sol";

/// @notice Regression test for the mainnet launch-price guards on the ACTIVE Project X path.
///
/// @dev `.env.mainnet.example` instructs the operator to "fill all four fields from the signed
///      launch-price worksheet" and ships `PROJECTX_MARKET_PRICE_CONFIRMED` /
///      `PROJECTX_LP_LOCK_CONFIRMED`. Before this fix none of those were read by the Project X
///      launch script — the echo and FDV guards existed only in the legacy Nest script, under
///      different variable names (`MAINNET_FWA_INITIAL_SQRT_PRICE_X96_ECHO`,
///      `NEST_MARKET_PRICE_CONFIRMED`). The launch is atomic and irreversible, so a mistyped
///      `FWA_INITIAL_SQRT_PRICE_X96` would have created a permanently mispriced market.
///
///      Every case lives in ONE test function on purpose: `setEnv` mutates the process
///      environment, which is outside the EVM snapshot and shared across concurrently executing
///      test functions, so splitting these into separate tests makes them race.
///
///      The FDV band is necessarily verified after the factory deploys the token (the
///      token/wHYPE ordering is unknown until then) and is therefore covered by the fork
///      simulation rather than here.
contract DeployProjectXTokenGuardsTest is TestBase {
    uint256 internal constant MAINNET = 999;
    string internal constant PRICE = "79228162514264337593543950336";

    function testMainnetLaunchPriceGuardsRejectEveryUnconfirmedPath() public {
        DeployProjectXToken deployScript = new DeployProjectXToken();
        vm.chainId(MAINNET);

        // The price confirmation advertised by the env template must actually gate the launch.
        _seedValidMainnetEnv();
        vm.setEnv("PROJECTX_MARKET_PRICE_CONFIRMED", "false");
        vm.expectRevert(DeployProjectXToken.PriceNotConfirmed.selector);
        deployScript.run();

        // Same for the LP-lock confirmation.
        _seedValidMainnetEnv();
        vm.setEnv("PROJECTX_LP_LOCK_CONFIRMED", "false");
        vm.expectRevert(DeployProjectXToken.LpLockNotConfirmed.selector);
        deployScript.run();

        // A single mistyped digit in the hand-transcribed price must not reach the pool.
        _seedValidMainnetEnv();
        vm.setEnv("FWA_INITIAL_SQRT_PRICE_X96_ECHO", "79228162514264337593543950337");
        vm.expectRevert(DeployProjectXToken.InvalidPrice.selector);
        deployScript.run();

        // An unfilled echo field is a mismatch, not a bypass.
        _seedValidMainnetEnv();
        vm.setEnv("FWA_INITIAL_SQRT_PRICE_X96_ECHO", "0");
        vm.expectRevert(DeployProjectXToken.InvalidPrice.selector);
        deployScript.run();
    }

    function _seedValidMainnetEnv() internal {
        vm.setEnv("FWA_TOKENOMICS_CONFIRMED", "true");
        vm.setEnv("PROJECTX_MAINNET_DEPLOYMENT_CONFIRMED", "true");
        vm.setEnv("PROJECTX_MARKET_PRICE_CONFIRMED", "true");
        vm.setEnv("PROJECTX_LP_LOCK_CONFIRMED", "true");
        vm.setEnv("PRIVATE_KEY", "1");
        vm.setEnv("FWA_PROJECTX_FEE_RECIPIENT", "0x000000000000000000000000000000000000dEaD");
        vm.setEnv("FWA_INITIAL_SQRT_PRICE_X96", PRICE);
        vm.setEnv("FWA_INITIAL_SQRT_PRICE_X96_ECHO", PRICE);
        vm.setEnv("FWA_LP_RANGE_WIDTH_TICKS", "4000");
        vm.setEnv("MAINNET_FWA_MIN_INITIAL_FDV_HYPE_WEI", "1");
        vm.setEnv("MAINNET_FWA_MAX_INITIAL_FDV_HYPE_WEI", "1000000000000000000000000000000000000");
    }
}
