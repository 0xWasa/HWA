// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";

import {FWATokenNest} from "../src/hyperevm/FWATokenNest.sol";

interface VmNestLaunch {
    function envUint(string calldata name) external returns (uint256 value);
    function envInt(string calldata name) external returns (int256 value);
    function envAddress(string calldata name) external returns (address value);
    function envBool(string calldata name) external returns (bool value);
    function addr(uint256 privateKey) external returns (address keyAddr);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

/// @notice Nest phase F: seed and lock the single-sided LP after Nest's post-init configuration.
contract LaunchNestMarket {
    VmNestLaunch internal constant vm = VmNestLaunch(address(uint160(uint256(keccak256("hevm cheat code")))));
    uint256 internal constant HYPEREVM_MAINNET_CHAIN_ID = 999;
    uint256 internal constant HYPEREVM_TESTNET_CHAIN_ID = 998;

    event NestMarketLaunched(
        address indexed token,
        address indexed pool,
        uint256 indexed lpTokenId,
        address liquidityLocker,
        uint160 sqrtPriceX96,
        int24 tickLower,
        int24 tickUpper
    );

    error UnauthorizedDeployer();
    error MainnetNotConfirmed();
    error InvalidRange();
    error WrongChain(uint256 actual);
    error LockNotConfirmed();
    error TokenomicsNotConfirmed();

    function run() external {
        if (block.chainid != HYPEREVM_TESTNET_CHAIN_ID && block.chainid != HYPEREVM_MAINNET_CHAIN_ID) {
            revert WrongChain(block.chainid);
        }
        if (!vm.envBool("FWA_TOKENOMICS_CONFIRMED")) revert TokenomicsNotConfirmed();
        if (block.chainid == HYPEREVM_MAINNET_CHAIN_ID && !vm.envBool("NEST_MAINNET_DEPLOYMENT_CONFIRMED")) {
            revert MainnetNotConfirmed();
        }
        if (block.chainid == HYPEREVM_MAINNET_CHAIN_ID && !vm.envBool("NEST_LP_LOCK_CONFIRMED")) {
            revert LockNotConfirmed();
        }
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);
        FWATokenNest token = FWATokenNest(payable(vm.envAddress("FWA_TOKEN_ADDRESS")));
        if (token.owner() != deployer) revert UnauthorizedDeployer();

        int256 rawRangeWidth = vm.envInt("FWA_LP_RANGE_WIDTH_TICKS");
        if (rawRangeWidth <= 0 || rawRangeWidth > type(int24).max) {
            revert InvalidRange();
        }
        uint160 sqrtPriceX96 = token.initialSqrtPriceX96();
        if (!token.marketInitialized() || sqrtPriceX96 == 0) revert InvalidRange();
        // forge-lint: disable-next-line(unsafe-typecast)
        int24 rangeWidth = int24(rawRangeWidth);
        int24 spacing = token.POOL_TICK_SPACING();
        if (rangeWidth % spacing != 0) revert InvalidRange();

        int24 currentTick = TickMath.getTickAtSqrtPrice(sqrtPriceX96);
        int24 floorTick = _floorToSpacing(currentTick, spacing);
        int24 tickLower;
        int24 tickUpper;
        if (address(token) < token.WHYPE()) {
            tickLower = floorTick == currentTick && sqrtPriceX96 == TickMath.getSqrtPriceAtTick(floorTick)
                ? currentTick
                : floorTick + spacing;
            tickUpper = tickLower + rangeWidth;
        } else {
            tickUpper = floorTick;
            tickLower = tickUpper - rangeWidth;
        }

        vm.startBroadcast(deployerKey);
        token.finalizeLaunch(tickLower, tickUpper);
        vm.stopBroadcast();

        emit NestMarketLaunched(
            address(token), token.pool(), token.lpTokenId(), token.liquidityLocker(), sqrtPriceX96, tickLower, tickUpper
        );
    }

    function _floorToSpacing(int24 tick, int24 spacing) private pure returns (int24 floorTick) {
        int24 remainder = tick % spacing;
        floorTick = tick - remainder;
        if (remainder < 0) floorTick -= spacing;
    }
}
