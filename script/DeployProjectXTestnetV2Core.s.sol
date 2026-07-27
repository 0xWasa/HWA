// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {FWA} from "fwa-reference/src/FWA.sol";
import {FWAConfigKeys} from "fwa-reference/src/FWAConfigKeys.sol";
import {FWAVRFService} from "fwa-vrf-reference/src/FWAVRFService.sol";
import {FWAWhitelist} from "fwa-whitelist-reference/src/FWAWhitelist.sol";

import {DrandBN254Coordinator} from "../src/hyperevm/DrandBN254Coordinator.sol";
import {DrandEvmnetRegistry} from "../src/hyperevm/DrandEvmnetRegistry.sol";
import {SplitterHyperEVM} from "../src/hyperevm/SplitterHyperEVM.sol";

interface VmProjectXTestnetV2Core {
    function envUint(string calldata name) external returns (uint256 value);
    function envOr(string calldata name, uint256 defaultValue) external returns (uint256 value);
    function envOr(string calldata name, address defaultValue) external returns (address value);
    function envAddress(string calldata name) external returns (address value);
    function envBool(string calldata name) external returns (bool value);
    function addr(uint256 privateKey) external returns (address keyAddr);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

/// @notice Deploys the chain-998 release candidate with the exact permissionless BN254 drand path used on mainnet.
/// @dev Acquisitions remain closed and a recent verified beacon proof is still required before activation.
contract DeployProjectXTestnetV2Core {
    VmProjectXTestnetV2Core internal constant vm =
        VmProjectXTestnetV2Core(address(uint160(uint256(keccak256("hevm cheat code")))));

    uint256 internal constant TESTNET = 998;
    bytes32 internal constant DRAND_KEY_HASH = keccak256("DRAND_EVMNET_BN254_HYPEREVM_MAINNET_V1");

    event ProjectXTestnetV2CoreDeployed(
        address indexed finalOwner,
        address indexed fwa,
        address indexed coordinator,
        address registry,
        address vrfService,
        address whitelist,
        address splitter
    );

    error WrongChain(uint256 actual);
    error DeploymentNotConfirmed();
    error InvalidOwner();
    error InvalidSplitter();
    error InvalidConfig();

    function run()
        external
        returns (
            FWA fwa,
            FWAVRFService service,
            DrandEvmnetRegistry registry,
            DrandBN254Coordinator coordinator,
            FWAWhitelist whitelist
        )
    {
        if (block.chainid != TESTNET) revert WrongChain(block.chainid);
        if (!vm.envBool("FWA_TESTNET_V2_CORE_DEPLOYMENT_CONFIRMED")) revert DeploymentNotConfirmed();

        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);
        address finalOwner = vm.envOr("FWA_OWNER", deployer);
        address splitterAddress = vm.envAddress("FWA_SPLITTER_ADDRESS");
        if (finalOwner == address(0)) revert InvalidOwner();
        if (
            splitterAddress == address(0) || splitterAddress.code.length == 0
                || SplitterHyperEVM(payable(splitterAddress)).owner() != finalOwner
        ) revert InvalidSplitter();

        uint256 minimumBuffer = vm.envOr("FWA_MIN_RANDOMNESS_BUFFER_WEI", uint256(1));
        uint256 maxFulfillmentCost = vm.envOr("FWA_MAX_RANDOMNESS_COST_WEI", uint256(1));
        uint256 callbackGasLimit = vm.envOr("FWA_RANDOMNESS_CALLBACK_GAS_LIMIT", uint256(900_000));
        uint256 minRoundDelay = vm.envOr("FWA_RANDOMNESS_MIN_ROUND_DELAY_SECONDS", uint256(30));
        uint256 expiryBlocks = vm.envOr("FWA_RANDOMNESS_REQUEST_EXPIRY_BLOCKS", uint256(7_200));
        uint256 maxLivenessAge = vm.envOr("FWA_RANDOMNESS_MAX_LIVENESS_AGE_SECONDS", uint256(900));
        uint256 fulfillmentBounty = vm.envOr("FWA_RANDOMNESS_FULFILLMENT_BOUNTY_WEI", uint256(1));
        uint256 initialReserve = vm.envOr("FWA_RANDOMNESS_INITIAL_RESERVE_WEI", uint256(1_000));
        uint256 selectionTimeout = vm.envOr("FWA_SELECTION_TIMEOUT_BLOCKS", uint256(3_600));
        uint256 minBacking = vm.envOr("FWA_MIN_BACKING_WEI", uint256(0.01 ether));
        uint256 protocolFeeToTokenBps = vm.envOr("FWA_PROTOCOL_FEE_TO_TOKEN_BPS", uint256(8_000));
        if (
            callbackGasLimit < 150_000 || callbackGasLimit > 2_500_000 || callbackGasLimit > type(uint32).max
                || minRoundDelay < 30 || minRoundDelay > type(uint64).max || expiryBlocks > type(uint64).max
                || expiryBlocks <= selectionTimeout || maxLivenessAge < 3 || maxLivenessAge > type(uint64).max
                || fulfillmentBounty > type(uint96).max || fulfillmentBounty > maxFulfillmentCost
                || initialReserve < minimumBuffer + maxFulfillmentCost || initialReserve > type(uint96).max
                || selectionTimeout == 0 || minBacking == 0 || protocolFeeToTokenBps > 10_000
        ) revert InvalidConfig();

        vm.startBroadcast(deployerKey);
        registry = new DrandEvmnetRegistry();
        coordinator = new DrandBN254Coordinator(
            address(registry),
            deployer,
            uint64(minRoundDelay),
            uint64(expiryBlocks),
            uint64(maxLivenessAge),
            uint96(fulfillmentBounty)
        );
        service = new FWAVRFService(minimumBuffer, maxFulfillmentCost);
        fwa = new FWA(
            address(coordinator),
            coordinator.SUBSCRIPTION_ID(),
            DRAND_KEY_HASH,
            uint32(callbackGasLimit),
            address(service)
        );
        whitelist = new FWAWhitelist(address(fwa), address(0), 0, deployer);

        coordinator.setConsumer(address(fwa));
        coordinator.fundSubscriptionWithNative{value: initialReserve}(coordinator.SUBSCRIPTION_ID());
        service.setFWA(address(fwa));
        service.setFeeConfig(
            vm.envOr("FWA_RANDOMNESS_GAS_ESTIMATE", uint256(800_000)),
            vm.envOr("FWA_RANDOMNESS_MARGIN_BPS", uint256(3_000)),
            vm.envOr("FWA_RANDOMNESS_FLAT_WEI", uint256(0))
        );
        fwa.setAddr(FWAConfigKeys.WHITELIST_MANAGER, address(whitelist));
        fwa.setAddr(FWAConfigKeys.PAYOUT_ADDRESS, splitterAddress);
        fwa.setUint(FWAConfigKeys.TOP_LISTING_SHARE_BPS, 100);
        fwa.setUint(FWAConfigKeys.SELECTION_TIMEOUT_BLOCKS, selectionTimeout);
        fwa.setUint(FWAConfigKeys.MAX_ACQUISITIONS_PER_TX, 1);
        fwa.setUint(FWAConfigKeys.MAX_ACTIVATIONS_PER_ACQUISITION, 1);
        fwa.setUint(FWAConfigKeys.MIN_BACKING, minBacking);
        fwa.setUint(FWAConfigKeys.PROTOCOL_FEE_TO_TOKEN_BPS, protocolFeeToTokenBps);
        fwa.setBool(FWAConfigKeys.REWARDS_REQUIRED_FOR_ACTIVATION, true);

        if (finalOwner != deployer) {
            coordinator.transferOwnership(finalOwner);
            service.transferOwnership(finalOwner);
            whitelist.transferOwnership(finalOwner);
            fwa.transferOwnership(finalOwner);
        }
        vm.stopBroadcast();

        emit ProjectXTestnetV2CoreDeployed(
            finalOwner,
            address(fwa),
            address(coordinator),
            address(registry),
            address(service),
            address(whitelist),
            splitterAddress
        );
    }
}

