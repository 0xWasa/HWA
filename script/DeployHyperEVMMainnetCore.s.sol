// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {FWA} from "fwa-reference/src/FWA.sol";
import {FWAConfigKeys} from "fwa-reference/src/FWAConfigKeys.sol";
import {FWAVRFService} from "fwa-vrf-reference/src/FWAVRFService.sol";
import {FWAWhitelist} from "fwa-whitelist-reference/src/FWAWhitelist.sol";

import {DrandBN254Coordinator} from "../src/hyperevm/DrandBN254Coordinator.sol";
import {DrandEvmnetRegistry} from "../src/hyperevm/DrandEvmnetRegistry.sol";
import {SplitterHyperEVM} from "../src/hyperevm/SplitterHyperEVM.sol";

interface VmDeployHyperEVMMainnet {
    function envUint(string calldata name) external returns (uint256 value);
    function envAddress(string calldata name) external returns (address value);
    function envBool(string calldata name) external returns (bool value);
    function addr(uint256 privateKey) external returns (address keyAddr);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

/// @notice Deploys the FWA core on HyperEVM mainnet in a paused, fail-closed state.
/// @dev The permissionless drand relayers, source verification, collection review and every
///      downstream module are separate release gates. This script never enables acquisitions.
contract DeployHyperEVMMainnetCore {
    VmDeployHyperEVMMainnet internal constant vm =
        VmDeployHyperEVMMainnet(address(uint160(uint256(keccak256("hevm cheat code")))));

    uint256 internal constant HYPEREVM_MAINNET_CHAIN_ID = 999;
    bytes32 internal constant DRAND_KEY_HASH = keccak256("DRAND_EVMNET_BN254_HYPEREVM_MAINNET_V1");
    uint256 internal constant MIN_CALLBACK_GAS_LIMIT = 150_000;
    uint256 internal constant MAX_CALLBACK_GAS_LIMIT = 2_500_000;
    uint256 internal constant MIN_RANDOMNESS_ROUND_DELAY_SECONDS = 30;

    event MainnetCoreDeployed(
        uint256 indexed chainId,
        address indexed finalOwner,
        address indexed drandRegistry,
        address fwa,
        address vrfService,
        address drandCoordinator,
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
        if (block.chainid != HYPEREVM_MAINNET_CHAIN_ID) {
            revert WrongChain(block.chainid);
        }
        if (!vm.envBool("MAINNET_DEPLOYMENT_CONFIRMED")) revert DeploymentNotConfirmed();

        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);
        address finalOwner = vm.envAddress("FWA_OWNER");
        address splitter = vm.envAddress("FWA_SPLITTER_ADDRESS");
        if (finalOwner == address(0) || finalOwner.code.length == 0) revert InvalidOwner();
        if (
            splitter == address(0) || splitter.code.length == 0
                || SplitterHyperEVM(payable(splitter)).owner() != finalOwner
        ) revert InvalidSplitter();

        uint256 minimumBuffer = vm.envUint("FWA_MIN_RANDOMNESS_BUFFER_WEI");
        uint256 maxFulfillmentCost = vm.envUint("FWA_MAX_RANDOMNESS_COST_WEI");
        uint256 gasEstimate = vm.envUint("FWA_RANDOMNESS_GAS_ESTIMATE");
        uint256 marginBps = vm.envUint("FWA_RANDOMNESS_MARGIN_BPS");
        uint256 flatWei = vm.envUint("FWA_RANDOMNESS_FLAT_WEI");
        uint256 callbackGasLimit = vm.envUint("FWA_RANDOMNESS_CALLBACK_GAS_LIMIT");
        uint256 minRoundDelaySeconds = vm.envUint("FWA_RANDOMNESS_MIN_ROUND_DELAY_SECONDS");
        uint256 requestExpiryBlocks = vm.envUint("FWA_RANDOMNESS_REQUEST_EXPIRY_BLOCKS");
        uint256 fulfillmentBounty = vm.envUint("FWA_RANDOMNESS_FULFILLMENT_BOUNTY_WEI");
        uint256 initialReserve = vm.envUint("FWA_RANDOMNESS_INITIAL_RESERVE_WEI");
        uint256 maxLivenessAgeSeconds = vm.envUint("FWA_RANDOMNESS_MAX_LIVENESS_AGE_SECONDS");
        uint256 selectionTimeoutBlocks = vm.envUint("FWA_SELECTION_TIMEOUT_BLOCKS");
        uint256 minBacking = vm.envUint("FWA_MIN_BACKING_WEI");
        uint256 protocolFeeToTokenBps = vm.envUint("FWA_PROTOCOL_FEE_TO_TOKEN_BPS");
        if (
            callbackGasLimit < MIN_CALLBACK_GAS_LIMIT || callbackGasLimit > MAX_CALLBACK_GAS_LIMIT
                || callbackGasLimit > type(uint32).max || minRoundDelaySeconds < MIN_RANDOMNESS_ROUND_DELAY_SECONDS
                || minRoundDelaySeconds > type(uint64).max || requestExpiryBlocks > type(uint64).max
                || requestExpiryBlocks <= selectionTimeoutBlocks || maxLivenessAgeSeconds > type(uint64).max
                || maxLivenessAgeSeconds < 3 || fulfillmentBounty > type(uint96).max
                || fulfillmentBounty > maxFulfillmentCost || initialReserve < minimumBuffer + maxFulfillmentCost
                || initialReserve > type(uint96).max || selectionTimeoutBlocks == 0 || minBacking == 0
                || protocolFeeToTokenBps > 10_000
        ) revert InvalidConfig();

        vm.startBroadcast(deployerKey);

        registry = new DrandEvmnetRegistry();
        coordinator = new DrandBN254Coordinator(
            address(registry),
            deployer,
            uint64(minRoundDelaySeconds),
            uint64(requestExpiryBlocks),
            uint64(maxLivenessAgeSeconds),
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
        service.setFeeConfig(gasEstimate, marginBps, flatWei);
        fwa.setAddr(FWAConfigKeys.WHITELIST_MANAGER, address(whitelist));
        fwa.setAddr(FWAConfigKeys.PAYOUT_ADDRESS, splitter);
        fwa.setUint(FWAConfigKeys.TOP_LISTING_SHARE_BPS, 100);
        fwa.setUint(FWAConfigKeys.SELECTION_TIMEOUT_BLOCKS, selectionTimeoutBlocks);
        // Keep both the request and callback paths below HyperEVM's 2M small-block budget. One
        // reserved activation is processed in a separate canonical settlement transaction.
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

        emit MainnetCoreDeployed(
            block.chainid,
            finalOwner,
            address(registry),
            address(fwa),
            address(service),
            address(coordinator),
            address(whitelist),
            splitter
        );
    }
}
