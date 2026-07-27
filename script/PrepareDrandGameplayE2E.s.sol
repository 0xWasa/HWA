// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {FWA} from "fwa-reference/src/FWA.sol";
import {FWAConfigKeys} from "fwa-reference/src/FWAConfigKeys.sol";
import {FWAWhitelist} from "fwa-whitelist-reference/src/FWAWhitelist.sol";

interface VmPrepareDrandE2E {
    function envUint(string calldata name) external returns (uint256 value);
    function envBool(string calldata name) external returns (bool value);
    function envAddress(string calldata name) external returns (address value);
    function envOr(string calldata name, uint256 defaultValue) external returns (uint256 value);
    function addr(uint256 privateKey) external returns (address keyAddr);
    function txGasPrice(uint256 newGasPrice) external;
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

interface IDrandGameplayCoordinator {
    function SUBSCRIPTION_ID() external view returns (uint256);
    function consumer() external view returns (address);
    function pendingRequestExists(uint256 subId) external view returns (bool);
}

interface IERC721Approval {
    function ownerOf(uint256 tokenId) external view returns (address);
    function approve(address spender, uint256 tokenId) external;
}

interface IFWAE2EVrfService {
    function serviceGasEstimate() external view returns (uint256);
    function serviceMarginBps() external view returns (uint256);
    function serviceFlatWei() external view returns (uint256);
    function requiredSubscriptionBalance(uint256 additionalRequests) external view returns (uint256);
    function subscriptionNativeBalance() external view returns (uint256);
    function topUpSubscription() external returns (uint256);
}

/// @notice Creates one live testnet listing and acquisition using distinct test actors.
/// @dev It intentionally stops at Pending; the drand watcher must fulfill the request separately.
contract PrepareDrandGameplayE2E {
    VmPrepareDrandE2E internal constant vm = VmPrepareDrandE2E(address(uint160(uint256(keccak256("hevm cheat code")))));

    uint256 internal constant HYPEREVM_TESTNET_CHAIN_ID = 998;

    event DrandGameplayPrepared(
        uint256 indexed listingId, uint256 indexed requestId, uint64 indexed targetRound, uint256 acquisitionCost
    );

    error WrongChain(uint256 actual);
    error PreparationNotConfirmed();
    error InvalidActor();
    error InvalidWiring();
    error DirtyCoreState();
    error FundingFailed();
    error VerificationFailed();

    function run() external returns (uint256 listingId, uint256 requestId) {
        if (block.chainid != HYPEREVM_TESTNET_CHAIN_ID) revert WrongChain(block.chainid);
        if (!vm.envBool("FWA_DRAND_GAMEPLAY_PREPARE_CONFIRMED")) revert PreparationNotConfirmed();

        uint256 ownerKey = vm.envUint("PRIVATE_KEY");
        uint256 depositorKey = vm.envUint("FWA_TEST_DEPOSITOR_PRIVATE_KEY");
        uint256 purchaserKey = vm.envUint("FWA_TEST_PURCHASER_PRIVATE_KEY");
        address owner = vm.addr(ownerKey);
        address depositor = vm.addr(depositorKey);
        address purchaser = vm.addr(purchaserKey);
        if (owner == depositor || owner == purchaser || depositor == purchaser) revert InvalidActor();
        if (depositor != vm.envAddress("FWA_TEST_DEPOSITOR") || purchaser != vm.envAddress("FWA_TEST_PURCHASER")) {
            revert InvalidActor();
        }

        FWA fwa = FWA(vm.envAddress("FWA_ADDRESS"));
        FWAWhitelist whitelist = FWAWhitelist(vm.envAddress("FWA_WHITELIST_ADDRESS"));
        IDrandGameplayCoordinator coordinator =
            IDrandGameplayCoordinator(vm.envAddress("FWA_DRAND_COORDINATOR_ADDRESS"));
        IERC721Approval collection = IERC721Approval(vm.envAddress("FWA_TEST_GAMEPLAY_NFT"));
        IFWAE2EVrfService service = IFWAE2EVrfService(address(fwa.vrfService()));
        uint256 tokenId = vm.envOr("FWA_DRAND_GAMEPLAY_TOKEN_ID", uint256(1));
        uint256 backing = vm.envOr("FWA_DRAND_GAMEPLAY_BACKING_WEI", uint256(0.01 ether));
        uint256 actorTargetBalance = vm.envOr("FWA_DRAND_ACTOR_TARGET_BALANCE_WEI", uint256(0.03 ether));
        uint256 transactionGasPrice = vm.envOr("FWA_DRAND_E2E_GAS_PRICE_WEI", uint256(100_000_000));
        uint256 feeQuoteGasPrice = vm.envOr("FWA_DRAND_E2E_FEE_QUOTE_GAS_PRICE_WEI", transactionGasPrice * 3);
        if (feeQuoteGasPrice < transactionGasPrice) revert VerificationFailed();
        // FWAVRFService prices each request from tx.gasprice. The matching --gas-price value in the
        // runbook makes the simulated value and every broadcast transaction identical.
        vm.txGasPrice(transactionGasPrice);

        (address activeCoordinator, uint256 subId) = fwa.vrfCoordinatorAndSubId();
        if (
            fwa.owner() != owner || whitelist.owner() != owner || whitelist.fwa() != address(fwa)
                || activeCoordinator != address(coordinator) || subId != coordinator.SUBSCRIPTION_ID()
                || coordinator.consumer() != address(fwa) || collection.ownerOf(tokenId) != depositor
        ) revert InvalidWiring();
        if (
            fwa.activeListingCount() != 0 || fwa.unsettledAcquisitionCount() != 0 || fwa.unfulfilledVrfCount() != 0
                || coordinator.pendingRequestExists(subId)
        ) revert DirtyCoreState();

        address[] memory collections = new address[](1);
        collections[0] = address(collection);
        vm.startBroadcast(ownerKey);
        whitelist.setCollections(collections, true);
        fwa.setBool(FWAConfigKeys.ACQUISITIONS_ENABLED, true);
        _topUp(payable(depositor), actorTargetBalance);
        _topUp(payable(purchaser), actorTargetBalance);
        _prefundCoverage(service);
        vm.stopBroadcast();

        vm.startBroadcast(depositorKey);
        collection.approve(address(fwa), tokenId);
        listingId = fwa.listNFT{value: backing}(address(collection), tokenId);
        vm.stopBroadcast();

        // Foundry's multi-transaction simulation may expose tx.gasprice=0 inside the script even when
        // --gas-price is supplied. Calculate the broadcast fee explicitly; FWA safely refunds the
        // resulting excess during simulation and consumes it at the matching live gas price.
        // HyperEVM EIP-1559 may execute above the legacy --gas-price value after the script has
        // been simulated. Quote a conservative ceiling and rely on FWA's exact excess refund.
        uint256 serviceFee = service.serviceGasEstimate() * feeQuoteGasPrice * (10_000 + service.serviceMarginBps())
            / 10_000 + service.serviceFlatWei();
        uint256 acquisitionCost = fwa.acquisitionFee() + serviceFee;
        vm.startBroadcast(purchaserKey);
        requestId = fwa.acquire{value: acquisitionCost}(0, 0);
        vm.stopBroadcast();

        (uint64 targetRound, uint8 status) = _requestState(address(coordinator), requestId);
        if (
            requestId == 0 || listingId == 0 || status != 1 || fwa.unsettledAcquisitionCount() != 1
                || !coordinator.pendingRequestExists(subId)
        ) revert VerificationFailed();

        emit DrandGameplayPrepared(listingId, requestId, targetRound, acquisitionCost);
    }

    function _requestState(address coordinator, uint256 requestId)
        private
        view
        returns (uint64 targetRound, uint8 status)
    {
        (bool success, bytes memory data) =
            coordinator.staticcall(abi.encodeWithSignature("requestState(uint256)", requestId));
        if (!success) revert VerificationFailed();
        if (data.length == 64) {
            (targetRound, status) = abi.decode(data, (uint64, uint8));
        } else if (data.length == 96) {
            (targetRound,, status) = abi.decode(data, (uint64, uint64, uint8));
        } else {
            revert VerificationFailed();
        }
    }

    function _topUp(address payable actor, uint256 targetBalance) internal {
        if (actor.balance >= targetBalance) return;
        (bool success,) = actor.call{value: targetBalance - actor.balance}("");
        if (!success) revert FundingFailed();
    }

    function _prefundCoverage(IFWAE2EVrfService service) internal {
        uint256 required = service.requiredSubscriptionBalance(1);
        uint256 available = service.subscriptionNativeBalance() + address(service).balance;
        if (available < required) {
            (bool success,) = payable(address(service)).call{value: required - available}("");
            if (!success) revert FundingFailed();
        }
        service.topUpSubscription();
    }
}
