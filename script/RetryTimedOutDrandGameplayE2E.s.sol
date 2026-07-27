// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {FWA} from "fwa-reference/src/FWA.sol";
import {FWAConfigKeys} from "fwa-reference/src/FWAConfigKeys.sol";

import {DrandRelayCoordinator} from "../src/hyperevm/DrandRelayCoordinator.sol";

interface VmRetryDrandE2E {
    function envUint(string calldata name) external returns (uint256 value);
    function envBool(string calldata name) external returns (bool value);
    function envAddress(string calldata name) external returns (address value);
    function envOr(string calldata name, uint256 defaultValue) external returns (uint256 value);
    function addr(uint256 privateKey) external returns (address keyAddr);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

interface IFWARetryVrfService {
    function serviceGasEstimate() external view returns (uint256);
    function serviceMarginBps() external view returns (uint256);
    function serviceFlatWei() external view returns (uint256);
}

/// @notice Closes the intentionally observed 30-block timeout and creates a retry after adapting the
///         testnet block-based window to the approximately six-minute Ethereum wall-clock duration.
contract RetryTimedOutDrandGameplayE2E {
    VmRetryDrandE2E internal constant vm = VmRetryDrandE2E(address(uint160(uint256(keccak256("hevm cheat code")))));

    uint256 internal constant HYPEREVM_TESTNET_CHAIN_ID = 998;

    event DrandGameplayRetried(uint256 indexed expiredRequestId, uint256 indexed retryRequestId, uint64 targetRound);

    error WrongChain(uint256 actual);
    error RetryNotConfirmed();
    error InvalidState();

    function run() external returns (uint256 retryRequestId) {
        if (block.chainid != HYPEREVM_TESTNET_CHAIN_ID) revert WrongChain(block.chainid);
        if (!vm.envBool("FWA_DRAND_GAMEPLAY_RETRY_CONFIRMED")) revert RetryNotConfirmed();

        uint256 ownerKey = vm.envUint("PRIVATE_KEY");
        uint256 purchaserKey = vm.envUint("FWA_TEST_PURCHASER_PRIVATE_KEY");
        FWA fwa = FWA(vm.envAddress("FWA_ADDRESS"));
        DrandRelayCoordinator coordinator =
            DrandRelayCoordinator(payable(vm.envAddress("FWA_DRAND_COORDINATOR_ADDRESS")));
        IFWARetryVrfService service = IFWARetryVrfService(address(fwa.vrfService()));
        uint256 expiredRequestId = vm.envOr("FWA_DRAND_GAMEPLAY_REQUEST_ID", uint256(1));
        uint256 timeoutBlocks = vm.envOr("FWA_DRAND_SELECTION_TIMEOUT_BLOCKS", uint256(360));
        uint256 transactionGasPrice = vm.envOr("FWA_DRAND_E2E_GAS_PRICE_WEI", uint256(100_000_000));

        (,,,, FWA.AcquisitionStatus beforeStatus) = fwa.acquisitions(expiredRequestId);
        if (
            beforeStatus != FWA.AcquisitionStatus.TimedOut || fwa.unsettledAcquisitionCount() != 1
                || coordinator.pendingRequestExists(1)
        ) revert InvalidState();

        vm.startBroadcast(ownerKey);
        fwa.processAcquisitions(1);
        fwa.setUint(FWAConfigKeys.SELECTION_TIMEOUT_BLOCKS, timeoutBlocks);
        vm.stopBroadcast();

        (,,,, FWA.AcquisitionStatus expiredStatus) = fwa.acquisitions(expiredRequestId);
        if (expiredStatus != FWA.AcquisitionStatus.Expired || fwa.unsettledAcquisitionCount() != 0) {
            revert InvalidState();
        }

        uint256 serviceFee = service.serviceGasEstimate() * transactionGasPrice * (10_000 + service.serviceMarginBps())
            / 10_000 + service.serviceFlatWei();
        uint256 acquisitionCost = fwa.acquisitionFee() + serviceFee;
        vm.startBroadcast(purchaserKey);
        fwa.withdrawAcquisitionRefund();
        retryRequestId = fwa.acquire{value: acquisitionCost}(0, 0);
        vm.stopBroadcast();

        (uint64 targetRound, DrandRelayCoordinator.RequestStatus requestStatus) =
            coordinator.requestState(retryRequestId);
        if (
            retryRequestId == expiredRequestId || requestStatus != DrandRelayCoordinator.RequestStatus.Pending
                || fwa.unsettledAcquisitionCount() != 1
        ) revert InvalidState();
        emit DrandGameplayRetried(expiredRequestId, retryRequestId, targetRound);
    }
}
