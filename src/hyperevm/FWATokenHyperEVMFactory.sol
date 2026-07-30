// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";

import {FWATokenHyperEVM} from "./FWATokenHyperEVM.sol";
import {HWAProjectXLiquidityLocker} from "./HWAProjectXLiquidityLocker.sol";

/// @title FWATokenHyperEVMFactory
/// @notice Atomically deploys HWA, initializes its Project X-compatible pool and locks its LP position.
/// @dev Atomic launch prevents a third party from initializing the canonical V3 pool at a hostile
///      price between token deployment and the one-sided position mint.
contract FWATokenHyperEVMFactory {
    int24 private constant POOL_TICK_SPACING = 200;
    /// @dev A zero range width selects the widest valid one-sided Project X range.
    int24 public constant FULL_RANGE = 0;

    FWATokenHyperEVM public immutable token;
    int24 public immutable tickLower;
    int24 public immutable tickUpper;

    event TokenLaunched(
        address indexed token,
        address indexed pool,
        uint256 indexed lpTokenId,
        address tokenOwner,
        address allocationRecipient,
        address liquidityLocker,
        int24 tickLower,
        int24 tickUpper
    );

    error InvalidAddress();
    error InvalidRangeWidth();
    error TransferFailed();

    constructor(
        string memory name,
        string memory symbol,
        uint256 supply,
        uint256 lpSupply,
        address factory,
        address positionManager,
        address whype,
        address tokenOwner,
        address allocationRecipient,
        address feeRecipient,
        uint160 sqrtPriceX96,
        int24 rangeWidth
    ) {
        if (tokenOwner == address(0) || allocationRecipient == address(0) || feeRecipient == address(0)) {
            revert InvalidAddress();
        }
        int24 spacing = POOL_TICK_SPACING;
        if (rangeWidth < 0 || rangeWidth % spacing != 0) revert InvalidRangeWidth();

        FWATokenHyperEVM launchedToken =
            new FWATokenHyperEVM(name, symbol, supply, lpSupply, factory, positionManager, whype, address(this));
        HWAProjectXLiquidityLocker locker =
            new HWAProjectXLiquidityLocker(positionManager, address(launchedToken), feeRecipient, tokenOwner);

        int24 currentTick = TickMath.getTickAtSqrtPrice(sqrtPriceX96);
        int24 floorTick = _floorToSpacing(currentTick, spacing);
        int24 minTick = TickMath.minUsableTick(spacing);
        int24 maxTick = TickMath.maxUsableTick(spacing);
        int24 lower;
        int24 upper;
        if (address(launchedToken) < whype) {
            // `getTickAtSqrtPrice` can return a spacing-aligned tick even when the price is
            // strictly above that tick. Only keep the floor when the boundary is exact.
            lower = sqrtPriceX96 == TickMath.getSqrtPriceAtTick(floorTick) ? floorTick : floorTick + spacing;
            if (lower >= maxTick) revert InvalidRangeWidth();
            if (rangeWidth == FULL_RANGE) {
                upper = maxTick;
            } else {
                int256 candidate = int256(lower) + int256(rangeWidth);
                if (candidate > int256(maxTick)) revert InvalidRangeWidth();
                upper = int24(candidate);
            }
        } else {
            upper = floorTick;
            if (upper <= minTick) revert InvalidRangeWidth();
            if (rangeWidth == FULL_RANGE) {
                lower = minTick;
            } else {
                int256 candidate = int256(upper) - int256(rangeWidth);
                if (candidate < int256(minTick)) revert InvalidRangeWidth();
                lower = int24(candidate);
            }
        }

        (uint256 tokenId,,) = launchedToken.launch(sqrtPriceX96, lower, upper, address(locker));

        uint256 allocation = launchedToken.balanceOf(address(this));
        if (allocation != 0 && !launchedToken.transfer(allocationRecipient, allocation)) revert TransferFailed();
        launchedToken.transferOwnership(tokenOwner);

        token = launchedToken;
        tickLower = lower;
        tickUpper = upper;

        emit TokenLaunched(
            address(launchedToken),
            launchedToken.pool(),
            tokenId,
            tokenOwner,
            allocationRecipient,
            address(locker),
            lower,
            upper
        );
    }

    function _floorToSpacing(int24 tick, int24 spacing) internal pure returns (int24 floorTick) {
        int24 remainder = tick % spacing;
        floorTick = tick - remainder;
        if (remainder < 0) floorTick -= spacing;
    }
}
