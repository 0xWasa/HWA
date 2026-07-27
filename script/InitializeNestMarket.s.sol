// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {FWATokenNest} from "../src/hyperevm/FWATokenNest.sol";
import {FixedPointMathLib} from "solady/src/utils/FixedPointMathLib.sol";

interface VmNestInitialize {
    function envUint(string calldata name) external returns (uint256 value);
    function envAddress(string calldata name) external returns (address value);
    function envBool(string calldata name) external returns (bool value);
    function addr(uint256 privateKey) external returns (address keyAddr);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

/// @notice Nest phase D: initialize the plugin-guarded pool before Nest applies final pool settings.
contract InitializeNestMarket {
    VmNestInitialize internal constant vm = VmNestInitialize(address(uint160(uint256(keccak256("hevm cheat code")))));
    uint256 internal constant HYPEREVM_MAINNET_CHAIN_ID = 999;
    uint256 internal constant HYPEREVM_TESTNET_CHAIN_ID = 998;
    uint256 internal constant Q96 = 1 << 96;

    event NestMarketInitialized(address indexed token, address indexed pool, uint160 sqrtPriceX96);

    error UnauthorizedDeployer();
    error MainnetNotConfirmed();
    error InvalidPrice();
    error WrongChain(uint256 actual);
    error PriceNotConfirmed();
    error TokenomicsNotConfirmed();

    function run() external {
        if (block.chainid != HYPEREVM_TESTNET_CHAIN_ID && block.chainid != HYPEREVM_MAINNET_CHAIN_ID) {
            revert WrongChain(block.chainid);
        }
        if (!vm.envBool("FWA_TOKENOMICS_CONFIRMED")) revert TokenomicsNotConfirmed();
        if (block.chainid == HYPEREVM_MAINNET_CHAIN_ID && !vm.envBool("NEST_MAINNET_DEPLOYMENT_CONFIRMED")) {
            revert MainnetNotConfirmed();
        }
        if (block.chainid == HYPEREVM_MAINNET_CHAIN_ID && !vm.envBool("NEST_MARKET_PRICE_CONFIRMED")) {
            revert PriceNotConfirmed();
        }
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);
        FWATokenNest token = FWATokenNest(payable(vm.envAddress("FWA_TOKEN_ADDRESS")));
        if (token.owner() != deployer) revert UnauthorizedDeployer();

        uint256 rawSqrtPrice = block.chainid == HYPEREVM_MAINNET_CHAIN_ID
            ? vm.envUint("MAINNET_FWA_INITIAL_SQRT_PRICE_X96")
            : vm.envUint("FWA_INITIAL_SQRT_PRICE_X96");
        if (rawSqrtPrice > type(uint160).max) revert InvalidPrice();
        if (
            block.chainid == HYPEREVM_MAINNET_CHAIN_ID
                && rawSqrtPrice != vm.envUint("MAINNET_FWA_INITIAL_SQRT_PRICE_X96_ECHO")
        ) revert InvalidPrice();
        // forge-lint: disable-next-line(unsafe-typecast)
        uint160 sqrtPriceX96 = uint160(rawSqrtPrice);
        if (block.chainid == HYPEREVM_MAINNET_CHAIN_ID) {
            uint256 priceX96 = FixedPointMathLib.fullMulDiv(rawSqrtPrice, rawSqrtPrice, Q96);
            if (priceX96 == 0) revert InvalidPrice();
            uint256 fdvHypeWei = address(token) < token.WHYPE()
                ? FixedPointMathLib.fullMulDiv(token.totalSupply(), priceX96, Q96)
                : FixedPointMathLib.fullMulDiv(token.totalSupply(), Q96, priceX96);
            uint256 minFdv = vm.envUint("MAINNET_FWA_MIN_INITIAL_FDV_HYPE_WEI");
            uint256 maxFdv = vm.envUint("MAINNET_FWA_MAX_INITIAL_FDV_HYPE_WEI");
            if (minFdv == 0 || fdvHypeWei < minFdv || fdvHypeWei > maxFdv) revert InvalidPrice();
        }

        vm.startBroadcast(deployerKey);
        token.initializeMarket(sqrtPriceX96);
        vm.stopBroadcast();

        emit NestMarketInitialized(address(token), token.pool(), sqrtPriceX96);
    }
}
