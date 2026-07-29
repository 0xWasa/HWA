// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {FWA} from "fwa-reference/src/FWA.sol";

import {FWAHyperSwapAdapter} from "../src/hyperevm/FWAHyperSwapAdapter.sol";
import {FWARewardsHyperEVM} from "../src/hyperevm/FWARewardsHyperEVM.sol";
import {FWATokenHyperEVM} from "../src/hyperevm/FWATokenHyperEVM.sol";
import {HWAEcosystemVesting} from "../src/hyperevm/HWAEcosystemVesting.sol";
import {HWAProjectXLiquidityLocker} from "../src/hyperevm/HWAProjectXLiquidityLocker.sol";
import {SplitterHyperEVM} from "../src/hyperevm/SplitterHyperEVM.sol";
import {MainnetOwnerPolicy} from "./MainnetOwnerPolicy.sol";

interface VmProjectXModulesDeploy {
    function envUint(string calldata name) external returns (uint256 value);
    function envAddress(string calldata name) external returns (address value);
    function envBool(string calldata name) external returns (bool value);
    function envOr(string calldata name, address defaultValue) external returns (address value);
    function addr(uint256 privateKey) external returns (address keyAddr);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

/// @notice Wires Project X protocol buys and HWA rewards without opening any public operation.
contract DeployProjectXModules {
    VmProjectXModulesDeploy internal constant vm =
        VmProjectXModulesDeploy(address(uint160(uint256(keccak256("hevm cheat code")))));

    uint256 internal constant TESTNET = 998;
    uint256 internal constant MAINNET = 999;
    address internal constant PROJECTX_FACTORY = 0xFf7B3e8C00e57ea31477c32A5B52a58Eea47b072;
    address internal constant PROJECTX_ROUTER = 0x1EbDFC75FfE3ba3de61E7138a3E8706aC841Af9B;
    address internal constant MAINNET_WHYPE = 0x5555555555555555555555555555555555555555;
    address internal constant TESTNET_V3_FACTORY = 0x22B0768972bB7f1F5ea7a8740BB8f94b32483826;
    address internal constant TESTNET_V3_ROUTER = 0xD81F56576B1FF2f3Ef18e9Cc71Adaa42516fD990;
    address internal constant TESTNET_WHYPE = 0xADcb2f358Eae6492F61A5F87eb8893d09391d160;

    uint256 internal constant DEPOSITOR_EMISSION = 50_000_000 ether;
    uint256 internal constant PURCHASER_EMISSION = 50_000_000 ether;
    uint256 internal constant ECOSYSTEM_ALLOCATION = 100_000_000 ether;

    event ProjectXModulesPrepared(
        uint256 indexed chainId,
        address indexed finalOwner,
        address indexed fwa,
        address token,
        address rewards,
        address adapter,
        address pool,
        address liquidityLocker,
        address ecosystemVesting,
        address ecosystemBeneficiary
    );

    error WrongChain(uint256 actual);
    error TokenomicsNotConfirmed();
    error MainnetNotConfirmed();
    error InvalidAddress();
    error CoreNotReady();
    error UnauthorizedDeployer();
    error AllocationMismatch();
    error TransferFailed();

    function run()
        external
        returns (FWARewardsHyperEVM rewards, FWAHyperSwapAdapter adapter, HWAEcosystemVesting vesting)
    {
        if (block.chainid != TESTNET && block.chainid != MAINNET) revert WrongChain(block.chainid);
        if (!vm.envBool("FWA_TOKENOMICS_CONFIRMED")) revert TokenomicsNotConfirmed();
        if (block.chainid == MAINNET && !vm.envBool("PROJECTX_MAINNET_DEPLOYMENT_CONFIRMED")) {
            revert MainnetNotConfirmed();
        }

        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);
        address finalOwner = block.chainid == MAINNET ? vm.envAddress("FWA_OWNER") : vm.envOr("FWA_OWNER", deployer);
        address ecosystemBeneficiary = vm.envOr("HWA_ECOSYSTEM_BENEFICIARY", finalOwner);
        FWA fwa = FWA(vm.envAddress("FWA_ADDRESS"));
        FWATokenHyperEVM token = FWATokenHyperEVM(payable(vm.envAddress("FWA_TOKEN_ADDRESS")));
        HWAProjectXLiquidityLocker locker = HWAProjectXLiquidityLocker(token.liquidityLocker());
        SplitterHyperEVM splitter = SplitterHyperEVM(payable(vm.envAddress("FWA_SPLITTER_ADDRESS")));
        address expectedFactory = block.chainid == MAINNET ? PROJECTX_FACTORY : TESTNET_V3_FACTORY;
        address expectedRouter = block.chainid == MAINNET ? PROJECTX_ROUTER : TESTNET_V3_ROUTER;
        address expectedWhype = block.chainid == MAINNET ? MAINNET_WHYPE : TESTNET_WHYPE;

        if (finalOwner == address(0) || ecosystemBeneficiary == address(0)) revert InvalidAddress();
        if (block.chainid == MAINNET) {
            MainnetOwnerPolicy.validateDeploymentOwner(finalOwner, deployer, vm.envBool("MAINNET_EOA_OWNER_CONFIRMED"));
        }
        if (token.owner() != deployer || locker.owner() != deployer) revert UnauthorizedDeployer();
        if (
            !token.launched() || token.totalSupply() != 1_000_000_000 ether
                || token.balanceOf(deployer) != 200_000_000 ether || token.POOL_FEE() != 10_000
                || token.POOL_TICK_SPACING() != 200 || address(token.FACTORY()) != expectedFactory
                || token.WHYPE() != expectedWhype || !locker.bound() || locker.tokenId() != token.lpTokenId()
                || token.externalBuysEnabled()
        ) revert AllocationMismatch();
        if (
            fwa.activeListingCount() != 0 || fwa.unsettledAcquisitionCount() != 0 || fwa.acquisitionsEnabled()
                || address(fwa.rewards()) != address(0) || fwa.payoutAddress() != address(splitter)
                || splitter.owner() != fwa.owner()
        ) revert CoreNotReady();

        vm.startBroadcast(deployerKey);
        adapter = new FWAHyperSwapAdapter(
            expectedFactory, expectedRouter, expectedWhype, address(token), token.POOL_FEE(), deployer
        );
        rewards = new FWARewardsHyperEVM(address(token), address(adapter), deployer);
        vesting = new HWAEcosystemVesting(
            address(token), ecosystemBeneficiary, uint64(block.timestamp), ECOSYSTEM_ALLOCATION
        );
        adapter.setRewardsBuyer(address(rewards));
        token.setAdapter(address(adapter));
        token.setRewardsPool(address(rewards));
        rewards.setFWA(address(fwa));
        rewards.setEmission(DEPOSITOR_EMISSION, PURCHASER_EMISSION);

        if (!token.transfer(address(rewards), DEPOSITOR_EMISSION + PURCHASER_EMISSION)) revert TransferFailed();
        if (!token.transfer(address(vesting), ECOSYSTEM_ALLOCATION)) revert TransferFailed();
        if (token.balanceOf(deployer) != 0) revert AllocationMismatch();

        if (finalOwner != deployer) {
            adapter.transferOwnership(finalOwner);
            rewards.transferOwnership(finalOwner);
            locker.transferOwnership(finalOwner);
            token.transferOwnership(finalOwner);
        }
        vm.stopBroadcast();

        if (
            token.externalBuysEnabled() || rewards.emissionStart() != 0 || rewards.claimsEnabled()
                || token.balanceOf(address(rewards)) != 100_000_000 ether
                || token.balanceOf(address(vesting)) != ECOSYSTEM_ALLOCATION
        ) revert AllocationMismatch();

        emit ProjectXModulesPrepared(
            block.chainid,
            finalOwner,
            address(fwa),
            address(token),
            address(rewards),
            address(adapter),
            token.pool(),
            address(locker),
            address(vesting),
            ecosystemBeneficiary
        );
    }
}
