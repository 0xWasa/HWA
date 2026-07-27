// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {ERC20} from "solady/src/tokens/ERC20.sol";

import {
    INestAlgebraFactory,
    INestAlgebraPlugin,
    INestAlgebraPool,
    INestPositionManager,
    INestSwapRouter
} from "../../src/hyperevm/interfaces/INestAlgebra.sol";

interface IMockNestERC20Transfer {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

contract MockNestERC20 is ERC20 {
    string private _mockName;
    string private _mockSymbol;

    constructor(string memory name_, string memory symbol_) {
        _mockName = name_;
        _mockSymbol = symbol_;
    }

    function name() public view override returns (string memory) {
        return _mockName;
    }

    function symbol() public view override returns (string memory) {
        return _mockSymbol;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function deposit() external payable {
        _mint(msg.sender, msg.value);
    }

    function withdraw(uint256 amount) external {
        _burn(msg.sender, amount);
        (bool sent,) = msg.sender.call{value: amount}("");
        require(sent);
    }
}

contract MockNestAlgebraPool is INestAlgebraPool {
    address public immutable override factory;
    address public immutable override token0;
    address public immutable override token1;

    uint16 public override fee = 500;
    int24 public override tickSpacing = 60;
    address public override plugin;
    uint160 public price;
    int24 public currentTick;
    uint8 public pluginConfig;
    uint16 public communityFee = 1000;
    bool public unlocked = true;

    constructor(address factory_, address token0_, address token1_) {
        factory = factory_;
        token0 = token0_;
        token1 = token1_;
    }

    function globalState() external view override returns (uint160, int24, uint16, uint8, uint16, bool) {
        return (price, currentTick, fee, pluginConfig, communityFee, unlocked);
    }

    function setFee(uint16 newFee) external override {
        fee = newFee;
    }

    function setCommunityFee(uint16 newCommunityFee) external override {
        communityFee = newCommunityFee;
    }

    function setTickSpacing(int24 newTickSpacing) external override {
        tickSpacing = newTickSpacing;
    }

    function setPlugin(address newPluginAddress) external override {
        plugin = newPluginAddress;
    }

    function setPluginConfig(uint8 newConfig) external override {
        pluginConfig = newConfig;
    }

    function initializeMock(uint160 initialPrice) external {
        require(price == 0);
        if (plugin != address(0)) INestAlgebraPlugin(plugin).beforeInitialize(msg.sender, initialPrice);
        price = initialPrice;
        fee = INestAlgebraFactory(factory).defaultFee();
        tickSpacing = INestAlgebraFactory(factory).defaultTickspacing();
        communityFee = INestAlgebraFactory(factory).defaultCommunityFee();
    }

    function beforeMintMock(address recipient, int128 liquidityDelta) external {
        if ((pluginConfig & 4) != 0) {
            INestAlgebraPlugin(plugin).beforeModifyPosition(msg.sender, recipient, -60, 60, liquidityDelta, "");
        }
    }

    function afterMintMock(address recipient, int128 liquidityDelta, uint256 amount0, uint256 amount1) external {
        if ((pluginConfig & 8) != 0) {
            INestAlgebraPlugin(plugin)
                .afterModifyPosition(msg.sender, recipient, -60, 60, liquidityDelta, amount0, amount1, "");
        }
    }

    function swapMock(address recipient, bool zeroToOne, int256 amountRequired, uint160 limitSqrtPrice)
        external
        returns (uint256 amountOut)
    {
        if ((pluginConfig & 1) != 0) {
            INestAlgebraPlugin(plugin)
                .beforeSwap(msg.sender, recipient, zeroToOne, amountRequired, limitSqrtPrice, false, "");
        }
        require(amountRequired > 0);
        amountOut = uint256(amountRequired) * 2;

        int256 amount0;
        int256 amount1;
        if (zeroToOne) {
            amount0 = amountRequired;
            amount1 = -int256(amountOut);
            require(IMockNestERC20Transfer(token1).transfer(recipient, amountOut));
        } else {
            amount0 = -int256(amountOut);
            amount1 = amountRequired;
            require(IMockNestERC20Transfer(token0).transfer(recipient, amountOut));
        }

        if ((pluginConfig & 2) != 0) {
            INestAlgebraPlugin(plugin)
                .afterSwap(msg.sender, recipient, zeroToOne, amountRequired, limitSqrtPrice, amount0, amount1, "");
        }
    }
}

    contract MockNestAlgebraFactory is INestAlgebraFactory {
        mapping(bytes32 key => address pool) private _pools;

        function owner() external view override returns (address currentOwner) {
            return address(this);
        }

        function createPool(address tokenA, address tokenB) external override returns (address pool) {
            (address token0, address token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
            bytes32 key = _key(token0, token1);
            require(_pools[key] == address(0));
            pool = address(new MockNestAlgebraPool(address(this), token0, token1));
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
            return 1000;
        }

        function isPublicPoolCreationMode() external pure override returns (bool) {
            return false;
        }

        function _key(address tokenA, address tokenB) private pure returns (bytes32) {
            (address token0, address token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
            return keccak256(abi.encode(token0, token1));
        }
    }

    contract MockNestPositionManager is INestPositionManager {
        address public immutable override factory;
        address public immutable override WNativeToken;

        uint256 public nextTokenId = 1;
        mapping(uint256 tokenId => address owner) private _ownerOf;

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
            require(pool != address(0));
            (uint160 price,,,,,) = INestAlgebraPool(pool).globalState();
            if (price == 0) MockNestAlgebraPool(pool).initializeMock(sqrtPriceX96);
        }

        function mint(MintParams calldata params)
            external
            payable
            override
            returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)
        {
            require(params.deadline == block.timestamp && params.recipient != address(0));
            address pool = INestAlgebraFactory(factory).poolByPair(params.token0, params.token1);
            require(pool != address(0));

            uint256 rawLiquidity = params.amount0Desired + params.amount1Desired;
            require(rawLiquidity != 0 && rawLiquidity <= type(uint128).max);
            liquidity = uint128(rawLiquidity);
            MockNestAlgebraPool(pool).beforeMintMock(params.recipient, int128(liquidity));

            if (params.amount0Desired != 0) {
                require(IMockNestERC20Transfer(params.token0).transferFrom(msg.sender, pool, params.amount0Desired));
                amount0 = params.amount0Desired;
            }
            if (params.amount1Desired != 0) {
                require(IMockNestERC20Transfer(params.token1).transferFrom(msg.sender, pool, params.amount1Desired));
                amount1 = params.amount1Desired;
            }

            tokenId = nextTokenId++;
            _ownerOf[tokenId] = params.recipient;
            MockNestAlgebraPool(pool).afterMintMock(params.recipient, int128(liquidity), amount0, amount1);
        }

        function collect(CollectParams calldata params)
            external
            payable
            override
            returns (uint256 amount0, uint256 amount1)
        {
            require(_ownerOf[params.tokenId] == msg.sender);
            require(params.recipient != address(0));
            return (0, 0);
        }

        function ownerOf(uint256 tokenId) external view override returns (address owner) {
            owner = _ownerOf[tokenId];
            require(owner != address(0));
        }
    }

        contract MockNestSwapRouter is INestSwapRouter {
            address public immutable override factory;
            address public immutable override WNativeToken;

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
                require(params.deadline == block.timestamp && params.recipient != address(0));
                address pool = INestAlgebraFactory(factory).poolByPair(params.tokenIn, params.tokenOut);
                require(pool != address(0));

                bool zeroToOne = params.tokenIn == INestAlgebraPool(pool).token0();
                amountOut = MockNestAlgebraPool(pool)
                    .swapMock(params.recipient, zeroToOne, int256(params.amountIn), params.limitSqrtPrice);
                require(amountOut >= params.amountOutMinimum);
                require(IMockNestERC20Transfer(params.tokenIn).transferFrom(msg.sender, pool, params.amountIn));
            }
        }
