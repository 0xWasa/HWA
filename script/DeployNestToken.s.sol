// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {FWANestLiquidityLocker} from "../src/hyperevm/FWANestLiquidityLocker.sol";
import {FWATokenNest} from "../src/hyperevm/FWATokenNest.sol";

interface VmNestTokenDeploy {
    function envUint(string calldata name) external returns (uint256 value);
    function envAddress(string calldata name) external returns (address value);
    function envBool(string calldata name) external returns (bool value);
    function envOr(string calldata name, address defaultValue) external returns (address value);
    function addr(uint256 privateKey) external returns (address keyAddr);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

/// @notice Nest phase A: deploy the token and its immutable-liquidity NFT locker.
contract DeployNestToken {
    VmNestTokenDeploy internal constant vm = VmNestTokenDeploy(address(uint160(uint256(keccak256("hevm cheat code")))));

    uint256 internal constant HYPEREVM_TESTNET_CHAIN_ID = 998;
    uint256 internal constant HYPEREVM_MAINNET_CHAIN_ID = 999;

    address internal constant NEST_MAINNET_FACTORY = 0xF77Bd082c627aA54591cF2f2EaA811fd1AB3b1F3;
    address internal constant NEST_MAINNET_NFPM = 0xEAF58788a405F3253814b4559391a22bE8616250;
    address internal constant MAINNET_WHYPE = 0x5555555555555555555555555555555555555555;

    event NestTokenPrepared(
        uint256 indexed chainId,
        address indexed token,
        address indexed liquidityLocker,
        address deployer,
        address factory,
        address positionManager,
        address whype,
        address feeRecipient
    );

    error WrongChain(uint256 actual);
    error MainnetNotConfirmed();
    error TokenomicsNotConfirmed();
    error InvalidAddress();
    error InvalidContract();

    function run() external returns (FWATokenNest token, FWANestLiquidityLocker locker) {
        if (block.chainid != HYPEREVM_TESTNET_CHAIN_ID && block.chainid != HYPEREVM_MAINNET_CHAIN_ID) {
            revert WrongChain(block.chainid);
        }
        if (!vm.envBool("FWA_TOKENOMICS_CONFIRMED")) revert TokenomicsNotConfirmed();
        if (block.chainid == HYPEREVM_MAINNET_CHAIN_ID && !vm.envBool("NEST_MAINNET_DEPLOYMENT_CONFIRMED")) {
            revert MainnetNotConfirmed();
        }

        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);
        address finalOwner =
            block.chainid == HYPEREVM_MAINNET_CHAIN_ID ? vm.envAddress("FWA_OWNER") : vm.envOr("FWA_OWNER", deployer);
        address feeRecipient = vm.envAddress("FWA_NEST_FEE_RECIPIENT");

        address defaultFactory = block.chainid == HYPEREVM_MAINNET_CHAIN_ID ? NEST_MAINNET_FACTORY : address(0);
        address defaultNfpm = block.chainid == HYPEREVM_MAINNET_CHAIN_ID ? NEST_MAINNET_NFPM : address(0);
        address defaultWhype = block.chainid == HYPEREVM_MAINNET_CHAIN_ID ? MAINNET_WHYPE : address(0);
        address factory = vm.envOr("NEST_FACTORY", defaultFactory);
        address positionManager = vm.envOr("NEST_POSITION_MANAGER", defaultNfpm);
        address whype = vm.envOr("NEST_WHYPE", defaultWhype);

        if (
            deployer == address(0) || finalOwner == address(0) || feeRecipient == address(0) || factory == address(0)
                || positionManager == address(0) || whype == address(0)
        ) revert InvalidAddress();
        if (factory.code.length == 0 || positionManager.code.length == 0 || whype.code.length == 0) {
            revert InvalidContract();
        }
        if (block.chainid == HYPEREVM_MAINNET_CHAIN_ID && finalOwner.code.length == 0) revert InvalidContract();

        vm.startBroadcast(deployerKey);
        token = new FWATokenNest(
            "Hyper World Assets",
            "HWA",
            1_000_000_000 ether,
            500_000_000 ether,
            factory,
            positionManager,
            whype,
            deployer
        );
        locker = new FWANestLiquidityLocker(positionManager, address(token), feeRecipient, finalOwner);
        token.setDistributor(feeRecipient, true);
        vm.stopBroadcast();

        emit NestTokenPrepared(
            block.chainid, address(token), address(locker), deployer, factory, positionManager, whype, feeRecipient
        );
    }
}
