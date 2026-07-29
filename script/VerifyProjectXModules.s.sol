// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {FWA} from "fwa-reference/src/FWA.sol";
import {
    IHyperSwapV3Factory,
    IHyperSwapV3Pool,
    IHyperSwapV3PositionManager
} from "../src/hyperevm/interfaces/IHyperSwapV3.sol";
import {FWAHyperSwapAdapter} from "../src/hyperevm/FWAHyperSwapAdapter.sol";
import {FWARewardsHyperEVM} from "../src/hyperevm/FWARewardsHyperEVM.sol";
import {FWATokenHyperEVM} from "../src/hyperevm/FWATokenHyperEVM.sol";
import {HWAEcosystemVesting} from "../src/hyperevm/HWAEcosystemVesting.sol";
import {HWAProjectXLiquidityLocker} from "../src/hyperevm/HWAProjectXLiquidityLocker.sol";
import {SplitterHyperEVM} from "../src/hyperevm/SplitterHyperEVM.sol";
import {MainnetOwnerPolicy} from "./MainnetOwnerPolicy.sol";

interface VmProjectXVerify {
    function envAddress(string calldata name) external returns (address value);
    function envBool(string calldata name) external returns (bool value);
}

/// @notice Read-only fail-closed release attestation for Project X modules.
contract VerifyProjectXModules {
    VmProjectXVerify internal constant vm = VmProjectXVerify(address(uint160(uint256(keccak256("hevm cheat code")))));
    uint256 internal constant TESTNET = 998;
    uint256 internal constant MAINNET = 999;
    address internal constant PROJECTX_FACTORY = 0xFf7B3e8C00e57ea31477c32A5B52a58Eea47b072;
    address internal constant PROJECTX_ROUTER = 0x1EbDFC75FfE3ba3de61E7138a3E8706aC841Af9B;
    address internal constant PROJECTX_NFPM = 0xeaD19AE861c29bBb2101E834922B2FEee69B9091;
    address internal constant MAINNET_WHYPE = 0x5555555555555555555555555555555555555555;
    address internal constant TESTNET_V3_FACTORY = 0x22B0768972bB7f1F5ea7a8740BB8f94b32483826;
    address internal constant TESTNET_V3_ROUTER = 0xD81F56576B1FF2f3Ef18e9Cc71Adaa42516fD990;
    address internal constant TESTNET_V3_NFPM = 0x09Aca834543b5790DB7a52803d5F9d48c5b87e80;
    address internal constant TESTNET_WHYPE = 0xADcb2f358Eae6492F61A5F87eb8893d09391d160;
    uint256 internal constant INITIAL_SUPPLY = 1_000_000_000 ether;
    uint256 internal constant LP_ALLOCATION = 800_000_000 ether;
    uint256 internal constant MAX_LP_DUST = 1 gwei;
    uint256 internal constant SEASONAL_ALLOCATION = 100_000_000 ether;
    uint256 internal constant ECOSYSTEM_ALLOCATION = 100_000_000 ether;
    bytes32 internal constant TOKEN_NAME_HASH = keccak256("Hyper World Assets");
    bytes32 internal constant TOKEN_SYMBOL_HASH = keccak256("HWA");

    event ProjectXModulesVerified(
        uint256 indexed chainId,
        address indexed token,
        address indexed pool,
        address rewards,
        address adapter,
        address liquidityLocker,
        address ecosystemVesting,
        uint8 feeProtocol
    );

    error WrongChain(uint256 actual);
    error MissingCode(address target);
    error InvalidWiring();

    function run() external {
        if (block.chainid != TESTNET && block.chainid != MAINNET) revert WrongChain(block.chainid);
        address factory = block.chainid == MAINNET ? PROJECTX_FACTORY : TESTNET_V3_FACTORY;
        address router = block.chainid == MAINNET ? PROJECTX_ROUTER : TESTNET_V3_ROUTER;
        address nfpm = block.chainid == MAINNET ? PROJECTX_NFPM : TESTNET_V3_NFPM;
        address whype = block.chainid == MAINNET ? MAINNET_WHYPE : TESTNET_WHYPE;

        FWA fwa = FWA(vm.envAddress("FWA_ADDRESS"));
        FWATokenHyperEVM token = FWATokenHyperEVM(payable(vm.envAddress("FWA_TOKEN_ADDRESS")));
        FWARewardsHyperEVM rewards = FWARewardsHyperEVM(vm.envAddress("FWA_REWARDS_ADDRESS"));
        FWAHyperSwapAdapter adapter = FWAHyperSwapAdapter(payable(vm.envAddress("FWA_PROJECTX_ADAPTER_ADDRESS")));
        HWAEcosystemVesting vesting = HWAEcosystemVesting(vm.envAddress("HWA_ECOSYSTEM_VESTING_ADDRESS"));
        HWAProjectXLiquidityLocker locker = HWAProjectXLiquidityLocker(token.liquidityLocker());
        SplitterHyperEVM splitter = SplitterHyperEVM(payable(vm.envAddress("FWA_SPLITTER_ADDRESS")));
        IHyperSwapV3Pool pool = IHyperSwapV3Pool(token.pool());
        uint256 poolTokenBalance = token.balanceOf(address(pool));
        uint256 launchDust = token.balanceOf(address(token));

        _requireCode(address(fwa));
        _requireCode(address(token));
        _requireCode(address(rewards));
        _requireCode(address(adapter));
        _requireCode(address(vesting));
        _requireCode(address(locker));
        _requireCode(address(splitter));
        _requireCode(address(pool));

        (uint160 price,,,,, uint8 feeProtocol,) = pool.slot0();
        address finalOwner = fwa.owner();
        if (block.chainid == MAINNET) {
            MainnetOwnerPolicy.validateConfiguredOwner(
                finalOwner, vm.envAddress("FWA_OWNER"), vm.envBool("MAINNET_EOA_OWNER_CONFIRMED")
            );
        }
        if (
            keccak256(bytes(token.name())) != TOKEN_NAME_HASH || keccak256(bytes(token.symbol())) != TOKEN_SYMBOL_HASH
                || !token.launched() || price == 0 || token.totalSupply() != INITIAL_SUPPLY
                || poolTokenBalance + launchDust != LP_ALLOCATION || launchDust > MAX_LP_DUST
                || token.POOL_FEE() != 10_000 || token.POOL_TICK_SPACING() != 200 || token.WHYPE() != whype
                || address(token.FACTORY()) != factory || address(token.POSITION_MANAGER()) != nfpm
                || IHyperSwapV3Factory(factory).getPool(whype, address(token), 10_000) != address(pool)
                || pool.fee() != 10_000 || pool.tickSpacing() != 200 || !locker.bound()
                || locker.tokenId() != token.lpTokenId() || address(locker.POSITION_MANAGER()) != nfpm
                || IHyperSwapV3PositionManager(nfpm).ownerOf(token.lpTokenId()) != address(locker)
                || locker.owner() != finalOwner || token.adapter() != address(adapter)
                || token.rewardsPool() != address(rewards) || address(adapter.FACTORY()) != factory
                || address(adapter.ROUTER()) != router || address(adapter.TOKEN()) != address(token)
                || adapter.WHYPE() != whype || adapter.POOL() != address(pool) || adapter.POOL_FEE() != 10_000
                || adapter.TICK_SPACING() != 200 || adapter.rewardsBuyer() != address(rewards)
                || rewards.token() != address(token) || address(rewards.swapAdapter()) != address(adapter)
                || rewards.fwa() != address(fwa) || address(fwa.rewards()) != address(rewards)
                || fwa.token() != address(token) || token.owner() != finalOwner || rewards.owner() != finalOwner
                || adapter.owner() != finalOwner || rewards.SEASONAL_RESERVE() != SEASONAL_ALLOCATION
                || rewards.seasonalReserveRemaining() != SEASONAL_ALLOCATION || !rewards.emissionConfigured()
                || token.routeDepositorBps() != 4_000 || token.routePurchaserBps() != 4_000
                || token.routeBurnBps() != 2_000 || fwa.payoutAddress() != address(splitter)
                || splitter.owner() != finalOwner || vesting.TOKEN() != address(token)
                || vesting.BENEFICIARY() != vm.envAddress("HWA_ECOSYSTEM_BENEFICIARY")
                || vesting.ALLOCATION() != ECOSYSTEM_ALLOCATION || vesting.DURATION() != 730 days
                || vesting.CLIFF() != 90 days || token.balanceOf(address(vesting)) != ECOSYSTEM_ALLOCATION
        ) revert InvalidWiring();

        // This attestation intentionally requires the entire public protocol to remain closed.
        if (
            rewards.emissionStart() != 0 || rewards.claimsEnabled() || token.externalBuysEnabled()
                || fwa.acquisitionsEnabled() || fwa.activeListingCount() != 0 || fwa.unsettledAcquisitionCount() != 0
                || token.balanceOf(address(rewards)) != SEASONAL_ALLOCATION || token.launchHwaPerHypeX96() == 0
                || token.balanceOf(finalOwner) != 0
        ) revert InvalidWiring();

        emit ProjectXModulesVerified(
            block.chainid,
            address(token),
            address(pool),
            address(rewards),
            address(adapter),
            address(locker),
            address(vesting),
            feeProtocol
        );
    }

    function _requireCode(address target) private view {
        if (target.code.length == 0) revert MissingCode(target);
    }
}
