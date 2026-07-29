// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {ERC20} from "solady/src/tokens/ERC20.sol";

import {
    IHyperSwapV3Factory,
    IHyperSwapV3Pool,
    IHyperSwapV3PositionManager,
    IHyperSwapV3Router
} from "../../src/hyperevm/interfaces/IHyperSwapV3.sol";

interface IERC20MockTransfer {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

contract MockHyperSwapERC20 is ERC20 {
    string private _tokenName;
    string private _tokenSymbol;
    uint256 public launchHwaPerHypeX96 = 1 << 96;
    uint256 public twapHwaPerHypeX96 = 1 << 96;

    constructor(string memory name_, string memory symbol_) {
        _tokenName = name_;
        _tokenSymbol = symbol_;
    }

    function name() public view override returns (string memory) {
        return _tokenName;
    }

    function symbol() public view override returns (string memory) {
        return _tokenSymbol;
    }

    function setSeasonQuotes(uint256 launchQuoteX96, uint256 twapQuoteX96) external {
        launchHwaPerHypeX96 = launchQuoteX96;
        twapHwaPerHypeX96 = twapQuoteX96;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function burn(uint256 amount) external {
        _burn(msg.sender, amount);
    }

    function deposit() external payable {
        _mint(msg.sender, msg.value);
    }

    function withdraw(uint256 amount) external {
        _burn(msg.sender, amount);
        (bool sent,) = msg.sender.call{value: amount}("");
        require(sent);
    }

    function buy(address adapter, uint256 minOut, uint160 sqrtPriceLimitX96) external payable returns (uint256 out) {
        (bool ok, bytes memory result) = adapter.call{value: msg.value}(
            abi.encodeWithSignature("buyExactInput(uint256,uint160)", minOut, sqrtPriceLimitX96)
        );
        if (!ok) {
            assembly {
                revert(add(result, 32), mload(result))
            }
        }
        return abi.decode(result, (uint256));
    }
}

contract MockHyperSwapV3Pool is IHyperSwapV3Pool {
    address public immutable override token0;
    address public immutable override token1;
    uint24 public immutable override fee;
    int24 public immutable override tickSpacing;
    uint160 public sqrtPriceX96;
    int24 public currentTick;
    int24 public twapTick;
    uint64 public initializedAt;
    uint16 public observationCardinalityNext;

    constructor(address token0_, address token1_, uint24 fee_, int24 tickSpacing_) {
        token0 = token0_;
        token1 = token1_;
        fee = fee_;
        tickSpacing = tickSpacing_;
    }

    function initializeMock(uint160 sqrtPriceX96_) external {
        if (sqrtPriceX96 == 0) {
            sqrtPriceX96 = sqrtPriceX96_;
            initializedAt = uint64(block.timestamp);
        }
    }

    function setPriceMock(uint160 sqrtPriceX96_, int24 currentTick_, int24 twapTick_) external {
        sqrtPriceX96 = sqrtPriceX96_;
        currentTick = currentTick_;
        twapTick = twapTick_;
    }

    function slot0() external view override returns (uint160, int24, uint16, uint16, uint16, uint8, bool) {
        return (sqrtPriceX96, currentTick, 0, 1, observationCardinalityNext, 0, true);
    }

    function observe(uint32[] calldata secondsAgos)
        external
        view
        override
        returns (int56[] memory tickCumulatives, uint160[] memory secondsPerLiquidityCumulativeX128s)
    {
        require(secondsAgos.length == 2 && secondsAgos[1] == 0);
        require(block.timestamp >= uint256(initializedAt) + secondsAgos[0]);
        tickCumulatives = new int56[](2);
        secondsPerLiquidityCumulativeX128s = new uint160[](2);
        tickCumulatives[1] = int56(twapTick) * int56(uint56(secondsAgos[0]));
    }

    function increaseObservationCardinalityNext(uint16 next) external override {
        if (next > observationCardinalityNext) observationCardinalityNext = next;
    }
}

    contract MockHyperSwapV3Factory is IHyperSwapV3Factory {
        mapping(uint24 fee => int24 spacing) public override feeAmountTickSpacing;
        mapping(bytes32 key => address pool) private _pools;

        function setFeeAmount(uint24 fee, int24 spacing) external {
            feeAmountTickSpacing[fee] = spacing;
        }

        function setPool(address tokenA, address tokenB, uint24 fee, address pool) external {
            _pools[_key(tokenA, tokenB, fee)] = pool;
        }

        function getPool(address tokenA, address tokenB, uint24 fee) external view override returns (address pool) {
            return _pools[_key(tokenA, tokenB, fee)];
        }

        function _key(address tokenA, address tokenB, uint24 fee) private pure returns (bytes32) {
            (address token0, address token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
            return keccak256(abi.encode(token0, token1, fee));
        }
    }

        contract MockHypeSink {
            receive() external payable {}
        }

        contract MockHyperSwapV3PositionManager is IHyperSwapV3PositionManager {
            address public immutable override factory;
            address public immutable override WETH9;
            uint256 public nextTokenId = 1;
            mapping(uint256 tokenId => address owner) private _owners;
            uint256 public collectAmount0;
            uint256 public collectAmount1;

            MintParams public lastMintParams;

            constructor(address factory_, address whype_) {
                factory = factory_;
                WETH9 = whype_;
            }

            function createAndInitializePoolIfNecessary(
                address token0,
                address token1,
                uint24 fee,
                uint160 sqrtPriceX96
            ) external payable override returns (address pool) {
                pool = IHyperSwapV3Factory(factory).getPool(token0, token1, fee);
                if (pool == address(0)) {
                    int24 spacing = IHyperSwapV3Factory(factory).feeAmountTickSpacing(fee);
                    pool = address(new MockHyperSwapV3Pool(token0, token1, fee, spacing));
                    MockHyperSwapV3Factory(factory).setPool(token0, token1, fee, pool);
                }
                MockHyperSwapV3Pool(pool).initializeMock(sqrtPriceX96);
            }

            function mint(MintParams calldata params)
                external
                payable
                override
                returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)
            {
                require(params.deadline == block.timestamp && params.recipient != address(0));
                address pool = IHyperSwapV3Factory(factory).getPool(params.token0, params.token1, params.fee);
                require(pool != address(0));

                lastMintParams = params;
                if (params.amount0Desired != 0) {
                    require(IERC20MockTransfer(params.token0).transferFrom(msg.sender, pool, params.amount0Desired));
                    amount0 = params.amount0Desired;
                }
                if (params.amount1Desired != 0) {
                    require(IERC20MockTransfer(params.token1).transferFrom(msg.sender, pool, params.amount1Desired));
                    amount1 = params.amount1Desired;
                }

                uint256 rawLiquidity = amount0 + amount1;
                require(rawLiquidity <= type(uint128).max);
                liquidity = uint128(rawLiquidity);
                tokenId = nextTokenId++;
                _owners[tokenId] = params.recipient;
            }

            function setCollectAmounts(uint256 amount0, uint256 amount1) external {
                collectAmount0 = amount0;
                collectAmount1 = amount1;
            }

            function collect(CollectParams calldata params)
                external
                payable
                override
                returns (uint256 amount0, uint256 amount1)
            {
                require(msg.sender == _owners[params.tokenId]);
                require(params.recipient != address(0));
                amount0 = collectAmount0 > params.amount0Max ? params.amount0Max : collectAmount0;
                amount1 = collectAmount1 > params.amount1Max ? params.amount1Max : collectAmount1;
                collectAmount0 -= amount0;
                collectAmount1 -= amount1;
            }

            function ownerOf(uint256 tokenId) external view override returns (address owner) {
                owner = _owners[tokenId];
                require(owner != address(0));
            }
        }

            contract MockHyperSwapV3Router is IHyperSwapV3Router {
                address public immutable override factory;
                address public immutable override WETH9;
                MockHyperSwapERC20 public immutable token;
                address payable public immutable sink;

                uint256 public outputMultiplier = 2;
                uint256 public refundAmount;
                uint256 public reportedAmountOverride;
                uint256 public mintedAmountOverride;

                ExactInputSingleParams public lastParams;

                constructor(address factory_, address whype_, MockHyperSwapERC20 token_, address payable sink_) {
                    factory = factory_;
                    WETH9 = whype_;
                    token = token_;
                    sink = sink_;
                }

                function setSwapResult(
                    uint256 outputMultiplier_,
                    uint256 refundAmount_,
                    uint256 reportedAmountOverride_,
                    uint256 mintedAmountOverride_
                ) external {
                    outputMultiplier = outputMultiplier_;
                    refundAmount = refundAmount_;
                    reportedAmountOverride = reportedAmountOverride_;
                    mintedAmountOverride = mintedAmountOverride_;
                }

                function exactInputSingle(ExactInputSingleParams calldata params)
                    external
                    payable
                    override
                    returns (uint256 amountOut)
                {
                    require(params.tokenIn == WETH9 && params.tokenOut == address(token));
                    require(params.recipient != address(0));
                    require(params.deadline == block.timestamp);
                    require(refundAmount <= params.amountIn);

                    lastParams = params;

                    uint256 amountUsed = params.amountIn - refundAmount;
                    if (msg.value != 0) {
                        require(params.amountIn == msg.value);
                        if (amountUsed != 0) {
                            (bool sent,) = sink.call{value: amountUsed}("");
                            require(sent);
                        }
                    } else if (amountUsed != 0) {
                        require(IERC20MockTransfer(params.tokenIn).transferFrom(msg.sender, sink, amountUsed));
                    }

                    uint256 calculatedOut = amountUsed * outputMultiplier;
                    uint256 mintedOut = mintedAmountOverride == 0 ? calculatedOut : mintedAmountOverride;
                    if (mintedOut != 0) token.mint(params.recipient, mintedOut);
                    amountOut = reportedAmountOverride == 0 ? calculatedOut : reportedAmountOverride;
                }

                function refundETH() external payable override {
                    uint256 amount = address(this).balance;
                    if (amount != 0) {
                        (bool sent,) = msg.sender.call{value: amount}("");
                        require(sent);
                    }
                }

                receive() external payable {}
            }

                contract MockHyperSwapBuyer {
                    function buy(address adapter, uint256 minOut, uint160 sqrtPriceLimitX96)
                        external
                        payable
                        returns (uint256 out)
                    {
                        (bool ok, bytes memory result) = adapter.call{value: msg.value}(
                            abi.encodeWithSignature("buyExactInput(uint256,uint160)", minOut, sqrtPriceLimitX96)
                        );
                        if (!ok) {
                            assembly {
                                revert(add(result, 32), mload(result))
                            }
                        }
                        return abi.decode(result, (uint256));
                    }
                }

                contract MockFWATokenAdapter {
                    address public immutable TOKEN;
                    address public immutable WHYPE;
                    address public immutable POOL;
                    uint24 public immutable POOL_FEE;
                    address public immutable TOKEN_BUYER;

                    constructor(address token_, address whype_, address pool_, uint24 poolFee_) {
                        TOKEN = token_;
                        WHYPE = whype_;
                        POOL = pool_;
                        POOL_FEE = poolFee_;
                        TOKEN_BUYER = token_;
                    }

                    function buyExactInput(uint256 minOut, uint160 sqrtPriceLimitX96)
                        external
                        payable
                        returns (uint256 tokenOut)
                    {
                        require(msg.sender == TOKEN_BUYER);
                        (uint160 currentSqrtPriceX96,,,,,,) = IHyperSwapV3Pool(POOL).slot0();
                        bool whypeIsToken0 = IHyperSwapV3Pool(POOL).token0() == WHYPE;
                        require(
                            whypeIsToken0
                                ? sqrtPriceLimitX96 < currentSqrtPriceX96
                                : sqrtPriceLimitX96 > currentSqrtPriceX96,
                            "SPL"
                        );
                        tokenOut = msg.value * 2;
                        require(tokenOut >= minOut);
                        require(IERC20MockTransfer(TOKEN).transfer(msg.sender, tokenOut));
                    }
                }

                contract MockFWABuybackRouter {
                    uint256 public depositorAmount;
                    uint256 public purchaserAmount;

                    function onTokenReceived(uint256 depositorAmt, uint256 purchaserAmt) external {
                        depositorAmount += depositorAmt;
                        purchaserAmount += purchaserAmt;
                    }
                }
