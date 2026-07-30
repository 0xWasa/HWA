// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {MainnetOwnerPolicy} from "../script/MainnetOwnerPolicy.sol";
import {TestBase} from "./utils/TestBase.sol";

contract OwnerPolicyHarness {
    function validateDeployment(address owner, address deployer, bool accepted) external view {
        MainnetOwnerPolicy.validateDeploymentOwner(owner, deployer, accepted);
    }

    function validateConfigured(address actual, address configured, bool accepted) external view {
        MainnetOwnerPolicy.validateConfiguredOwner(actual, configured, accepted);
    }
}

contract MainnetOwnerPolicyTest is TestBase {
    OwnerPolicyHarness internal harness = new OwnerPolicyHarness();
    address internal constant DEPLOYER = address(0x2439);
    address internal constant OTHER = address(0xBEEF);

    function testExplicitDeployerEOAIsAccepted() public view {
        harness.validateDeployment(DEPLOYER, DEPLOYER, true);
        harness.validateConfigured(DEPLOYER, DEPLOYER, true);
    }

    function testEOARequiresExplicitAcceptance() public {
        vm.expectRevert(
            abi.encodeWithSelector(MainnetOwnerPolicy.InvalidMainnetOwner.selector, DEPLOYER, DEPLOYER, false)
        );
        harness.validateDeployment(DEPLOYER, DEPLOYER, false);
    }

    function testEOAMustEqualDeployer() public {
        vm.expectRevert(abi.encodeWithSelector(MainnetOwnerPolicy.InvalidMainnetOwner.selector, OTHER, DEPLOYER, true));
        harness.validateDeployment(OTHER, DEPLOYER, true);
    }

    function testConfiguredOwnerMustMatch() public {
        vm.expectRevert(abi.encodeWithSelector(MainnetOwnerPolicy.UnexpectedConfiguredOwner.selector, OTHER, DEPLOYER));
        harness.validateConfigured(OTHER, DEPLOYER, true);
    }

    function testContractOwnerRemainsSupported() public {
        address contractOwner = address(new OwnerPolicyHarness());
        harness.validateDeployment(contractOwner, DEPLOYER, false);
        harness.validateConfigured(contractOwner, contractOwner, false);
    }
}
