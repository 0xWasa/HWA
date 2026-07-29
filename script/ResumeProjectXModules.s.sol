// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {FWA} from "fwa-reference/src/FWA.sol";
import {FWAHyperSwapAdapter} from "../src/hyperevm/FWAHyperSwapAdapter.sol";
import {FWARewardsHyperEVM} from "../src/hyperevm/FWARewardsHyperEVM.sol";
import {FWATokenHyperEVM} from "../src/hyperevm/FWATokenHyperEVM.sol";
import {HWAEcosystemVesting} from "../src/hyperevm/HWAEcosystemVesting.sol";

interface VmProjectXModulesResume {
    function envUint(string calldata name) external returns (uint256 value);
    function envAddress(string calldata name) external returns (address value);
    function envBool(string calldata name) external returns (bool value);
    function addr(uint256 privateKey) external returns (address keyAddr);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

/// @notice Idempotently funds already-wired V2 rewards and vesting contracts.
contract ResumeProjectXModules {
    VmProjectXModulesResume internal constant vm =
        VmProjectXModulesResume(address(uint160(uint256(keccak256("hevm cheat code")))));
    uint256 internal constant TESTNET = 998;
    uint256 internal constant MAINNET = 999;
    uint256 internal constant REWARDS_ALLOCATION = 100_000_000 ether;
    uint256 internal constant ECOSYSTEM_ALLOCATION = 100_000_000 ether;

    event ProjectXModulesResumed(
        address indexed token, address indexed rewards, address indexed vesting, uint256 funded
    );
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
        uint256 key = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(key);
        FWA fwa = FWA(vm.envAddress("FWA_ADDRESS"));
        FWATokenHyperEVM token = FWATokenHyperEVM(payable(vm.envAddress("FWA_TOKEN_ADDRESS")));
        FWARewardsHyperEVM rewards = FWARewardsHyperEVM(vm.envAddress("FWA_REWARDS_ADDRESS"));
        FWAHyperSwapAdapter adapter = FWAHyperSwapAdapter(payable(vm.envAddress("FWA_PROJECTX_ADAPTER_ADDRESS")));
        HWAEcosystemVesting vesting = HWAEcosystemVesting(vm.envAddress("HWA_ECOSYSTEM_VESTING_ADDRESS"));
        if (token.owner() != deployer || rewards.owner() != deployer || adapter.owner() != deployer) {
            revert UnauthorizedDeployer();
        }
        if (
            token.adapter() != address(adapter) || token.rewardsPool() != address(rewards)
                || adapter.rewardsBuyer() != address(rewards) || rewards.token() != address(token)
                || address(rewards.swapAdapter()) != address(adapter) || rewards.fwa() != address(fwa)
                || address(fwa.rewards()) != address(0) || vesting.TOKEN() != address(token)
                || vesting.ALLOCATION() != ECOSYSTEM_ALLOCATION || token.externalBuysEnabled()
                || rewards.emissionStart() != 0 || rewards.claimsEnabled()
        ) revert InvalidWiring();
        uint256 rewardBalance = token.balanceOf(address(rewards));
        uint256 vestingBalance = token.balanceOf(address(vesting));
        if (
            rewardBalance == REWARDS_ALLOCATION && vestingBalance == ECOSYSTEM_ALLOCATION
                && token.balanceOf(deployer) == 0
        ) {
            emit ProjectXModulesResumed(address(token), address(rewards), address(vesting), 0);
            return;
        }
        if (rewardBalance != 0 || vestingBalance != 0 || token.balanceOf(deployer) != 200_000_000 ether) {
            revert InvalidBalance();
        }
        vm.startBroadcast(key);
        if (!token.transfer(address(rewards), REWARDS_ALLOCATION)) revert TransferFailed();
        if (!token.transfer(address(vesting), ECOSYSTEM_ALLOCATION)) revert TransferFailed();
        vm.stopBroadcast();
        if (token.balanceOf(deployer) != 0) revert InvalidBalance();
        emit ProjectXModulesResumed(address(token), address(rewards), address(vesting), 200_000_000 ether);
    }
}
