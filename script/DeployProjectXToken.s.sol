// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {FWATokenHyperEVM} from "../src/hyperevm/FWATokenHyperEVM.sol";
import {FWATokenHyperEVMFactory} from "../src/hyperevm/FWATokenHyperEVMFactory.sol";
import {FixedPointMathLib} from "solady/src/utils/FixedPointMathLib.sol";

interface VmProjectXTokenDeploy {
    function envUint(string calldata name) external returns (uint256 value);
    function envInt(string calldata name) external returns (int256 value);
    function envAddress(string calldata name) external returns (address value);
    function envBool(string calldata name) external returns (bool value);
    function addr(uint256 privateKey) external returns (address keyAddr);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

/// @notice Atomically creates HWA, the canonical 1% V3 pool and its permanently locked launch LP.
/// @dev Chain 998 uses the official HyperSwap V3 deployment solely as a Project X ABI compatibility venue.
contract DeployProjectXToken {
    VmProjectXTokenDeploy internal constant vm =
        VmProjectXTokenDeploy(address(uint160(uint256(keccak256("hevm cheat code")))));

    uint256 internal constant TESTNET = 998;
    uint256 internal constant MAINNET = 999;
    uint256 internal constant Q96 = 1 << 96;
    uint256 internal constant TOTAL_SUPPLY = 1_000_000_000 ether;
    uint256 internal constant LAUNCH_ALLOCATION = 500_000_000 ether;

    address internal constant PROJECTX_FACTORY = 0xFf7B3e8C00e57ea31477c32A5B52a58Eea47b072;
    address internal constant PROJECTX_NFPM = 0xeaD19AE861c29bBb2101E834922B2FEee69B9091;
    address internal constant MAINNET_WHYPE = 0x5555555555555555555555555555555555555555;

    address internal constant TESTNET_V3_FACTORY = 0x22B0768972bB7f1F5ea7a8740BB8f94b32483826;
    address internal constant TESTNET_V3_NFPM = 0x09Aca834543b5790DB7a52803d5F9d48c5b87e80;
    address internal constant TESTNET_WHYPE = 0xADcb2f358Eae6492F61A5F87eb8893d09391d160;

    event ProjectXTokenPrepared(
        uint256 indexed chainId,
        address indexed token,
        address indexed pool,
        address liquidityLocker,
        uint256 lpTokenId,
        address launchFactory,
        address temporaryOwner,
        int24 tickLower,
        int24 tickUpper
    );

    error WrongChain(uint256 actual);
    error TokenomicsNotConfirmed();
    error MainnetNotConfirmed();
    error InvalidAddress();
    error InvalidRange();
    error PriceNotConfirmed();
    error LpLockNotConfirmed();
    error InvalidPrice();

    function run() external returns (FWATokenHyperEVM token, FWATokenHyperEVMFactory launchFactory) {
        if (block.chainid != TESTNET && block.chainid != MAINNET) revert WrongChain(block.chainid);
        if (!vm.envBool("FWA_TOKENOMICS_CONFIRMED")) revert TokenomicsNotConfirmed();
        if (block.chainid == MAINNET && !vm.envBool("PROJECTX_MAINNET_DEPLOYMENT_CONFIRMED")) {
            revert MainnetNotConfirmed();
        }
        // The launch price is transcribed by hand from the signed worksheet and the launch is
        // atomic and irreversible, so mainnet requires both explicit confirmations plus the
        // double-entry echo BEFORE anything is broadcast.
        if (block.chainid == MAINNET) {
            if (!vm.envBool("PROJECTX_MARKET_PRICE_CONFIRMED")) revert PriceNotConfirmed();
            if (!vm.envBool("PROJECTX_LP_LOCK_CONFIRMED")) revert LpLockNotConfirmed();
        }

        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);
        address feeRecipient = vm.envAddress("FWA_PROJECTX_FEE_RECIPIENT");
        if (feeRecipient == address(0)) revert InvalidAddress();

        uint256 rawSqrtPrice = vm.envUint("FWA_INITIAL_SQRT_PRICE_X96");
        int256 rawRangeWidth = vm.envInt("FWA_LP_RANGE_WIDTH_TICKS");
        if (rawSqrtPrice > type(uint160).max || rawRangeWidth <= 0 || rawRangeWidth > type(int24).max) {
            revert InvalidRange();
        }
        if (block.chainid == MAINNET && rawSqrtPrice != vm.envUint("FWA_INITIAL_SQRT_PRICE_X96_ECHO")) {
            revert InvalidPrice();
        }

        address factory = block.chainid == MAINNET ? PROJECTX_FACTORY : TESTNET_V3_FACTORY;
        address nfpm = block.chainid == MAINNET ? PROJECTX_NFPM : TESTNET_V3_NFPM;
        address whype = block.chainid == MAINNET ? MAINNET_WHYPE : TESTNET_WHYPE;

        vm.startBroadcast(deployerKey);
        // Constructor-driven launch keeps factory creation, token creation, pool initialisation
        // and LP locking inside one broadcast transaction. There is no mempool-visible factory
        // nonce from which a third party can pre-initialise the future token's pool.
        launchFactory = new FWATokenHyperEVMFactory(
            "Hyper World Assets",
            "HWA",
            TOTAL_SUPPLY,
            LAUNCH_ALLOCATION,
            factory,
            nfpm,
            whype,
            deployer,
            deployer,
            feeRecipient,
            uint160(rawSqrtPrice),
            int24(rawRangeWidth)
        );
        token = launchFactory.token();
        int24 tickLower = launchFactory.tickLower();
        int24 tickUpper = launchFactory.tickUpper();
        vm.stopBroadcast();

        // Token/wHYPE ordering decides whether the pool price is HWA-per-HYPE or its inverse, and
        // the token address is only known once the factory has deployed it. `forge script` runs
        // `run()` to completion in simulation before it broadcasts anything, so reverting here
        // aborts the entire launch — no transaction is ever sent with an out-of-band price.
        if (block.chainid == MAINNET) {
            uint256 priceX96 = FixedPointMathLib.fullMulDiv(rawSqrtPrice, rawSqrtPrice, Q96);
            if (priceX96 == 0) revert InvalidPrice();
            uint256 fdvHypeWei = address(token) < whype
                ? FixedPointMathLib.fullMulDiv(TOTAL_SUPPLY, priceX96, Q96)
                : FixedPointMathLib.fullMulDiv(TOTAL_SUPPLY, Q96, priceX96);
            uint256 minFdv = vm.envUint("MAINNET_FWA_MIN_INITIAL_FDV_HYPE_WEI");
            uint256 maxFdv = vm.envUint("MAINNET_FWA_MAX_INITIAL_FDV_HYPE_WEI");
            if (minFdv == 0 || fdvHypeWei < minFdv || fdvHypeWei > maxFdv) revert InvalidPrice();
        }

        emit ProjectXTokenPrepared(
            block.chainid,
            address(token),
            token.pool(),
            token.liquidityLocker(),
            token.lpTokenId(),
            address(launchFactory),
            deployer,
            tickLower,
            tickUpper
        );
    }
}
