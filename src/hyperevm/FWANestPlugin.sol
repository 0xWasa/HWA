// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {INestAlgebraPlugin, INestAlgebraPool} from "./interfaces/INestAlgebra.sol";

interface IFWANestTokenGate {
    function launching() external view returns (bool);
    function launched() external view returns (bool);
    function externalBuysEnabled() external view returns (bool);
    function isProtocolBuyer(address account) external view returns (bool);
    function protocolBuyActive(address recipient) external view returns (bool);
}

/// @title FWANestPlugin
/// @notice Algebra Integral plugin preserving FWA's launch latch, exact-input rule and buy gate.
/// @dev Algebra Integral cannot return swap deltas like the Ethereum Uniswap v4 hook. The flat 1%
///      fee is therefore enforced as the pool's static fee and its LP position is held by the
///      immutable-liquidity locker. Nest must install this plugin before initialization and apply
///      the final fee configuration after initialization, before HWA finalizes the launch.
contract FWANestPlugin is INestAlgebraPlugin {
    uint8 public constant BEFORE_SWAP_FLAG = 1;
    uint8 public constant AFTER_SWAP_FLAG = 1 << 1;
    uint8 public constant BEFORE_POSITION_MODIFY_FLAG = 1 << 2;
    uint8 public constant REQUIRED_PLUGIN_CONFIG = BEFORE_SWAP_FLAG | AFTER_SWAP_FLAG | BEFORE_POSITION_MODIFY_FLAG;

    uint16 public constant REQUIRED_FEE = 10_000; // Algebra units: 1e-6, therefore 1%.
    uint16 public constant REQUIRED_COMMUNITY_FEE = 0;

    INestAlgebraPool public immutable POOL;
    IFWANestTokenGate public immutable TOKEN;
    address public immutable WHYPE;

    uint64 public deploymentBlock;

    event PoolLaunched(address indexed pool, uint256 indexed blockNumber, uint160 initialPrice);
    event Trade(uint160 sqrtPriceX96, int256 amount0, int256 amount1);

    error InvalidAddress();
    error InvalidPool();
    error OnlyPool();
    error PoolAlreadyInitialized();
    error NotLaunching();
    error MarketNotLaunched();
    error ExactOutputNotAllowed();
    error ExternalBuysDisabled();
    error InvalidPoolConfiguration();

    constructor(address pool_, address token_, address whype_) {
        if (pool_ == address(0) || token_ == address(0) || whype_ == address(0)) revert InvalidAddress();
        if (pool_.code.length == 0 || token_.code.length == 0 || whype_.code.length == 0) revert InvalidAddress();

        INestAlgebraPool poolContract = INestAlgebraPool(pool_);
        address token0 = poolContract.token0();
        address token1 = poolContract.token1();
        if (!((token0 == token_ && token1 == whype_) || (token0 == whype_ && token1 == token_))) {
            revert InvalidPool();
        }
        (uint160 price,,,,,) = poolContract.globalState();
        if (price != 0) revert PoolAlreadyInitialized();

        POOL = poolContract;
        TOKEN = IFWANestTokenGate(token_);
        WHYPE = whype_;
    }

    modifier onlyPool() {
        if (msg.sender != address(POOL)) revert OnlyPool();
        _;
    }

    function defaultPluginConfig() external pure returns (uint8 config) {
        return REQUIRED_PLUGIN_CONFIG;
    }

    function beforeInitialize(address, uint160 initialPrice) external onlyPool returns (bytes4) {
        if (deploymentBlock != 0) revert PoolAlreadyInitialized();
        if (!TOKEN.launching()) revert NotLaunching();
        deploymentBlock = uint64(block.number);
        emit PoolLaunched(msg.sender, block.number, initialPrice);
        return INestAlgebraPlugin.beforeInitialize.selector;
    }

    function afterInitialize(address, uint160, int24) external view onlyPool returns (bytes4) {
        return INestAlgebraPlugin.afterInitialize.selector;
    }

    function beforeModifyPosition(address, address, int24, int24, int128 liquidityDelta, bytes calldata)
        external
        view
        onlyPool
        returns (bytes4)
    {
        if (liquidityDelta > 0 && !TOKEN.launching()) revert NotLaunching();
        return INestAlgebraPlugin.beforeModifyPosition.selector;
    }

    function afterModifyPosition(address, address, int24, int24, int128, uint256, uint256, bytes calldata)
        external
        view
        onlyPool
        returns (bytes4)
    {
        return INestAlgebraPlugin.afterModifyPosition.selector;
    }

    function beforeSwap(
        address,
        address recipient,
        bool zeroToOne,
        int256 amountRequired,
        uint160,
        bool,
        bytes calldata
    ) external view onlyPool returns (bytes4) {
        if (!TOKEN.launched()) revert MarketNotLaunched();
        if (amountRequired < 0) revert ExactOutputNotAllowed();

        (,,, uint8 config, uint16 communityFee,) = POOL.globalState();
        if (
            POOL.plugin() != address(this) || config != REQUIRED_PLUGIN_CONFIG || POOL.fee() != REQUIRED_FEE
                || communityFee != REQUIRED_COMMUNITY_FEE
        ) revert InvalidPoolConfiguration();

        bool whypeIsToken0 = POOL.token0() == WHYPE;
        bool isBuy = whypeIsToken0 ? zeroToOne : !zeroToOne;
        if (isBuy && !TOKEN.externalBuysEnabled() && !TOKEN.protocolBuyActive(recipient)) {
            revert ExternalBuysDisabled();
        }

        return INestAlgebraPlugin.beforeSwap.selector;
    }

    function afterSwap(address, address, bool, int256, uint160, int256 amount0, int256 amount1, bytes calldata)
        external
        onlyPool
        returns (bytes4)
    {
        (uint160 price,,,,,) = POOL.globalState();
        emit Trade(price, amount0, amount1);
        return INestAlgebraPlugin.afterSwap.selector;
    }

    function beforeFlash(address, address, uint256, uint256, bytes calldata) external view onlyPool returns (bytes4) {
        return INestAlgebraPlugin.beforeFlash.selector;
    }

    function afterFlash(address, address, uint256, uint256, uint256, uint256, bytes calldata)
        external
        view
        onlyPool
        returns (bytes4)
    {
        return INestAlgebraPlugin.afterFlash.selector;
    }
}
