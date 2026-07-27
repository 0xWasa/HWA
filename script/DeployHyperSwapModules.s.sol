// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {FWA} from "fwa-reference/src/FWA.sol";

import {FWAHyperSwapAdapter} from "../src/hyperevm/FWAHyperSwapAdapter.sol";
import {FWARewardsHyperEVM} from "../src/hyperevm/FWARewardsHyperEVM.sol";
import {FWATokenHyperEVM} from "../src/hyperevm/FWATokenHyperEVM.sol";

interface VmHyperSwapDeploy {
    function envUint(string calldata name) external returns (uint256 value);
    function envAddress(string calldata name) external returns (address value);
    function envBool(string calldata name) external returns (bool value);
    function envOr(string calldata name, address defaultValue) external returns (address value);
    function addr(uint256 privateKey) external returns (address keyAddr);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

/// @notice Deploy and wire the HWA token/rewards market against official HyperSwap V3 testnet contracts.
/// @dev External buys remain disabled. Tokenomics and LP recipients require explicit environment gates.
contract DeployHyperSwapModules {
    VmHyperSwapDeploy internal constant vm = VmHyperSwapDeploy(address(uint160(uint256(keccak256("hevm cheat code")))));

    uint256 internal constant HYPEREVM_TESTNET_CHAIN_ID = 998;
    address internal constant HYPERSWAP_FACTORY = 0x22B0768972bB7f1F5ea7a8740BB8f94b32483826;
    address internal constant HYPERSWAP_ROUTER01 = 0xD81F56576B1FF2f3Ef18e9Cc71Adaa42516fD990;
    address internal constant WHYPE = 0xADcb2f358Eae6492F61A5F87eb8893d09391d160;

    uint256 internal constant DEPOSITOR_EMISSION = 150_000_000 ether;
    uint256 internal constant PURCHASER_EMISSION = 150_000_000 ether;
    uint256 internal constant LEGACY_ALLOCATION = 200_000_000 ether;

    event HyperSwapModulesDeployed(
        uint256 indexed chainId,
        address indexed finalOwner,
        address indexed fwa,
        address token,
        address rewards,
        address adapter,
        address pool,
        address legacyAllocationRecipient
    );

    error WrongChain(uint256 actual);
    error TokenomicsNotConfirmed();
    error InvalidAddress();
    error CoreNotReady();
    error UnauthorizedDeployer();
    error AllocationMismatch();
    error TransferFailed();

    function run() external returns (FWATokenHyperEVM token, FWARewardsHyperEVM rewards, FWAHyperSwapAdapter adapter) {
        if (block.chainid != HYPEREVM_TESTNET_CHAIN_ID) {
            revert WrongChain(block.chainid);
        }
        if (!vm.envBool("FWA_TOKENOMICS_CONFIRMED")) revert TokenomicsNotConfirmed();

        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);
        address finalOwner = vm.envOr("FWA_OWNER", deployer);
        address legacyRecipient = vm.envAddress("FWA_LEGACY_ALLOCATION_RECIPIENT");
        FWA fwa = FWA(vm.envAddress("FWA_ADDRESS"));
        token = FWATokenHyperEVM(payable(vm.envAddress("FWA_TOKEN_ADDRESS")));
        if (finalOwner == address(0) || legacyRecipient == address(0)) {
            revert InvalidAddress();
        }
        if (fwa.owner() != deployer) revert UnauthorizedDeployer();
        if (
            address(token).code.length == 0 || token.owner() != deployer || !token.launched()
                || token.totalSupply() != 1_000_000_000 ether || token.balanceOf(deployer) != 500_000_000 ether
                || token.WHYPE() != WHYPE || token.POOL_FEE() != 10_000
        ) revert AllocationMismatch();
        if (
            fwa.activeListingCount() != 0 || fwa.unsettledAcquisitionCount() != 0
                || address(fwa.rewards()) != address(0)
        ) revert CoreNotReady();

        vm.startBroadcast(deployerKey);

        adapter = new FWAHyperSwapAdapter(
            HYPERSWAP_FACTORY, HYPERSWAP_ROUTER01, WHYPE, address(token), token.POOL_FEE(), deployer
        );
        rewards = new FWARewardsHyperEVM(address(token), address(adapter), deployer);

        adapter.setRewardsBuyer(address(rewards));
        token.setAdapter(address(adapter));
        token.setRewardsPool(address(rewards));
        rewards.setFWA(address(fwa));
        rewards.setEmission(DEPOSITOR_EMISSION, PURCHASER_EMISSION);

        if (!token.transfer(address(rewards), DEPOSITOR_EMISSION + PURCHASER_EMISSION)) revert TransferFailed();
        if (token.balanceOf(deployer) != LEGACY_ALLOCATION) revert AllocationMismatch();
        if (legacyRecipient != deployer) {
            if (!token.transfer(legacyRecipient, LEGACY_ALLOCATION)) revert TransferFailed();
            if (token.balanceOf(deployer) != 0) revert AllocationMismatch();
        }

        fwa.setRewards(address(rewards));

        if (finalOwner != deployer) {
            adapter.transferOwnership(finalOwner);
            rewards.transferOwnership(finalOwner);
            token.transferOwnership(finalOwner);
        }

        vm.stopBroadcast();

        emit HyperSwapModulesDeployed(
            block.chainid,
            finalOwner,
            address(fwa),
            address(token),
            address(rewards),
            address(adapter),
            token.pool(),
            legacyRecipient
        );
    }
}
