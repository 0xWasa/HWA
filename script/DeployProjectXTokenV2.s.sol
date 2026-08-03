// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {FWATokenHyperEVM} from "../src/hyperevm/FWATokenHyperEVM.sol";
import {FWATokenHyperEVMFactory} from "../src/hyperevm/FWATokenHyperEVMFactory.sol";
import {FixedPointMathLib} from "solady/src/utils/FixedPointMathLib.sol";
import {MainnetOwnerPolicy} from "./MainnetOwnerPolicy.sol";

interface VmProjectXTokenV2Deploy {
    function envUint(string calldata name) external returns (uint256 value);
    function envAddress(string calldata name) external returns (address value);
    function envBool(string calldata name) external returns (bool value);
    function envOr(string calldata name, address defaultValue) external returns (address value);
    function addr(uint256 privateKey) external returns (address keyAddr);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

/// @notice Deploys the HWA v2 migration market: 1B supply, 500M one-sided LP, a circa $40k launch FDV and FWA-style full range.
/// @dev This script only creates and locks the market. It deliberately leaves external buys disabled.
contract DeployProjectXTokenV2 {
    VmProjectXTokenV2Deploy internal constant vm =
        VmProjectXTokenV2Deploy(address(uint160(uint256(keccak256("hevm cheat code")))));

    uint256 internal constant TESTNET = 998;
    uint256 internal constant MAINNET = 999;
    uint256 internal constant Q96 = 1 << 96;
    uint256 public constant TOTAL_SUPPLY = 1_000_000_000 ether;
    uint256 public constant LAUNCH_ALLOCATION = 500_000_000 ether;
    uint256 public constant POST_LP_ALLOCATION = 500_000_000 ether;

    address internal constant PROJECTX_FACTORY = 0xFf7B3e8C00e57ea31477c32A5B52a58Eea47b072;
    address internal constant PROJECTX_NFPM = 0xeaD19AE861c29bBb2101E834922B2FEee69B9091;
    address internal constant MAINNET_WHYPE = 0x5555555555555555555555555555555555555555;
    address internal constant TESTNET_V3_FACTORY = 0x22B0768972bB7f1F5ea7a8740BB8f94b32483826;
    address internal constant TESTNET_V3_NFPM = 0x09Aca834543b5790DB7a52803d5F9d48c5b87e80;
    address internal constant TESTNET_WHYPE = 0xADcb2f358Eae6492F61A5F87eb8893d09391d160;

    event ProjectXTokenV2Prepared(
        uint256 indexed chainId,
        address indexed token,
        address indexed pool,
        address liquidityLocker,
        uint256 lpTokenId,
        address launchFactory,
        address finalOwner,
        uint256 launchAllocation,
        int24 tickLower,
        int24 tickUpper,
        uint256 fdvHypeWei
    );

    error WrongChain(uint256 actual);
    error ConfirmationMissing();
    error InvalidAddress();
    error InvalidPrice();
    error InvalidDeployment();

    function run() external returns (FWATokenHyperEVM token, FWATokenHyperEVMFactory launchFactory) {
        if (block.chainid != TESTNET && block.chainid != MAINNET) revert WrongChain(block.chainid);
        if (
            !vm.envBool("HWA_V2_TOKENOMICS_CONFIRMED") || !vm.envBool("HWA_V2_FULL_RANGE_CONFIRMED")
                || !vm.envBool("HWA_V2_40K_USD_FDV_CONFIRMED")
        ) revert ConfirmationMissing();
        if (
            block.chainid == MAINNET
                && (
                    !vm.envBool("HWA_V2_MAINNET_DEPLOYMENT_CONFIRMED")
                        || !vm.envBool("PROJECTX_LP_LOCK_CONFIRMED")
                )
        ) revert ConfirmationMissing();

        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);
        address finalOwner = block.chainid == MAINNET ? vm.envAddress("FWA_OWNER") : vm.envOr("FWA_OWNER", deployer);
        address feeRecipient = vm.envAddress("FWA_PROJECTX_FEE_RECIPIENT");
        if (finalOwner == address(0) || feeRecipient == address(0)) revert InvalidAddress();
        if (block.chainid == MAINNET) {
            MainnetOwnerPolicy.validateDeploymentOwner(
                finalOwner, deployer, vm.envBool("MAINNET_EOA_OWNER_CONFIRMED")
            );
        }

        uint256 rawSqrtPrice = vm.envUint("HWA_V2_INITIAL_SQRT_PRICE_X96");
        if (rawSqrtPrice == 0 || rawSqrtPrice > type(uint160).max) revert InvalidPrice();
        if (block.chainid == MAINNET && rawSqrtPrice != vm.envUint("HWA_V2_INITIAL_SQRT_PRICE_X96_ECHO")) {
            revert InvalidPrice();
        }

        address factory = block.chainid == MAINNET ? PROJECTX_FACTORY : TESTNET_V3_FACTORY;
        address nfpm = block.chainid == MAINNET ? PROJECTX_NFPM : TESTNET_V3_NFPM;
        address whype = block.chainid == MAINNET ? MAINNET_WHYPE : TESTNET_WHYPE;

        vm.startBroadcast(deployerKey);
        launchFactory = new FWATokenHyperEVMFactory(
            "Hyper World Assets",
            "HWA",
            TOTAL_SUPPLY,
            LAUNCH_ALLOCATION,
            factory,
            nfpm,
            whype,
            finalOwner,
            finalOwner,
            feeRecipient,
            uint160(rawSqrtPrice),
            0
        );
        token = launchFactory.token();
        vm.stopBroadcast();

        uint256 priceX96 = FixedPointMathLib.fullMulDiv(rawSqrtPrice, rawSqrtPrice, Q96);
        if (priceX96 == 0) revert InvalidPrice();
        uint256 fdvHypeWei = address(token) < whype
            ? FixedPointMathLib.fullMulDiv(TOTAL_SUPPLY, priceX96, Q96)
            : FixedPointMathLib.fullMulDiv(TOTAL_SUPPLY, Q96, priceX96);

        if (block.chainid == MAINNET) {
            uint256 minFdv = vm.envUint("HWA_V2_MIN_INITIAL_FDV_HYPE_WEI");
            uint256 maxFdv = vm.envUint("HWA_V2_MAX_INITIAL_FDV_HYPE_WEI");
            if (minFdv == 0 || fdvHypeWei < minFdv || fdvHypeWei > maxFdv) revert InvalidPrice();
        }

        int24 lower = launchFactory.tickLower();
        int24 upper = launchFactory.tickUpper();
        bool reachesFullRangeBoundary = lower == -887_200 || upper == 887_200;
        if (
            token.totalSupply() != TOTAL_SUPPLY || token.balanceOf(finalOwner) != POST_LP_ALLOCATION
                || token.owner() != finalOwner || token.externalBuysEnabled() || !reachesFullRangeBoundary
        ) revert InvalidDeployment();

        emit ProjectXTokenV2Prepared(
            block.chainid,
            address(token),
            token.pool(),
            token.liquidityLocker(),
            token.lpTokenId(),
            address(launchFactory),
            finalOwner,
            LAUNCH_ALLOCATION,
            lower,
            upper,
            fdvHypeWei
        );
    }
}