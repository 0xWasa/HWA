// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Ownable} from "solady/src/auth/Ownable.sol";
import {ReentrancyGuard} from "solady/src/utils/ReentrancyGuard.sol";
import {SafeTransferLib} from "solady/src/utils/SafeTransferLib.sol";
import {VRFV2PlusClient} from "@chainlink/contracts/src/v0.8/vrf/dev/libraries/VRFV2PlusClient.sol";

interface IGelatoFWAConsumer {
    function rawFulfillRandomWords(uint256 requestId, uint256[] calldata randomWords) external;
}

/// @title GelatoVRFCoordinator
/// @notice Legacy compatibility coordinator retained for regression tests and historical deployments.
/// @dev Gelato VRF emits a drand round and opaque request data, then its dedicated operator calls
///      `fulfillRandomness`. Gelato verifies drand offchain; this contract authenticates that operator,
///      binds the callback to the exact emitted payload, domain-separates the word and prevents replay.
///      It intentionally exposes only the four coordinator selectors consumed by FWA/FWAVRFService.
contract GelatoVRFCoordinator is Ownable, ReentrancyGuard {
    uint256 internal constant HYPEREVM_MAINNET_CHAIN_ID = 999;
    uint256 public constant SUBSCRIPTION_ID = 1;
    uint256 public constant DRAND_PERIOD_SECONDS = 3;
    uint256 public constant DRAND_GENESIS_TIME = 1_692_803_367;
    bytes4 public constant EXTRA_ARGS_V1_TAG = bytes4(keccak256("VRF ExtraArgsV1"));

    enum RequestStatus {
        None,
        Pending,
        Fulfilled
    }

    struct Request {
        address consumer;
        uint64 targetRound;
        uint64 requestedAtBlock;
        uint32 callbackGasLimit;
        uint16 requestConfirmations;
        RequestStatus status;
    }

    /// @notice Gelato's deployer-specific dedicated msg.sender. Rotation requires a new coordinator.
    address public immutable OPERATOR;
    address public consumer;
    uint256 public nextRequestId = 1;
    uint256 public pendingRequestCount;
    uint64 public requestCount;
    uint96 public nativeSubscriptionBalance;

    mapping(uint256 requestId => Request request) public requests;
    mapping(uint256 requestId => bytes32 payloadHash) public requestedHash;
    mapping(uint256 requestId => uint256 word) public fulfilledWord;

    /// @dev Signature and payload shape consumed by Gelato VRF Web3 Functions.
    event RequestedRandomness(uint256 round, bytes data);
    event ConsumerSet(address indexed consumer);
    event RandomnessRequested(
        uint256 indexed requestId,
        uint64 indexed targetRound,
        address indexed consumer,
        uint16 requestConfirmations,
        uint32 callbackGasLimit,
        bytes32 payloadHash
    );
    event RandomnessFulfilled(
        uint256 indexed requestId,
        uint64 indexed round,
        address indexed operator,
        uint256 gelatoRandomness,
        uint256 derivedWord
    );
    event SubscriptionFunded(uint256 indexed subId, address indexed funder, uint256 amount);
    event NativeWithdrawn(address indexed to, uint256 amount);

    error ZeroAddress();
    error ConsumerAlreadySet();
    error OnlyConsumer();
    error OnlyOperator();
    error InvalidSubscription();
    error InvalidRequest();
    error InvalidPayload();
    error UnknownRequest();
    error PendingRequests();
    error NativeBalanceOverflow();
    error InsufficientNativeBalance();
    error ConsumerCallbackFailed();
    error LegacyCoordinatorDisabledOnMainnet();

    constructor(address operator_, address owner_) {
        if (block.chainid == HYPEREVM_MAINNET_CHAIN_ID) revert LegacyCoordinatorDisabledOnMainnet();
        if (operator_ == address(0) || owner_ == address(0)) revert ZeroAddress();
        OPERATOR = operator_;
        _initializeOwner(owner_);
    }

    function setConsumer(address consumer_) external onlyOwner {
        if (consumer != address(0)) revert ConsumerAlreadySet();
        if (consumer_ == address(0) || consumer_.code.length == 0) revert ZeroAddress();
        consumer = consumer_;
        emit ConsumerSet(consumer_);
    }

    /// @notice Chainlink v2.5 Plus request selector used by the unmodified FWA core.
    function requestRandomWords(VRFV2PlusClient.RandomWordsRequest calldata req)
        external
        nonReentrant
        returns (uint256 requestId)
    {
        address configuredConsumer = consumer;
        if (msg.sender != configuredConsumer) revert OnlyConsumer();
        if (
            req.subId != SUBSCRIPTION_ID || req.numWords != 1 || req.keyHash == bytes32(0)
                || req.requestConfirmations == 0 || req.callbackGasLimit == 0
                || keccak256(req.extraArgs) != keccak256(_nativePaymentExtraArgs())
        ) revert InvalidRequest();

        requestId = nextRequestId++;
        uint64 targetRound = _nextRound();
        bytes memory extraData = abi.encode(configuredConsumer, req.callbackGasLimit);
        bytes memory data = abi.encode(requestId, extraData);
        bytes memory dataWithRound = abi.encode(uint256(targetRound), data);
        bytes32 payloadHash = keccak256(dataWithRound);

        requests[requestId] = Request({
            consumer: configuredConsumer,
            targetRound: targetRound,
            requestedAtBlock: uint64(block.number),
            callbackGasLimit: req.callbackGasLimit,
            requestConfirmations: req.requestConfirmations,
            status: RequestStatus.Pending
        });
        requestedHash[requestId] = payloadHash;
        pendingRequestCount += 1;
        requestCount += 1;

        emit RequestedRandomness(targetRound, data);
        emit RandomnessRequested(
            requestId, targetRound, configuredConsumer, req.requestConfirmations, req.callbackGasLimit, payloadHash
        );
    }

    /// @notice Gelato VRF callback using the exact payload reconstructed from RequestedRandomness.
    /// @dev A failed FWA callback reverts the entire fulfillment so Gelato can retry it safely.
    function fulfillRandomness(uint256 randomness, bytes calldata dataWithRound) external nonReentrant {
        if (msg.sender != OPERATOR) revert OnlyOperator();

        (uint256 round, bytes memory data) = abi.decode(dataWithRound, (uint256, bytes));
        (uint256 requestId, bytes memory extraData) = abi.decode(data, (uint256, bytes));
        (address requestConsumer, uint32 callbackGasLimit) = abi.decode(extraData, (address, uint32));

        Request storage request = requests[requestId];
        if (request.status != RequestStatus.Pending) revert UnknownRequest();
        if (
            round != request.targetRound || requestConsumer != request.consumer
                || callbackGasLimit != request.callbackGasLimit || requestedHash[requestId] != keccak256(dataWithRound)
        ) revert InvalidPayload();

        uint256 derivedWord = uint256(keccak256(abi.encode(randomness, address(this), block.chainid, requestId)));
        request.status = RequestStatus.Fulfilled;
        requestedHash[requestId] = bytes32(0);
        fulfilledWord[requestId] = derivedWord;
        pendingRequestCount -= 1;

        uint256[] memory words = new uint256[](1);
        words[0] = derivedWord;
        (bool success,) = request.consumer.call{gas: request.callbackGasLimit}(
            abi.encodeCall(IGelatoFWAConsumer.rawFulfillRandomWords, (requestId, words))
        );
        if (!success) revert ConsumerCallbackFailed();

        emit RandomnessFulfilled(requestId, uint64(round), msg.sender, randomness, derivedWord);
    }

    /// @notice Reconstruct the payload Gelato must return for an outstanding request.
    function requestPayload(uint256 requestId) external view returns (bytes memory dataWithRound) {
        Request storage request = requests[requestId];
        if (request.status == RequestStatus.None) revert UnknownRequest();
        bytes memory extraData = abi.encode(request.consumer, request.callbackGasLimit);
        bytes memory data = abi.encode(requestId, extraData);
        return abi.encode(uint256(request.targetRound), data);
    }

    /// @notice Chainlink-compatible pending-request selector used by FWA reconciliation.
    function pendingRequestExists(uint256 subId) external view returns (bool) {
        if (subId != SUBSCRIPTION_ID) revert InvalidSubscription();
        return pendingRequestCount != 0;
    }

    /// @notice Chainlink v2.5 Plus subscription view used by FWAVRFService.
    function getSubscription(uint256 subId)
        external
        view
        returns (uint96 balance, uint96 nativeBalance, uint64 reqCount, address subOwner, address[] memory consumers)
    {
        if (subId != SUBSCRIPTION_ID) revert InvalidSubscription();
        consumers = new address[](consumer == address(0) ? 0 : 1);
        if (consumers.length == 1) consumers[0] = consumer;
        return (0, nativeSubscriptionBalance, requestCount, owner(), consumers);
    }

    /// @notice Compatibility reserve used by FWAVRFService; Gelato execution is funded separately in Gas Tank.
    function fundSubscriptionWithNative(uint256 subId) external payable {
        if (subId != SUBSCRIPTION_ID) revert InvalidSubscription();
        uint256 updated = uint256(nativeSubscriptionBalance) + msg.value;
        if (updated > type(uint96).max) revert NativeBalanceOverflow();
        nativeSubscriptionBalance = uint96(updated);
        emit SubscriptionFunded(subId, msg.sender, msg.value);
    }

    function withdrawNative(address to, uint256 amount) external onlyOwner nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        if (pendingRequestCount != 0) revert PendingRequests();
        if (amount > nativeSubscriptionBalance) revert InsufficientNativeBalance();
        nativeSubscriptionBalance -= uint96(amount);
        SafeTransferLib.forceSafeTransferETH(to, amount);
        emit NativeWithdrawn(to, amount);
    }

    function _nextRound() internal view returns (uint64 round) {
        if (block.timestamp < DRAND_GENESIS_TIME) revert InvalidRequest();
        uint256 currentRound = ((block.timestamp - DRAND_GENESIS_TIME) / DRAND_PERIOD_SECONDS) + 1;
        uint256 requestedRound = currentRound + (block.chainid == 1 ? 4 : 1);
        if (requestedRound > type(uint64).max) revert InvalidRequest();
        return uint64(requestedRound);
    }

    function _nativePaymentExtraArgs() internal pure returns (bytes memory) {
        return abi.encodeWithSelector(EXTRA_ARGS_V1_TAG, VRFV2PlusClient.ExtraArgsV1({nativePayment: true}));
    }
}
