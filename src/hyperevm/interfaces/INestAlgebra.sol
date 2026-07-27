// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @notice Minimal Algebra Integral surfaces used by the HWA Nest deployment.
/// @dev These selectors were checked against Nest's verified HyperEVM mainnet contracts.
interface INestAlgebraFactory {
    function owner() external view returns (address currentOwner);
    function createPool(address tokenA, address tokenB) external returns (address pool);
    function poolByPair(address tokenA, address tokenB) external view returns (address pool);
    function defaultTickspacing() external view returns (int24 tickSpacing);
    function defaultFee() external view returns (uint16 fee);
    function defaultCommunityFee() external view returns (uint16 communityFee);
    function isPublicPoolCreationMode() external view returns (bool enabled);
}

interface INestAlgebraPool {
    function factory() external view returns (address);
    function token0() external view returns (address);
    function token1() external view returns (address);
    function fee() external view returns (uint16 currentFee);
    function tickSpacing() external view returns (int24 currentTickSpacing);
    function plugin() external view returns (address currentPlugin);

    function globalState()
        external
        view
        returns (uint160 price, int24 tick, uint16 lastFee, uint8 pluginConfig, uint16 communityFee, bool unlocked);

    function setFee(uint16 newFee) external;
    function setCommunityFee(uint16 newCommunityFee) external;
    function setTickSpacing(int24 newTickSpacing) external;
    function setPlugin(address newPluginAddress) external;
    function setPluginConfig(uint8 newConfig) external;
}

interface INestSwapRouter {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        address recipient;
        uint256 deadline;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 limitSqrtPrice;
    }

    function factory() external view returns (address);
    function WNativeToken() external view returns (address);

    function exactInputSingle(ExactInputSingleParams calldata params) external payable returns (uint256 amountOut);
}

interface INestPositionManager {
    struct MintParams {
        address token0;
        address token1;
        int24 tickLower;
        int24 tickUpper;
        uint256 amount0Desired;
        uint256 amount1Desired;
        uint256 amount0Min;
        uint256 amount1Min;
        address recipient;
        uint256 deadline;
    }

    struct CollectParams {
        uint256 tokenId;
        address recipient;
        uint128 amount0Max;
        uint128 amount1Max;
    }

    function factory() external view returns (address);
    function WNativeToken() external view returns (address);

    function createAndInitializePoolIfNecessary(address token0, address token1, uint160 sqrtPriceX96)
        external
        payable
        returns (address pool);

    function mint(MintParams calldata params)
        external
        payable
        returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1);

    function collect(CollectParams calldata params) external payable returns (uint256 amount0, uint256 amount1);
    function ownerOf(uint256 tokenId) external view returns (address owner);
}

interface INestAlgebraPlugin {
    function defaultPluginConfig() external pure returns (uint8 config);

    function beforeInitialize(address sender, uint160 initialPrice) external returns (bytes4);
    function afterInitialize(address sender, uint160 initialPrice, int24 tick) external returns (bytes4);

    function beforeModifyPosition(
        address sender,
        address recipient,
        int24 bottomTick,
        int24 topTick,
        int128 liquidityDelta,
        bytes calldata data
    ) external returns (bytes4);

    function afterModifyPosition(
        address sender,
        address recipient,
        int24 bottomTick,
        int24 topTick,
        int128 liquidityDelta,
        uint256 amount0,
        uint256 amount1,
        bytes calldata data
    ) external returns (bytes4);

    function beforeSwap(
        address sender,
        address recipient,
        bool zeroToOne,
        int256 amountRequired,
        uint160 limitSqrtPrice,
        bool withPaymentInAdvance,
        bytes calldata data
    ) external returns (bytes4);

    function afterSwap(
        address sender,
        address recipient,
        bool zeroToOne,
        int256 amountRequired,
        uint160 limitSqrtPrice,
        int256 amount0,
        int256 amount1,
        bytes calldata data
    ) external returns (bytes4);

    function beforeFlash(address sender, address recipient, uint256 amount0, uint256 amount1, bytes calldata data)
        external
        returns (bytes4);

    function afterFlash(
        address sender,
        address recipient,
        uint256 amount0,
        uint256 amount1,
        uint256 paid0,
        uint256 paid1,
        bytes calldata data
    ) external returns (bytes4);
}

interface INestERC20Balance {
    function balanceOf(address account) external view returns (uint256);
}

interface INestWrappedNative is INestERC20Balance {
    function deposit() external payable;
    function withdraw(uint256 amount) external;
}
