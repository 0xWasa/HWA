// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {FWA} from "fwa-reference/src/FWA.sol";

import {FWANestSwapAdapter} from "../src/hyperevm/FWANestSwapAdapter.sol";
import {FWARewardsHyperEVM} from "../src/hyperevm/FWARewardsHyperEVM.sol";
import {FWATokenNest} from "../src/hyperevm/FWATokenNest.sol";
import {SplitterHyperEVM} from "../src/hyperevm/SplitterHyperEVM.sol";

interface VmNestModulesDeploy {
    function envUint(string calldata name) external returns (uint256 value);
    function envAddress(string calldata name) external returns (address value);
    function envBool(string calldata name) external returns (bool value);
    function envOr(string calldata name, address defaultValue) external returns (address value);
    function addr(uint256 privateKey) external returns (address keyAddr);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

/// @notice Nest phase G: deploy rewards/adapter and wire the launched token side.
/// @dev FWA.setRewards is deliberately left to BindNestRewards so an existing core multisig can sign it.
contract DeployNestModules {
    VmNestModulesDeploy internal constant vm =
        VmNestModulesDeploy(address(uint160(uint256(keccak256("hevm cheat code")))));

    uint256 internal constant HYPEREVM_MAINNET_CHAIN_ID = 999;
    uint256 internal constant HYPEREVM_TESTNET_CHAIN_ID = 998;
    address internal constant NEST_MAINNET_ROUTER = 0xaA26B8e5Cadd04430c32787eCC3AA325e99681e9;

    uint256 internal constant DEPOSITOR_EMISSION = 150_000_000 ether;
    uint256 internal constant PURCHASER_EMISSION = 150_000_000 ether;
    uint256 internal constant LEGACY_ALLOCATION = 200_000_000 ether;

    event NestModulesDeployed(
        uint256 indexed chainId,
        address indexed finalOwner,
        address indexed fwa,
        address token,
        address rewards,
        address adapter,
        address pool,
        address liquidityLocker,
        address legacyAllocationRecipient
    );

    error TokenomicsNotConfirmed();
    error MainnetNotConfirmed();
    error InvalidAddress();
    error InvalidContract();
    error CoreNotReady();
    error UnauthorizedDeployer();
    error AllocationMismatch();
    error TransferFailed();
    error WrongChain(uint256 actual);

    function run() external returns (FWARewardsHyperEVM rewards, FWANestSwapAdapter adapter) {
        if (block.chainid != HYPEREVM_TESTNET_CHAIN_ID && block.chainid != HYPEREVM_MAINNET_CHAIN_ID) {
            revert WrongChain(block.chainid);
        }
        if (!vm.envBool("FWA_TOKENOMICS_CONFIRMED")) revert TokenomicsNotConfirmed();
        if (block.chainid == HYPEREVM_MAINNET_CHAIN_ID && !vm.envBool("NEST_MAINNET_DEPLOYMENT_CONFIRMED")) {
            revert MainnetNotConfirmed();
        }

        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);
        address finalOwner =
            block.chainid == HYPEREVM_MAINNET_CHAIN_ID ? vm.envAddress("FWA_OWNER") : vm.envOr("FWA_OWNER", deployer);
        address legacyRecipient = vm.envAddress("FWA_LEGACY_ALLOCATION_RECIPIENT");
        address defaultRouter = block.chainid == HYPEREVM_MAINNET_CHAIN_ID ? NEST_MAINNET_ROUTER : address(0);
        address router = vm.envOr("NEST_ROUTER", defaultRouter);
        FWA fwa = FWA(vm.envAddress("FWA_ADDRESS"));
        FWATokenNest token = FWATokenNest(payable(vm.envAddress("FWA_TOKEN_ADDRESS")));
        SplitterHyperEVM splitter = SplitterHyperEVM(payable(vm.envAddress("FWA_SPLITTER_ADDRESS")));

        if (finalOwner == address(0) || legacyRecipient == address(0) || router == address(0)) revert InvalidAddress();
        if (router.code.length == 0 || address(splitter).code.length == 0) revert InvalidContract();
        if (
            block.chainid == HYPEREVM_MAINNET_CHAIN_ID && (finalOwner.code.length == 0 || legacyRecipient != finalOwner)
        ) revert InvalidContract();
        if (token.owner() != deployer) revert UnauthorizedDeployer();
        if (
            !token.launched() || token.totalSupply() != 1_000_000_000 ether
                || token.balanceOf(deployer) != 500_000_000 ether || token.POOL_FEE() != 10_000
                || token.POOL_TICK_SPACING() != 60 || token.REQUIRED_COMMUNITY_FEE() != 0
        ) revert AllocationMismatch();
        if (
            fwa.activeListingCount() != 0 || fwa.unsettledAcquisitionCount() != 0
                || address(fwa.rewards()) != address(0) || fwa.payoutAddress() != address(splitter)
                || splitter.owner() != fwa.owner() || splitter.ownerShareBps() != 7_000
                || splitter.nftShareBps() != 3_000
        ) revert CoreNotReady();

        vm.startBroadcast(deployerKey);
        adapter = new FWANestSwapAdapter(address(token.FACTORY()), router, token.WHYPE(), address(token), deployer);
        rewards = new FWARewardsHyperEVM(address(token), address(adapter), deployer);

        adapter.setRewardsBuyer(address(rewards));
        token.setAdapter(address(adapter));
        token.setRewardsPool(address(rewards));
        token.setBuybackMinOutPerHypeX96(vm.envUint("FWA_BUYBACK_MIN_OUT_PER_HYPE_X96"));
        rewards.setFWA(address(fwa));
        rewards.setEmission(DEPOSITOR_EMISSION, PURCHASER_EMISSION);

        if (!token.transfer(address(rewards), DEPOSITOR_EMISSION + PURCHASER_EMISSION)) revert TransferFailed();
        if (token.balanceOf(deployer) != LEGACY_ALLOCATION) revert AllocationMismatch();
        if (legacyRecipient != deployer) {
            if (!token.transfer(legacyRecipient, LEGACY_ALLOCATION)) revert TransferFailed();
            if (token.balanceOf(deployer) != 0) revert AllocationMismatch();
        }

        if (finalOwner != deployer) {
            adapter.transferOwnership(finalOwner);
            rewards.transferOwnership(finalOwner);
            token.transferOwnership(finalOwner);
        }
        vm.stopBroadcast();

        emit NestModulesDeployed(
            block.chainid,
            finalOwner,
            address(fwa),
            address(token),
            address(rewards),
            address(adapter),
            token.pool(),
            token.liquidityLocker(),
            legacyRecipient
        );
    }
}
