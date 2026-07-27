// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {FWA} from "fwa-reference/src/FWA.sol";
import {FWAVRFService} from "fwa-vrf-reference/src/FWAVRFService.sol";
import {FWAWhitelist} from "fwa-whitelist-reference/src/FWAWhitelist.sol";

import {SplitterHyperEVM} from "../src/hyperevm/SplitterHyperEVM.sol";

interface VmVerify {
    function envAddress(string calldata name) external view returns (address value);
    function envUint(string calldata name) external view returns (uint256 value);
}

interface IFWARandomnessCoordinatorView {
    function SUBSCRIPTION_ID() external view returns (uint256);
    function consumer() external view returns (address);
    function owner() external view returns (address);
    function getSubscription(uint256 subId)
        external
        view
        returns (uint96 balance, uint96 nativeBalance, uint64 reqCount, address subOwner, address[] memory consumers);
}

/// @notice Read-only core attestation for the active HyperEVM testnet or mainnet coordinator.
contract VerifyHyperEVMCore {
    VmVerify internal constant vm = VmVerify(address(uint160(uint256(keccak256("hevm cheat code")))));

    uint256 internal constant HYPEREVM_TESTNET_CHAIN_ID = 998;
    uint256 internal constant HYPEREVM_MAINNET_CHAIN_ID = 999;

    error WrongChain(uint256 actual);
    error MissingCode(address target);
    error InvalidWiring();

    function run() external view {
        uint256 chainId = block.chainid;
        if (chainId != HYPEREVM_TESTNET_CHAIN_ID && chainId != HYPEREVM_MAINNET_CHAIN_ID) {
            revert WrongChain(chainId);
        }

        FWA fwa = FWA(vm.envAddress("FWA_ADDRESS"));
        FWAVRFService service = FWAVRFService(payable(vm.envAddress("FWA_VRF_SERVICE_ADDRESS")));
        address coordinatorAddress = chainId == HYPEREVM_TESTNET_CHAIN_ID
            ? vm.envAddress("FWA_DRAND_COORDINATOR_ADDRESS")
            : vm.envAddress("FWA_DRAND_BN254_COORDINATOR_ADDRESS");
        IFWARandomnessCoordinatorView coordinator = IFWARandomnessCoordinatorView(coordinatorAddress);
        FWAWhitelist whitelist = FWAWhitelist(vm.envAddress("FWA_WHITELIST_ADDRESS"));
        SplitterHyperEVM splitter = SplitterHyperEVM(payable(vm.envAddress("FWA_SPLITTER_ADDRESS")));

        _requireCode(address(fwa));
        _requireCode(address(service));
        _requireCode(coordinatorAddress);
        _requireCode(address(whitelist));
        _requireCode(address(splitter));
        _requireCode(splitter.NFT_ADDRESS());

        address finalOwner = fwa.owner();
        (address activeCoordinator, uint256 subId) = fwa.vrfCoordinatorAndSubId();
        (bytes32 keyHash, uint32 callbackGasLimit) = fwa.vrfRequestConfig();
        (,,, address subscriptionOwner, address[] memory consumers) = coordinator.getSubscription(subId);
        if (
            activeCoordinator != coordinatorAddress || subId != coordinator.SUBSCRIPTION_ID()
                || coordinator.consumer() != address(fwa) || coordinator.owner() != finalOwner
                || subscriptionOwner != finalOwner || consumers.length != 1 || consumers[0] != address(fwa)
                || address(service.fwa()) != address(fwa) || address(fwa.vrfService()) != address(service)
                || service.owner() != finalOwner || service.approvedVrfKeyHash() != keyHash
                || service.approvedCallbackGasLimit() != callbackGasLimit || whitelist.fwa() != address(fwa)
                || whitelist.owner() != finalOwner || fwa.payoutAddress() != address(splitter)
                || splitter.owner() != finalOwner || splitter.ownerShareBps() != 7_000
                || splitter.nftShareBps() != 3_000 || fwa.topListingShareBps() != 100
        ) revert InvalidWiring();

        if (
            chainId == HYPEREVM_MAINNET_CHAIN_ID
                && (finalOwner.code.length == 0
                    || !fwa.rewardsRequiredForActivation()
                    || fwa.selectionTimeoutBlocks() != vm.envUint("FWA_SELECTION_TIMEOUT_BLOCKS")
                    || fwa.maxAcquisitionsPerTx() != 1
                    || fwa.maxActivationsPerAcquisition() != 1
                    || fwa.minBacking() != vm.envUint("FWA_MIN_BACKING_WEI")
                    || fwa.protocolFeeToTokenBps() != vm.envUint("FWA_PROTOCOL_FEE_TO_TOKEN_BPS")
                    || fwa.acquisitionsEnabled()
                    || fwa.withdrawOnly()
                    || fwa.activeListingCount() != 0
                    || fwa.stagedCount() != 0
                    || service.subscriptionNativeBalance() < service.requiredSubscriptionBalance(1))
        ) revert InvalidWiring();
    }

    function _requireCode(address target) internal view {
        if (target.code.length == 0) revert MissingCode(target);
    }
}
