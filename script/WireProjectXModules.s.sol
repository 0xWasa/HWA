// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {FWA} from "fwa-reference/src/FWA.sol";

import {FWAHyperSwapAdapter} from "../src/hyperevm/FWAHyperSwapAdapter.sol";
import {FWARewardsHyperEVM} from "../src/hyperevm/FWARewardsHyperEVM.sol";
import {FWATokenHyperEVM} from "../src/hyperevm/FWATokenHyperEVM.sol";
import {HWAProjectXLiquidityLocker} from "../src/hyperevm/HWAProjectXLiquidityLocker.sol";

interface VmWireProjectXModules {
    function envUint(string calldata name) external returns (uint256 value);
    function envAddress(string calldata name) external returns (address value);
    function envBool(string calldata name) external returns (bool value);
    function envOr(string calldata name, address defaultValue) external returns (address value);
    function addr(uint256 privateKey) external returns (address keyAddr);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

/// @notice Safely completes the module wiring when adapter/rewards deployment was split into
///         separate transactions (for example across HyperEVM small/big block lanes).
contract WireProjectXModules {
    VmWireProjectXModules internal constant vm =
        VmWireProjectXModules(address(uint160(uint256(keccak256("hevm cheat code")))));

    uint256 internal constant TESTNET = 998;
    uint256 internal constant MAINNET = 999;
    uint256 internal constant DEPOSITOR_EMISSION = 150_000_000 ether;
    uint256 internal constant PURCHASER_EMISSION = 150_000_000 ether;
    uint256 internal constant LEGACY_ALLOCATION = 200_000_000 ether;

    event ProjectXModulesWired(
        address indexed fwa,
        address indexed rewards,
        address indexed adapter,
        address finalOwner,
        address legacyAllocationRecipient
    );

    error WrongChain(uint256 actual);
    error ResumeNotConfirmed();
    error MainnetNotConfirmed();
    error InvalidAddress();
    error InvalidContract();
    error UnauthorizedDeployer();
    error InvalidWiring();
    error AllocationMismatch();
    error TransferFailed();

    function run() external {
        if (block.chainid != TESTNET && block.chainid != MAINNET) revert WrongChain(block.chainid);
        if (!vm.envBool("PROJECTX_MODULES_RESUME_CONFIRMED")) revert ResumeNotConfirmed();
        if (block.chainid == MAINNET && !vm.envBool("PROJECTX_MAINNET_DEPLOYMENT_CONFIRMED")) {
            revert MainnetNotConfirmed();
        }

        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);
        address finalOwner = block.chainid == MAINNET ? vm.envAddress("FWA_OWNER") : vm.envOr("FWA_OWNER", deployer);
        address legacyRecipient = vm.envAddress("FWA_LEGACY_ALLOCATION_RECIPIENT");
        FWA fwa = FWA(vm.envAddress("FWA_ADDRESS"));
        FWATokenHyperEVM token = FWATokenHyperEVM(payable(vm.envAddress("FWA_TOKEN_ADDRESS")));
        FWAHyperSwapAdapter adapter = FWAHyperSwapAdapter(payable(vm.envAddress("FWA_PROJECTX_ADAPTER_ADDRESS")));
        FWARewardsHyperEVM rewards = FWARewardsHyperEVM(vm.envAddress("FWA_REWARDS_ADDRESS"));
        HWAProjectXLiquidityLocker locker = HWAProjectXLiquidityLocker(token.liquidityLocker());

        if (finalOwner == address(0) || legacyRecipient == address(0)) revert InvalidAddress();
        if (block.chainid == MAINNET && (finalOwner.code.length == 0 || legacyRecipient != finalOwner)) {
            revert InvalidContract();
        }
        if (
            token.owner() != deployer || locker.owner() != deployer || adapter.owner() != deployer
                || rewards.owner() != deployer
        ) revert UnauthorizedDeployer();
        if (
            address(fwa.rewards()) != address(0) || fwa.activeListingCount() != 0
                || fwa.unsettledAcquisitionCount() != 0 || token.adapter() != address(0)
                || token.rewardsPool() != address(0) || adapter.rewardsBuyer() != address(0)
                || address(adapter.TOKEN()) != address(token) || rewards.token() != address(token)
                || address(rewards.swapAdapter()) != address(adapter) || rewards.fwa() != address(0)
        ) revert InvalidWiring();
        if (token.balanceOf(deployer) != DEPOSITOR_EMISSION + PURCHASER_EMISSION + LEGACY_ALLOCATION) {
            revert AllocationMismatch();
        }

        vm.startBroadcast(deployerKey);
        adapter.setRewardsBuyer(address(rewards));
        token.setAdapter(address(adapter));
        token.setRewardsPool(address(rewards));
        rewards.setFWA(address(fwa));
        rewards.setEmission(DEPOSITOR_EMISSION, PURCHASER_EMISSION);
        if (!token.transfer(address(rewards), DEPOSITOR_EMISSION + PURCHASER_EMISSION)) revert TransferFailed();
        if (legacyRecipient != deployer) {
            if (!token.transfer(legacyRecipient, LEGACY_ALLOCATION)) revert TransferFailed();
        }
        if (finalOwner != deployer) {
            adapter.transferOwnership(finalOwner);
            rewards.transferOwnership(finalOwner);
            locker.transferOwnership(finalOwner);
            token.transferOwnership(finalOwner);
        }
        vm.stopBroadcast();

        if (
            token.adapter() != address(adapter) || token.rewardsPool() != address(rewards)
                || adapter.rewardsBuyer() != address(rewards) || rewards.fwa() != address(fwa)
                || token.balanceOf(address(rewards)) != DEPOSITOR_EMISSION + PURCHASER_EMISSION
                || token.balanceOf(legacyRecipient) < LEGACY_ALLOCATION || token.owner() != finalOwner
                || rewards.owner() != finalOwner || adapter.owner() != finalOwner || locker.owner() != finalOwner
        ) revert InvalidWiring();

        emit ProjectXModulesWired(address(fwa), address(rewards), address(adapter), finalOwner, legacyRecipient);
    }
}
