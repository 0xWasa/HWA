// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {ActivateHyperEVMMainnet} from "../script/ActivateHyperEVMMainnet.s.sol";

contract ActivateHyperEVMMainnetRiskGateHarness is ActivateHyperEVMMainnet {
    function drandOperationsAccepted(bool redundancyConfirmed, bool singleRelayerRiskAccepted)
        external
        pure
        returns (bool)
    {
        return _drandOperationsAccepted(redundancyConfirmed, singleRelayerRiskAccepted);
    }
}

contract ActivateHyperEVMMainnetRiskGateTest {
    ActivateHyperEVMMainnetRiskGateHarness internal harness;

    function setUp() external {
        harness = new ActivateHyperEVMMainnetRiskGateHarness();
    }

    function testRejectsWhenNeitherOperationalModeIsConfirmed() external view {
        require(!harness.drandOperationsAccepted(false, false), "empty drand gate accepted");
    }

    function testAcceptsIndependentRelayerRedundancy() external view {
        require(harness.drandOperationsAccepted(true, false), "redundancy rejected");
    }

    function testAcceptsExplicitSingleRelayerRisk() external view {
        require(harness.drandOperationsAccepted(false, true), "single-relayer acknowledgement rejected");
    }

    function testAcceptsRedundancyEvenIfLegacyRiskFlagRemainsSet() external view {
        require(harness.drandOperationsAccepted(true, true), "confirmed operations rejected");
    }
}
