// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {
    INestAlgebraFactory,
    INestAlgebraPlugin,
    INestAlgebraPool,
    INestPositionManager,
    INestSwapRouter
} from "../interfaces/INestAlgebra.sol";

interface ITestnetERC20Transfer {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

interface INestTestnetHarnessFactory is INestAlgebraFactory {
    function positionManager() external view returns (address);
    function router() external view returns (address);
}

/// @notice Non-official Algebra-compatible pool used only for HWA integration tests on chain 998.
contract NestTestnetPool is INestAlgebraPool {
    address public immutable override factory;
    address public immutable override token0;
    address public immutable override token1;

    uint16 public override fee = 500;
    int24 public override tickSpacing = 60;
    address public override plugin;
    uint160 public price;
    int24 public currentTick;
    uint8 public pluginConfig;
    uint16 public communityFee = 1_000;
    bool public unlocked = true;

    error Unauthorized();
    error AlreadyInitialized();
    error ExactOutputUnsupported();
    error TransferFailed();

    constructor(address factory_, address token0_, address token1_) {
        factory = factory_;
        token0 = token0_;
        token1 = token1_;
    }

    modifier onlyAdministrator() {
        if (msg.sender != INestTestnetHarnessFactory(factory).owner()) revert Unauthorized();
        _;
    }

    modifier onlyPositionManager() {
        if (msg.sender != INestTestnetHarnessFactory(factory).positionManager()) revert Unauthorized();
        _;
    }

    modifier onlyRouter() {
        if (msg.sender != INestTestnetHarnessFactory(factory).router()) revert Unauthorized();
        _;
    }

    function globalState() external view override returns (uint160, int24, uint16, uint8, uint16, bool) {
        return (price, currentTick, fee, pluginConfig, communityFee, unlocked);
    }

    function setFee(uint16 newFee) external override onlyAdministrator {
        fee = newFee;
    }

    function setCommunityFee(uint16 newCommunityFee) external override onlyAdministrator {
        communityFee = newCommunityFee;
    }

    function setTickSpacing(int24 newTickSpacing) external override onlyAdministrator {
        tickSpacing = newTickSpacing;
    }

    function setPlugin(address newPluginAddress) external override onlyAdministrator {
        plugin = newPluginAddress;
    }

    function setPluginConfig(uint8 newConfig) external override onlyAdministrator {
        pluginConfig = newConfig;
    }

    function initializeTestnet(uint160 initialPrice) external onlyPositionManager {
        if (price != 0) revert AlreadyInitialized();
        address currentPlugin = plugin;
        if (currentPlugin != address(0)) {
            INestAlgebraPlugin(currentPlugin).beforeInitialize(msg.sender, initialPrice);
        }
        price = initialPrice;
        INestAlgebraFactory factoryContract = INestAlgebraFactory(factory);
        fee = factoryContract.defaultFee();
        tickSpacing = factoryContract.defaultTickspacing();
        communityFee = factoryContract.defaultCommunityFee();
        if (currentPlugin != address(0)) {
            INestAlgebraPlugin(currentPlugin).afterInitialize(msg.sender, initialPrice, currentTick);
        }
    }

    function beforeMintTestnet(address recipient, int24 bottomTick, int24 topTick, int128 liquidityDelta)
        external
        onlyPositionManager
    {
        if ((pluginConfig & 4) != 0) {
            INestAlgebraPlugin(plugin)
                .beforeModifyPosition(msg.sender, recipient, bottomTick, topTick, liquidityDelta, "");
        }
    }

    function afterMintTestnet(
        address recipient,
        int24 bottomTick,
        int24 topTick,
        int128 liquidityDelta,
        uint256 amount0,
        uint256 amount1
    ) external onlyPositionManager {
        if ((pluginConfig & 8) != 0) {
            INestAlgebraPlugin(plugin)
                .afterModifyPosition(msg.sender, recipient, bottomTick, topTick, liquidityDelta, amount0, amount1, "");
        }
    }

    function swapTestnet(address recipient, bool zeroToOne, int256 amountRequired, uint160 limitSqrtPrice)
        external
        onlyRouter
        returns (uint256 amountOut)
    {
        if (amountRequired <= 0) revert ExactOutputUnsupported();
        address currentPlugin = plugin;
        if ((pluginConfig & 1) != 0) {
            INestAlgebraPlugin(currentPlugin)
                .beforeSwap(msg.sender, recipient, zeroToOne, amountRequired, limitSqrtPrice, false, "");
        }

        // Deterministic 2:1 quote. This harness validates integration and gating, not price discovery.
        amountOut = uint256(amountRequired) * 2;
        int256 amount0;
        int256 amount1;
        if (zeroToOne) {
            amount0 = amountRequired;
            amount1 = -int256(amountOut);
            if (!ITestnetERC20Transfer(token1).transfer(recipient, amountOut)) revert TransferFailed();
        } else {
            amount0 = -int256(amountOut);
            amount1 = amountRequired;
            if (!ITestnetERC20Transfer(token0).transfer(recipient, amountOut)) revert TransferFailed();
        }

        if ((pluginConfig & 2) != 0) {
            INestAlgebraPlugin(currentPlugin)
                .afterSwap(msg.sender, recipient, zeroToOne, amountRequired, limitSqrtPrice, amount0, amount1, "");
        }
    }
}

    /// @notice Non-official Algebra-compatible factory used only for HWA integration tests on chain 998.
    contract NestTestnetFactory is INestAlgebraFactory {
        address public immutable override owner;
        address public positionManager;
        address public router;
        mapping(bytes32 key => address pool) private _pools;

        error Unauthorized();
        error InvalidAddress();
        error InfrastructureAlreadySet();
        error PoolAlreadyExists();

        constructor(address owner_) {
            if (owner_ == address(0)) revert InvalidAddress();
            owner = owner_;
        }

        modifier onlyOwner() {
            if (msg.sender != owner) revert Unauthorized();
            _;
        }

        function setInfrastructure(address positionManager_, address router_) external onlyOwner {
            if (positionManager != address(0) || router != address(0)) revert InfrastructureAlreadySet();
            if (positionManager_.code.length == 0 || router_.code.length == 0) revert InvalidAddress();
            positionManager = positionManager_;
            router = router_;
        }

        function createPool(address tokenA, address tokenB) external override onlyOwner returns (address pool) {
            if (tokenA == address(0) || tokenB == address(0) || tokenA == tokenB) revert InvalidAddress();
            (address first, address second) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
            bytes32 key = _key(first, second);
            if (_pools[key] != address(0)) revert PoolAlreadyExists();
            pool = address(new NestTestnetPool(address(this), first, second));
            _pools[key] = pool;
        }

        function poolByPair(address tokenA, address tokenB) external view override returns (address pool) {
            return _pools[_key(tokenA, tokenB)];
        }

        function defaultTickspacing() external pure override returns (int24) {
            return 60;
        }

        function defaultFee() external pure override returns (uint16) {
            return 500;
        }

        function defaultCommunityFee() external pure override returns (uint16) {
            return 1_000;
        }

        function isPublicPoolCreationMode() external pure override returns (bool) {
            return false;
        }

        function _key(address tokenA, address tokenB) private pure returns (bytes32) {
            (address first, address second) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
            return keccak256(abi.encode(first, second));
        }
    }

        /// @notice Minimal position manager matching the Nest selectors consumed by HWA.
        contract NestTestnetPositionManager is INestPositionManager {
            address public immutable override factory;
            address public immutable override WNativeToken;

            uint256 public nextTokenId = 1;
            mapping(uint256 tokenId => address currentOwner) private _ownerOf;

            error InvalidPool();
            error InvalidMint();
            error Unauthorized();
            error TransferFailed();

            constructor(address factory_, address wrappedNative_) {
                factory = factory_;
                WNativeToken = wrappedNative_;
            }

            function createAndInitializePoolIfNecessary(address token0, address token1, uint160 sqrtPriceX96)
                external
                payable
                override
                returns (address pool)
            {
                pool = INestAlgebraFactory(factory).poolByPair(token0, token1);
                if (pool == address(0)) revert InvalidPool();
                (uint160 currentPrice,,,,,) = INestAlgebraPool(pool).globalState();
                if (currentPrice == 0) NestTestnetPool(pool).initializeTestnet(sqrtPriceX96);
            }

            function mint(MintParams calldata params)
                external
                payable
                override
                returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)
            {
                if (params.deadline != block.timestamp || params.recipient == address(0)) revert InvalidMint();
                address pool = INestAlgebraFactory(factory).poolByPair(params.token0, params.token1);
                if (pool == address(0)) revert InvalidPool();

                uint256 rawLiquidity = params.amount0Desired + params.amount1Desired;
                if (rawLiquidity == 0 || rawLiquidity > uint256(uint128(type(int128).max))) revert InvalidMint();
                liquidity = uint128(rawLiquidity);
                NestTestnetPool(pool)
                    .beforeMintTestnet(params.recipient, params.tickLower, params.tickUpper, int128(liquidity));

                if (params.amount0Desired != 0) {
                    if (!ITestnetERC20Transfer(params.token0).transferFrom(msg.sender, pool, params.amount0Desired)) {
                        revert TransferFailed();
                    }
                    amount0 = params.amount0Desired;
                }
                if (params.amount1Desired != 0) {
                    if (!ITestnetERC20Transfer(params.token1).transferFrom(msg.sender, pool, params.amount1Desired)) {
                        revert TransferFailed();
                    }
                    amount1 = params.amount1Desired;
                }

                tokenId = nextTokenId++;
                _ownerOf[tokenId] = params.recipient;
                NestTestnetPool(pool)
                    .afterMintTestnet(
                        params.recipient, params.tickLower, params.tickUpper, int128(liquidity), amount0, amount1
                    );
            }

            function collect(CollectParams calldata params)
                external
                payable
                override
                returns (uint256 amount0, uint256 amount1)
            {
                if (_ownerOf[params.tokenId] != msg.sender || params.recipient == address(0)) {
                    revert Unauthorized();
                }
                return (0, 0);
            }

            function ownerOf(uint256 tokenId) external view override returns (address currentOwner) {
                currentOwner = _ownerOf[tokenId];
                if (currentOwner == address(0)) revert InvalidMint();
            }
        }

            /// @notice Minimal exact-input router matching the Nest selector consumed by HWA.
            contract NestTestnetSwapRouter is INestSwapRouter {
                address public immutable override factory;
                address public immutable override WNativeToken;

                error InvalidSwap();
                error TransferFailed();

                constructor(address factory_, address wrappedNative_) {
                    factory = factory_;
                    WNativeToken = wrappedNative_;
                }

                function exactInputSingle(ExactInputSingleParams calldata params)
                    external
                    payable
                    override
                    returns (uint256 amountOut)
                {
                    if (params.deadline != block.timestamp || params.recipient == address(0) || params.amountIn == 0) {
                        revert InvalidSwap();
                    }
                    address pool = INestAlgebraFactory(factory).poolByPair(params.tokenIn, params.tokenOut);
                    if (pool == address(0)) revert InvalidSwap();

                    bool zeroToOne = params.tokenIn == INestAlgebraPool(pool).token0();
                    amountOut = NestTestnetPool(pool)
                        .swapTestnet(params.recipient, zeroToOne, int256(params.amountIn), params.limitSqrtPrice);
                    if (amountOut < params.amountOutMinimum) revert InvalidSwap();
                    if (!ITestnetERC20Transfer(params.tokenIn).transferFrom(msg.sender, pool, params.amountIn)) {
                        revert TransferFailed();
                    }
                }
            }
