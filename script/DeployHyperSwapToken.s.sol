// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {FWATokenHyperEVM} from "../src/hyperevm/FWATokenHyperEVM.sol";
import {FWATokenHyperEVMFactory} from "../src/hyperevm/FWATokenHyperEVMFactory.sol";

interface VmHyperSwapTokenDeploy {
    function envUint(string calldata name) external returns (uint256 value);
    function envInt(string calldata name) external returns (int256 value);
    function envAddress(string calldata name) external returns (address value);
    function envBool(string calldata name) external returns (bool value);
    function addr(uint256 privateKey) external returns (address keyAddr);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

/// @notice Phase 2A: atomically deploy the HWA token, initialize the HyperSwap pool and seed the LP NFT.
/// @dev The remaining 50% supply stays with the deployer for phase 2B allocation and wiring.
contract DeployHyperSwapToken {
    VmHyperSwapTokenDeploy internal constant vm =
        VmHyperSwapTokenDeploy(address(uint160(uint256(keccak256("hevm cheat code")))));

    uint256 internal constant HYPEREVM_TESTNET_CHAIN_ID = 998;
    address internal constant HYPERSWAP_FACTORY = 0x22B0768972bB7f1F5ea7a8740BB8f94b32483826;
    address internal constant HYPERSWAP_NFPM = 0x09Aca834543b5790DB7a52803d5F9d48c5b87e80;
    address internal constant WHYPE = 0xADcb2f358Eae6492F61A5F87eb8893d09391d160;

    event HyperSwapTokenDeployed(
        address indexed token,
        address indexed pool,
        uint256 indexed lpTokenId,
        address launchFactory,
        address deployer,
        address lpRecipient,
        int24 tickLower,
        int24 tickUpper
    );

    error WrongChain(uint256 actual);
    error TokenomicsNotConfirmed();
    error InvalidAddress();
    error InvalidRange();

    function run() external returns (FWATokenHyperEVM token, FWATokenHyperEVMFactory launchFactory) {
        if (block.chainid != HYPEREVM_TESTNET_CHAIN_ID) revert WrongChain(block.chainid);
        if (!vm.envBool("FWA_TOKENOMICS_CONFIRMED")) revert TokenomicsNotConfirmed();

        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);
        address lpRecipient = vm.envAddress("FWA_LP_RECIPIENT");
        if (lpRecipient == address(0)) revert InvalidAddress();

        uint256 rawSqrtPrice = vm.envUint("FWA_INITIAL_SQRT_PRICE_X96");
        int256 rawRangeWidth = vm.envInt("FWA_LP_RANGE_WIDTH_TICKS");
        if (rawSqrtPrice > type(uint160).max || rawRangeWidth <= 0 || rawRangeWidth > type(int24).max) {
            revert InvalidRange();
        }
        // forge-lint: disable-next-line(unsafe-typecast)
        uint160 sqrtPriceX96 = uint160(rawSqrtPrice); // bounded above
        // forge-lint: disable-next-line(unsafe-typecast)
        int24 rangeWidth = int24(rawRangeWidth); // bounded above and positive

        vm.startBroadcast(deployerKey);
        launchFactory = new FWATokenHyperEVMFactory(
            "Hyper World Assets",
            "HWA",
            1_000_000_000 ether,
            500_000_000 ether,
            HYPERSWAP_FACTORY,
            HYPERSWAP_NFPM,
            WHYPE,
            deployer,
            deployer,
            lpRecipient,
            sqrtPriceX96,
            rangeWidth
        );
        token = launchFactory.token();
        int24 tickLower = launchFactory.tickLower();
        int24 tickUpper = launchFactory.tickUpper();
        vm.stopBroadcast();

        emit HyperSwapTokenDeployed(
            address(token),
            token.pool(),
            token.lpTokenId(),
            address(launchFactory),
            deployer,
            lpRecipient,
            tickLower,
            tickUpper
        );
    }
}
