// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {FWA} from "fwa-reference/src/FWA.sol";

import {DrandBN254Coordinator} from "../src/hyperevm/DrandBN254Coordinator.sol";
import {DrandEvmnetRegistry} from "../src/hyperevm/DrandEvmnetRegistry.sol";
import {BLS} from "../src/vendor/randamu-bls/BLS.sol";

interface VmVerifyDrandBN254 {
    function envAddress(string calldata name) external view returns (address value);
    function envUint(string calldata name) external view returns (uint256 value);
}

/// @notice Read-only chain-998/999 attestation for permissionless, on-chain verified drand evmnet.
contract VerifyDrandBN254Coordinator {
    VmVerifyDrandBN254 internal constant vm =
        VmVerifyDrandBN254(address(uint160(uint256(keccak256("hevm cheat code")))));

    bytes32 internal constant EVMNET_CHAIN_HASH = 0x04f1e9062b8a81f848fded9c12306733282b2727ecced50032187751166ec8c3;
    uint256 internal constant EVMNET_PK_X0 = 0x557ec32c2ad488e4d4f6008f89a346f18492092ccc0d594610de2732c8b808f;
    uint256 internal constant EVMNET_PK_X1 = 0x7e1d1d335df83fa98462005690372c643340060d205306a9aa8106b6bd0b382;
    uint256 internal constant EVMNET_PK_Y0 = 0x297d3a4f9749b33eb2d904c9d9ebf17224150ddd7abd7567a9bec6c74480ee0b;
    uint256 internal constant EVMNET_PK_Y1 = 0x95685ae3a85ba243747b1b2f426049010f6b73a0cf1d389351d5aaaa1047f6;

    error WrongChain(uint256 actual);
    error MissingCode(address target);
    error InvalidWiring();

    function run() external view {
        if (block.chainid != 998 && block.chainid != 999) revert WrongChain(block.chainid);

        FWA fwa = FWA(vm.envAddress("FWA_ADDRESS"));
        DrandEvmnetRegistry registry = DrandEvmnetRegistry(vm.envAddress("FWA_DRAND_REGISTRY_ADDRESS"));
        DrandBN254Coordinator coordinator =
            DrandBN254Coordinator(payable(vm.envAddress("FWA_DRAND_BN254_COORDINATOR_ADDRESS")));
        if (address(fwa).code.length == 0) revert MissingCode(address(fwa));
        if (address(registry).code.length == 0) revert MissingCode(address(registry));
        if (address(coordinator).code.length == 0) revert MissingCode(address(coordinator));

        (address activeCoordinator, uint256 subId) = fwa.vrfCoordinatorAndSubId();
        (,,, address subscriptionOwner, address[] memory consumers) = coordinator.getSubscription(subId);
        uint256 expectedStart = uint256(
            keccak256(
                abi.encode(coordinator.DERIVATION_DOMAIN(), block.chainid, address(coordinator), address(registry))
            )
        );
        uint256 requiredInitialReserve =
            vm.envUint("FWA_MIN_RANDOMNESS_BUFFER_WEI") + vm.envUint("FWA_MAX_RANDOMNESS_COST_WEI");
        BLS.PointG2 memory publicKey = registry.publicKey();
        if (
            activeCoordinator != address(coordinator) || subId != coordinator.SUBSCRIPTION_ID()
                || address(coordinator.REGISTRY()) != address(registry)
                || coordinator.DRAND_CHAIN_HASH() != EVMNET_CHAIN_HASH
                || registry.DRAND_CHAIN_HASH() != EVMNET_CHAIN_HASH || coordinator.consumer() != address(fwa)
                || publicKey.x[0] != EVMNET_PK_X0 || publicKey.x[1] != EVMNET_PK_X1 || publicKey.y[0] != EVMNET_PK_Y0
                || publicKey.y[1] != EVMNET_PK_Y1 || coordinator.MIN_DELAY_SECONDS() != 30
                || coordinator.owner() != fwa.owner() || subscriptionOwner != fwa.owner() || consumers.length != 1
                || consumers[0] != address(fwa)
                || coordinator.MIN_ROUND_DELAY_SECONDS() != vm.envUint("FWA_RANDOMNESS_MIN_ROUND_DELAY_SECONDS")
                || coordinator.REQUEST_EXPIRY_BLOCKS() != vm.envUint("FWA_RANDOMNESS_REQUEST_EXPIRY_BLOCKS")
                || coordinator.MAX_LIVENESS_AGE_SECONDS() != vm.envUint("FWA_RANDOMNESS_MAX_LIVENESS_AGE_SECONDS")
                || coordinator.FULFILLMENT_BOUNTY_WEI() != vm.envUint("FWA_RANDOMNESS_FULFILLMENT_BOUNTY_WEI")
                || coordinator.START_REQUEST_ID() != expectedStart
                || coordinator.nextRequestId() < coordinator.START_REQUEST_ID()
                || coordinator.nativeSubscriptionBalance() < requiredInitialReserve || !coordinator.launchReady()
        ) revert InvalidWiring();
    }
}
