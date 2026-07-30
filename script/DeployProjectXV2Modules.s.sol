// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {FWA} from "fwa-reference/src/FWA.sol";

import {FWAHyperSwapAdapter} from "../src/hyperevm/FWAHyperSwapAdapter.sol";
import {FWARewardsHyperEVM} from "../src/hyperevm/FWARewardsHyperEVM.sol";
import {FWATokenHyperEVM} from "../src/hyperevm/FWATokenHyperEVM.sol";
import {HWAEcosystemVesting} from "../src/hyperevm/HWAEcosystemVesting.sol";
import {HWAV2MigrationDistributor} from "../src/hyperevm/HWAV2MigrationDistributor.sol";
import {HWAProjectXLiquidityLocker} from "../src/hyperevm/HWAProjectXLiquidityLocker.sol";
import {SplitterHyperEVM} from "../src/hyperevm/SplitterHyperEVM.sol";
import {MainnetOwnerPolicy} from "./MainnetOwnerPolicy.sol";

interface VmProjectXV2ModulesDeploy {
    function envUint(string calldata name) external returns (uint256 value);
    function envAddress(string calldata name) external returns (address value);
    function envBool(string calldata name) external returns (bool value);
    function envOr(string calldata name, address defaultValue) external returns (address value);
    function addr(uint256 privateKey) external returns (address keyAddr);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

/// @notice Wires the fresh v2 core to the 100M seasonal reserve while keeping claims and public buys closed.
contract DeployProjectXV2Modules {
    VmProjectXV2ModulesDeploy internal constant vm =
        VmProjectXV2ModulesDeploy(address(uint160(uint256(keccak256("hevm cheat code")))));

    uint256 internal constant TESTNET = 998;
    uint256 internal constant MAINNET = 999;
    address internal constant PROJECTX_FACTORY = 0xFf7B3e8C00e57ea31477c32A5B52a58Eea47b072;
    address internal constant PROJECTX_ROUTER = 0x1EbDFC75FfE3ba3de61E7138a3E8706aC841Af9B;
    address internal constant MAINNET_WHYPE = 0x5555555555555555555555555555555555555555;
    address internal constant TESTNET_V3_FACTORY = 0x22B0768972bB7f1F5ea7a8740BB8f94b32483826;
    address internal constant TESTNET_V3_ROUTER = 0xD81F56576B1FF2f3Ef18e9Cc71Adaa42516fD990;
    address internal constant TESTNET_WHYPE = 0xADcb2f358Eae6492F61A5F87eb8893d09391d160;

    uint256 public constant DEPOSITOR_EMISSION = 150_000_000 ether;
    uint256 public constant PURCHASER_EMISSION = 150_000_000 ether;
    uint256 public constant ECOSYSTEM_ALLOCATION = 100_000_000 ether;

    event ProjectXV2ModulesPrepared(
        uint256 indexed chainId,
        address indexed finalOwner,
        address indexed fwa,
        address token,
        address rewards,
        address adapter,
        address migrationDistributor,
        address ecosystemVesting
    );

    error WrongChain(uint256 actual);
    error ConfirmationMissing();
    error InvalidConfig();
    error UnauthorizedDeployer();
    error TransferFailed();

    function run() external returns (FWARewardsHyperEVM rewards, FWAHyperSwapAdapter adapter) {
        if (block.chainid != TESTNET && block.chainid != MAINNET) revert WrongChain(block.chainid);
        if (
            !vm.envBool("HWA_V2_REWARDS_CONFIRMED")
                || (block.chainid == MAINNET && !vm.envBool("HWA_V2_MAINNET_MODULES_CONFIRMED"))
        ) revert ConfirmationMissing();

        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);
        address finalOwner = block.chainid == MAINNET ? vm.envAddress("FWA_OWNER") : vm.envOr("FWA_OWNER", deployer);
        FWA fwa = FWA(vm.envAddress("FWA_ADDRESS"));
        FWATokenHyperEVM token = FWATokenHyperEVM(payable(vm.envAddress("HWA_V2_TOKEN_ADDRESS")));
        HWAV2MigrationDistributor migration =
            HWAV2MigrationDistributor(vm.envAddress("HWA_V2_MIGRATION_DISTRIBUTOR_ADDRESS"));
        HWAEcosystemVesting vesting =
            HWAEcosystemVesting(vm.envAddress("HWA_V2_ECOSYSTEM_VESTING_ADDRESS"));
        HWAProjectXLiquidityLocker locker = HWAProjectXLiquidityLocker(token.liquidityLocker());
        SplitterHyperEVM splitter = SplitterHyperEVM(payable(vm.envAddress("FWA_SPLITTER_ADDRESS")));
        address expectedFactory = block.chainid == MAINNET ? PROJECTX_FACTORY : TESTNET_V3_FACTORY;
        address expectedRouter = block.chainid == MAINNET ? PROJECTX_ROUTER : TESTNET_V3_ROUTER;
        address expectedWhype = block.chainid == MAINNET ? MAINNET_WHYPE : TESTNET_WHYPE;

        if (block.chainid == MAINNET) {
            MainnetOwnerPolicy.validateDeploymentOwner(
                finalOwner, deployer, vm.envBool("MAINNET_EOA_OWNER_CONFIRMED")
            );
        }
        if (token.owner() != deployer || locker.owner() != deployer) revert UnauthorizedDeployer();
        if (
            token.totalSupply() != 1_000_000_000 ether || token.balanceOf(deployer) != 300_000_000 ether
                || !token.launched() || token.externalBuysEnabled() || token.POOL_FEE() != 10_000
                || token.POOL_TICK_SPACING() != 200 || address(token.FACTORY()) != expectedFactory
                || token.WHYPE() != expectedWhype || !locker.bound() || locker.tokenId() != token.lpTokenId()
                || migration.TOKEN() != address(token) || !migration.fullyFunded()
                || vesting.TOKEN() != address(token) || vesting.ALLOCATION() != ECOSYSTEM_ALLOCATION
                || token.balanceOf(address(vesting)) != ECOSYSTEM_ALLOCATION
                || !token.isDistributor(address(migration)) || !token.isDistributor(address(vesting))
        ) revert InvalidConfig();
        if (
            fwa.activeListingCount() != 0 || fwa.unsettledAcquisitionCount() != 0 || fwa.acquisitionsEnabled()
                || address(fwa.rewards()) != address(0) || fwa.payoutAddress() != address(splitter)
                || splitter.owner() != fwa.owner()
        ) revert InvalidConfig();

        vm.startBroadcast(deployerKey);
        adapter = new FWAHyperSwapAdapter(
            expectedFactory, expectedRouter, expectedWhype, address(token), token.POOL_FEE(), deployer
        );
        rewards = new FWARewardsHyperEVM(address(token), address(adapter), deployer);
        adapter.setRewardsBuyer(address(rewards));
        token.setAdapter(address(adapter));
        token.setRewardsPool(address(rewards));
        rewards.setFWA(address(fwa));
        rewards.setEmission(DEPOSITOR_EMISSION, PURCHASER_EMISSION);
        if (!token.transfer(address(rewards), DEPOSITOR_EMISSION + PURCHASER_EMISSION)) revert TransferFailed();

        if (finalOwner != deployer) {
            adapter.transferOwnership(finalOwner);
            rewards.transferOwnership(finalOwner);
            locker.transferOwnership(finalOwner);
            token.transferOwnership(finalOwner);
        }
        vm.stopBroadcast();

        if (
            token.balanceOf(address(rewards)) != 300_000_000 ether || token.balanceOf(deployer) != 0
                || rewards.emissionStart() != 0 || token.externalBuysEnabled()
        ) revert InvalidConfig();

        emit ProjectXV2ModulesPrepared(
            block.chainid,
            finalOwner,
            address(fwa),
            address(token),
            address(rewards),
            address(adapter),
            address(migration),
            address(vesting)
        );
    }
}