// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {FWA} from "fwa-reference/src/FWA.sol";
import {FWAConfigKeys} from "fwa-reference/src/FWAConfigKeys.sol";
import {FWAVRFService} from "fwa-vrf-reference/src/FWAVRFService.sol";
import {FWAWhitelist} from "fwa-whitelist-reference/src/FWAWhitelist.sol";

import {DrandRelayCoordinator} from "../src/hyperevm/DrandRelayCoordinator.sol";
import {SplitterHyperEVM} from "../src/hyperevm/SplitterHyperEVM.sol";

interface VmProjectXResumeCore {
    function envUint(string calldata name) external returns (uint256 value);
    function envAddress(string calldata name) external returns (address value);
    function envOr(string calldata name, uint256 defaultValue) external returns (uint256 value);
    function envOr(string calldata name, address defaultValue) external returns (address value);
    function addr(uint256 privateKey) external returns (address keyAddr);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

/// @notice Resumes a chain-998 release after the coordinator and VRF service were mined before the big FWA tx.
contract ResumeProjectXTestnetCore {
    VmProjectXResumeCore internal constant vm =
        VmProjectXResumeCore(address(uint160(uint256(keccak256("hevm cheat code")))));
    uint256 internal constant TESTNET = 998;
    bytes32 internal constant DRAND_KEY_HASH = keccak256("DRAND_RELAY_HYPEREVM_TESTNET_V2");

    event ProjectXTestnetCoreResumed(
        address indexed finalOwner,
        address indexed fwa,
        address indexed coordinator,
        address vrfService,
        address whitelist,
        address splitter
    );

    error WrongChain(uint256 actual);
    error InvalidExistingDeployment();
    error InvalidConfig();

    function run() external returns (FWA fwa, FWAWhitelist whitelist) {
        if (block.chainid != TESTNET) revert WrongChain(block.chainid);
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);
        address finalOwner = vm.envOr("FWA_OWNER", deployer);
        address splitterAddress = vm.envAddress("FWA_SPLITTER_ADDRESS");
        DrandRelayCoordinator coordinator =
            DrandRelayCoordinator(payable(vm.envAddress("FWA_DRAND_COORDINATOR_ADDRESS")));
        FWAVRFService service = FWAVRFService(payable(vm.envAddress("FWA_VRF_SERVICE_ADDRESS")));
        SplitterHyperEVM splitter = SplitterHyperEVM(payable(splitterAddress));
        if (
            address(coordinator).code.length == 0 || address(service).code.length == 0
                || splitterAddress.code.length == 0 || coordinator.owner() != deployer
                || coordinator.consumer() != address(0) || service.owner() != deployer
                || address(service.fwa()) != address(0) || splitter.owner() != finalOwner
        ) revert InvalidExistingDeployment();

        vm.startBroadcast(deployerKey);
        fwa = new FWA(address(coordinator), coordinator.SUBSCRIPTION_ID(), DRAND_KEY_HASH, 900_000, address(service));
        whitelist = new FWAWhitelist(address(fwa), address(0), 0, deployer);
        coordinator.setConsumer(address(fwa));
        uint256 initialReserve = vm.envOr("FWA_DRAND_INITIAL_RESERVE_WEI", uint256(1_000));
        if (initialReserve > type(uint96).max) revert InvalidConfig();
        if (initialReserve != 0) {
            coordinator.fundSubscriptionWithNative{value: initialReserve}(coordinator.SUBSCRIPTION_ID());
        }
        service.setFWA(address(fwa));
        _configure(fwa, service, whitelist, splitterAddress);
        if (finalOwner != deployer) {
            coordinator.transferOwnership(finalOwner);
            service.transferOwnership(finalOwner);
            whitelist.transferOwnership(finalOwner);
            fwa.transferOwnership(finalOwner);
        }
        vm.stopBroadcast();

        emit ProjectXTestnetCoreResumed(
            finalOwner, address(fwa), address(coordinator), address(service), address(whitelist), splitterAddress
        );
    }

    function _configure(FWA fwa, FWAVRFService service, FWAWhitelist whitelist, address splitter) private {
        uint256 selectionTimeout = vm.envOr("FWA_DRAND_SELECTION_TIMEOUT_BLOCKS", uint256(360));
        uint256 minBacking = vm.envOr("FWA_DRAND_GAMEPLAY_BACKING_WEI", uint256(0.01 ether));
        uint256 protocolFeeToTokenBps = vm.envOr("FWA_PROTOCOL_FEE_TO_TOKEN_BPS", uint256(8_000));
        if (selectionTimeout == 0 || minBacking == 0 || protocolFeeToTokenBps > 10_000) revert InvalidConfig();
        service.setFeeConfig(
            vm.envOr("FWA_RANDOMNESS_GAS_ESTIMATE", uint256(800_000)),
            vm.envOr("FWA_RANDOMNESS_MARGIN_BPS", uint256(3_000)),
            vm.envOr("FWA_RANDOMNESS_FLAT_WEI", uint256(0))
        );
        fwa.setAddr(FWAConfigKeys.WHITELIST_MANAGER, address(whitelist));
        fwa.setAddr(FWAConfigKeys.PAYOUT_ADDRESS, splitter);
        fwa.setUint(FWAConfigKeys.TOP_LISTING_SHARE_BPS, 100);
        fwa.setUint(FWAConfigKeys.SELECTION_TIMEOUT_BLOCKS, selectionTimeout);
        fwa.setUint(FWAConfigKeys.MAX_ACQUISITIONS_PER_TX, 1);
        fwa.setUint(FWAConfigKeys.MAX_ACTIVATIONS_PER_ACQUISITION, 1);
        fwa.setUint(FWAConfigKeys.MIN_BACKING, minBacking);
        fwa.setUint(FWAConfigKeys.PROTOCOL_FEE_TO_TOKEN_BPS, protocolFeeToTokenBps);
        fwa.setBool(FWAConfigKeys.REWARDS_REQUIRED_FOR_ACTIVATION, true);
    }
}
