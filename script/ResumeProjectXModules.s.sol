// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {FWA} from "fwa-reference/src/FWA.sol";

import {FWAHyperSwapAdapter} from "../src/hyperevm/FWAHyperSwapAdapter.sol";
import {FWARewardsHyperEVM} from "../src/hyperevm/FWARewardsHyperEVM.sol";
import {FWATokenHyperEVM} from "../src/hyperevm/FWATokenHyperEVM.sol";

interface VmProjectXModulesResume {
    function envUint(string calldata name) external returns (uint256 value);
    function envAddress(string calldata name) external returns (address value);
    function envBool(string calldata name) external returns (bool value);
    function addr(uint256 privateKey) external returns (address keyAddr);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

/// @notice Idempotently completes a Project X module deployment interrupted after wiring.
/// @dev It can only fund the pre-wired rewards contract with the exact remaining allocation.
contract ResumeProjectXModules {
    VmProjectXModulesResume internal constant vm =
        VmProjectXModulesResume(address(uint160(uint256(keccak256("hevm cheat code")))));

    uint256 internal constant TESTNET = 998;
    uint256 internal constant MAINNET = 999;
    uint256 internal constant REWARDS_ALLOCATION = 300_000_000 ether;
    uint256 internal constant LEGACY_ALLOCATION = 200_000_000 ether;

    event ProjectXModulesResumed(address indexed token, address indexed rewards, uint256 fundedAmount);

    error WrongChain(uint256 actual);
    error ResumeNotConfirmed();
    error MainnetNotConfirmed();
    error UnauthorizedDeployer();
    error InvalidWiring();
    error InvalidBalance();
    error TransferFailed();

    function run() external {
        if (block.chainid != TESTNET && block.chainid != MAINNET) revert WrongChain(block.chainid);
        if (!vm.envBool("PROJECTX_MODULES_RESUME_CONFIRMED")) revert ResumeNotConfirmed();
        if (block.chainid == MAINNET && !vm.envBool("PROJECTX_MAINNET_DEPLOYMENT_CONFIRMED")) {
            revert MainnetNotConfirmed();
        }

        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);
        FWA fwa = FWA(vm.envAddress("FWA_ADDRESS"));
        FWATokenHyperEVM token = FWATokenHyperEVM(payable(vm.envAddress("FWA_TOKEN_ADDRESS")));
        FWARewardsHyperEVM rewards = FWARewardsHyperEVM(vm.envAddress("FWA_REWARDS_ADDRESS"));
        FWAHyperSwapAdapter adapter = FWAHyperSwapAdapter(payable(vm.envAddress("FWA_PROJECTX_ADAPTER_ADDRESS")));

        if (token.owner() != deployer || rewards.owner() != deployer || adapter.owner() != deployer) {
            revert UnauthorizedDeployer();
        }
        if (
            token.adapter() != address(adapter) || token.rewardsPool() != address(rewards)
                || adapter.rewardsBuyer() != address(rewards) || rewards.token() != address(token)
                || address(rewards.swapAdapter()) != address(adapter) || rewards.fwa() != address(fwa)
                || address(fwa.rewards()) != address(0)
        ) revert InvalidWiring();

        uint256 rewardsBalance = token.balanceOf(address(rewards));
        uint256 deployerBalance = token.balanceOf(deployer);
        if (rewardsBalance == REWARDS_ALLOCATION && deployerBalance == LEGACY_ALLOCATION) {
            emit ProjectXModulesResumed(address(token), address(rewards), 0);
            return;
        }
        if (rewardsBalance != 0 || deployerBalance != REWARDS_ALLOCATION + LEGACY_ALLOCATION) {
            revert InvalidBalance();
        }

        vm.startBroadcast(deployerKey);
        if (!token.transfer(address(rewards), REWARDS_ALLOCATION)) revert TransferFailed();
        vm.stopBroadcast();

        if (token.balanceOf(address(rewards)) != REWARDS_ALLOCATION || token.balanceOf(deployer) != LEGACY_ALLOCATION) {
            revert InvalidBalance();
        }
        emit ProjectXModulesResumed(address(token), address(rewards), REWARDS_ALLOCATION);
    }
}
