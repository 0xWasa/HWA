// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Ownable} from "solady/src/auth/Ownable.sol";
import {ReentrancyGuard} from "solady/src/utils/ReentrancyGuard.sol";
import {SafeTransferLib} from "solady/src/utils/SafeTransferLib.sol";
import {VRFV2PlusClient} from "@chainlink/contracts/src/v0.8/vrf/dev/libraries/VRFV2PlusClient.sol";

import {IProofOfPlayVRNG, IProofOfPlayVRNGCallback} from "./interfaces/IProofOfPlayVRNG.sol";

interface IFWARandomnessConsumer {
    function rawFulfillRandomWords(uint256 requestId, uint256[] calldata randomWords) external;
}

/// @title PoPRandomnessAdapter
/// @notice Translates the Chainlink coordinator surface used by the unmodified FWA core into
///         Proof of Play vRNG requests and callbacks.
/// @dev The adapter deliberately implements only the coordinator selectors exercised by FWA and
///      FWAVRFService. It is not a general Chainlink VRF coordinator or subscription implementation.
contract PoPRandomnessAdapter is Ownable, ReentrancyGuard, IProofOfPlayVRNGCallback {
    uint256 internal constant HYPEREVM_MAINNET_CHAIN_ID = 999;
    uint256 public constant SUBSCRIPTION_ID = 1;
    bytes32 public constant DERIVATION_DOMAIN = keccak256("FWA_HYPEREVM_POP_VRNG_V1");

    enum RequestStatus {
        None,
        Pending,
        Fulfilled
    }

    struct Request {
        address consumer;
        uint256 providerRequestId;
        uint64 requestedAtBlock;
        uint32 callbackGasLimit;
        uint16 requestConfirmations;
        RequestStatus status;
    }

    IProofOfPlayVRNG public immutable PROVIDER;
    address public consumer;
    uint256 public nextRequestId = 1;
    uint256 public pendingRequestCount;
    uint64 public requestCount;
    uint96 public nativeSubscriptionBalance;

    mapping(uint256 localRequestId => Request request) public requests;
    mapping(uint256 providerRequestId => uint256 localRequestId) public providerToLocalRequest;
    mapping(uint256 localRequestId => uint256 derivedWord) public fulfilledWord;

    event ConsumerSet(address indexed consumer);
    event RandomnessRequested(
        uint256 indexed localRequestId,
        uint256 indexed providerRequestId,
        address indexed consumer,
        uint16 requestConfirmations,
        uint32 callbackGasLimit
    );
    event RandomnessFulfilled(
        uint256 indexed localRequestId, uint256 indexed providerRequestId, uint256 providerWord, uint256 derivedWord
    );
    event SubscriptionFunded(uint256 indexed subId, address indexed funder, uint256 amount);
    event NativeWithdrawn(address indexed to, uint256 amount);

    error ZeroAddress();
    error ConsumerAlreadySet();
    error OnlyConsumer();
    error OnlyProvider();
    error InvalidSubscription();
    error InvalidRequest();
    error UnknownRequest();
    error RequestAlreadyKnown();
    error PendingRequests();
    error NativeBalanceOverflow();
    error InsufficientNativeBalance();
    error LegacyCoordinatorDisabledOnMainnet();

    constructor(address provider_, address owner_) {
        if (block.chainid == HYPEREVM_MAINNET_CHAIN_ID) revert LegacyCoordinatorDisabledOnMainnet();
        if (provider_ == address(0) || provider_.code.length == 0 || owner_ == address(0)) revert ZeroAddress();
        PROVIDER = IProofOfPlayVRNG(provider_);
        _initializeOwner(owner_);
    }

    function setConsumer(address consumer_) external onlyOwner {
        if (consumer != address(0)) revert ConsumerAlreadySet();
        if (consumer_ == address(0) || consumer_.code.length == 0) revert ZeroAddress();
        consumer = consumer_;
        emit ConsumerSet(consumer_);
    }

    /// @notice Chainlink-compatible request selector used by FWA.
    function requestRandomWords(VRFV2PlusClient.RandomWordsRequest calldata req)
        external
        nonReentrant
        returns (uint256 localRequestId)
    {
        address configuredConsumer = consumer;
        if (msg.sender != configuredConsumer) revert OnlyConsumer();
        if (req.subId != SUBSCRIPTION_ID || req.numWords != 1 || req.keyHash == bytes32(0)) {
            revert InvalidRequest();
        }

        localRequestId = nextRequestId++;
        uint256 providerRequestId = PROVIDER.requestRandomNumberWithTraceId(localRequestId);
        if (providerToLocalRequest[providerRequestId] != 0) revert RequestAlreadyKnown();

        requests[localRequestId] = Request({
            consumer: configuredConsumer,
            providerRequestId: providerRequestId,
            requestedAtBlock: uint64(block.number),
            callbackGasLimit: req.callbackGasLimit,
            requestConfirmations: req.requestConfirmations,
            status: RequestStatus.Pending
        });
        providerToLocalRequest[providerRequestId] = localRequestId;
        pendingRequestCount += 1;
        requestCount += 1;

        emit RandomnessRequested(
            localRequestId, providerRequestId, configuredConsumer, req.requestConfirmations, req.callbackGasLimit
        );
    }

    /// @notice Authenticated PoP callback. It commits state before calling FWA, but a callback
    ///         failure reverts the whole transaction so the provider/manual-retry path can retry.
    function randomNumberCallback(uint256 providerRequestId, uint256 providerWord) external nonReentrant {
        if (msg.sender != address(PROVIDER)) revert OnlyProvider();
        uint256 localRequestId = providerToLocalRequest[providerRequestId];
        if (localRequestId == 0) revert UnknownRequest();

        Request storage request = requests[localRequestId];
        if (request.status != RequestStatus.Pending) revert UnknownRequest();

        uint256 derivedWord = uint256(
            keccak256(
                abi.encode(
                    DERIVATION_DOMAIN,
                    block.chainid,
                    address(this),
                    providerRequestId,
                    localRequestId,
                    request.consumer,
                    providerWord
                )
            )
        );

        request.status = RequestStatus.Fulfilled;
        fulfilledWord[localRequestId] = derivedWord;
        delete providerToLocalRequest[providerRequestId];
        pendingRequestCount -= 1;

        uint256[] memory words = new uint256[](1);
        words[0] = derivedWord;
        IFWARandomnessConsumer(request.consumer).rawFulfillRandomWords(localRequestId, words);

        emit RandomnessFulfilled(localRequestId, providerRequestId, providerWord, derivedWord);
    }

    /// @notice Chainlink-compatible pending-request selector used by FWA reconciliation.
    function pendingRequestExists(uint256 subId) external view returns (bool) {
        if (subId != SUBSCRIPTION_ID) revert InvalidSubscription();
        return pendingRequestCount != 0;
    }

    /// @notice Compatibility view used by the verified FWAVRFService.
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

    /// @notice Compatibility funding sink used by FWAVRFService. PoP does not consume a Chainlink
    ///         subscription balance; the funds remain recoverable only when no request is pending.
    function fundSubscriptionWithNative(uint256 subId) external payable {
        if (subId != SUBSCRIPTION_ID) revert InvalidSubscription();
        uint256 updated = uint256(nativeSubscriptionBalance) + msg.value;
        if (updated > type(uint96).max) revert NativeBalanceOverflow();
        // forge-lint: disable-next-line(unsafe-typecast)
        nativeSubscriptionBalance = uint96(updated);
        emit SubscriptionFunded(subId, msg.sender, msg.value);
    }

    function withdrawNative(address to, uint256 amount) external onlyOwner nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        if (pendingRequestCount != 0) revert PendingRequests();
        if (amount > nativeSubscriptionBalance) revert InsufficientNativeBalance();
        // forge-lint: disable-next-line(unsafe-typecast)
        nativeSubscriptionBalance -= uint96(amount);
        SafeTransferLib.forceSafeTransferETH(to, amount);
        emit NativeWithdrawn(to, amount);
    }
}
