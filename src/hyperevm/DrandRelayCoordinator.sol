// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Ownable} from "solady/src/auth/Ownable.sol";
import {ReentrancyGuard} from "solady/src/utils/ReentrancyGuard.sol";
import {SafeTransferLib} from "solady/src/utils/SafeTransferLib.sol";
import {VRFV2PlusClient} from "@chainlink/contracts/src/v0.8/vrf/dev/libraries/VRFV2PlusClient.sol";

interface IDrandFWAConsumer {
    function rawFulfillRandomWords(uint256 requestId, uint256[] calldata randomWords) external;
}

/// @title DrandRelayCoordinator
/// @notice Testnet randomness coordinator exposing the four Chainlink selectors used by FWA.
/// @dev A trusted, owner-authorized relayer submits a public drand evmnet signature. This contract
///      verifies the request/round binding and derives drand's public randomness as SHA-256(signature),
///      but it intentionally does NOT verify the drand BLS signature onchain. Anyone can audit every
///      fulfillment against evmnet using the signature and round emitted in RandomnessFulfilled.
contract DrandRelayCoordinator is Ownable, ReentrancyGuard {
    uint256 internal constant HYPEREVM_MAINNET_CHAIN_ID = 999;
    uint256 public constant SUBSCRIPTION_ID = 1;
    bytes32 public constant DERIVATION_DOMAIN = keccak256("FWA_HYPEREVM_DRAND_RELAY_V1");

    // Official drand evmnet chain parameters. The chain uses an unchained BN254 scheme and a
    // three-second period. Pinning these values prevents a relayer from silently changing beacons.
    bytes32 public constant DRAND_CHAIN_HASH = 0x04f1e9062b8a81f848fded9c12306733282b2727ecced50032187751166ec8c3;
    uint64 public constant DRAND_GENESIS_TIME = 1_727_521_075;
    uint64 public constant DRAND_PERIOD_SECONDS = 3;
    uint64 public constant MIN_DELAY_SECONDS = DRAND_PERIOD_SECONDS;
    uint64 public constant MAX_DELAY_SECONDS = 1 days;

    enum RequestStatus {
        None,
        Pending,
        Fulfilled
    }

    struct Request {
        address consumer;
        uint64 targetRound;
        uint64 requestedAtBlock;
        uint64 requestedAtTimestamp;
        uint32 callbackGasLimit;
        uint16 requestConfirmations;
        RequestStatus status;
    }

    uint64 public immutable MIN_ROUND_DELAY_SECONDS;
    address public consumer;
    uint256 public nextRequestId = 1;
    uint256 public pendingRequestCount;
    uint64 public requestCount;
    uint96 public nativeSubscriptionBalance;

    mapping(address relayer => bool authorized) public isRelayer;
    mapping(uint256 requestId => Request request) public requests;
    mapping(uint256 requestId => bytes32 beaconRandomness) public fulfilledBeaconRandomness;
    mapping(uint256 requestId => uint256 derivedWord) public fulfilledWord;

    event ConsumerSet(address indexed consumer);
    event RelayerAuthorizationSet(address indexed relayer, bool authorized);
    event RandomnessRequested(
        uint256 indexed requestId,
        uint64 indexed targetRound,
        address indexed consumer,
        uint16 requestConfirmations,
        uint32 callbackGasLimit
    );
    event RandomnessFulfilled(
        uint256 indexed requestId,
        uint64 indexed round,
        address indexed relayer,
        bytes32 beaconRandomness,
        uint256 derivedWord,
        bytes signature
    );
    event SubscriptionFunded(uint256 indexed subId, address indexed funder, uint256 amount);
    event NativeWithdrawn(address indexed to, uint256 amount);

    error ZeroAddress();
    error ConsumerAlreadySet();
    error OnlyConsumer();
    error OnlyRelayer();
    error InvalidSubscription();
    error InvalidRequest();
    error InvalidDelay();
    error InvalidRound();
    error InvalidSignatureLength();
    error UnknownRequest();
    error WrongRound();
    error RoundNotAvailable();
    error PendingRequests();
    error NativeBalanceOverflow();
    error InsufficientNativeBalance();
    error LegacyCoordinatorDisabledOnMainnet();

    constructor(address relayer_, address owner_, uint64 minRoundDelaySeconds_) {
        if (block.chainid == HYPEREVM_MAINNET_CHAIN_ID) revert LegacyCoordinatorDisabledOnMainnet();
        if (relayer_ == address(0) || owner_ == address(0)) revert ZeroAddress();
        if (minRoundDelaySeconds_ < MIN_DELAY_SECONDS || minRoundDelaySeconds_ > MAX_DELAY_SECONDS) {
            revert InvalidDelay();
        }

        MIN_ROUND_DELAY_SECONDS = minRoundDelaySeconds_;
        isRelayer[relayer_] = true;
        _initializeOwner(owner_);

        emit RelayerAuthorizationSet(relayer_, true);
    }

    function setConsumer(address consumer_) external onlyOwner {
        if (consumer != address(0)) revert ConsumerAlreadySet();
        if (consumer_ == address(0) || consumer_.code.length == 0) revert ZeroAddress();
        consumer = consumer_;
        emit ConsumerSet(consumer_);
    }

    function setRelayer(address relayer, bool authorized) external onlyOwner {
        if (relayer == address(0)) revert ZeroAddress();
        isRelayer[relayer] = authorized;
        emit RelayerAuthorizationSet(relayer, authorized);
    }

    /// @notice Chainlink-compatible request selector used by the unmodified FWA core.
    function requestRandomWords(VRFV2PlusClient.RandomWordsRequest calldata req)
        external
        nonReentrant
        returns (uint256 requestId)
    {
        address configuredConsumer = consumer;
        if (msg.sender != configuredConsumer) revert OnlyConsumer();
        if (req.subId != SUBSCRIPTION_ID || req.numWords != 1 || req.keyHash == bytes32(0)) {
            revert InvalidRequest();
        }

        uint256 targetTimestamp = block.timestamp + MIN_ROUND_DELAY_SECONDS;
        uint64 targetRound = roundAtOrAfter(targetTimestamp);
        requestId = nextRequestId++;

        requests[requestId] = Request({
            consumer: configuredConsumer,
            targetRound: targetRound,
            requestedAtBlock: uint64(block.number),
            requestedAtTimestamp: uint64(block.timestamp),
            callbackGasLimit: req.callbackGasLimit,
            requestConfirmations: req.requestConfirmations,
            status: RequestStatus.Pending
        });
        pendingRequestCount += 1;
        requestCount += 1;

        emit RandomnessRequested(
            requestId, targetRound, configuredConsumer, req.requestConfirmations, req.callbackGasLimit
        );
    }

    /// @notice Delivers a public drand evmnet signature for the exact round locked at request time.
    /// @dev If the FWA callback reverts, this whole transaction rolls back and can be retried.
    function fulfillRandomness(uint256 requestId, uint64 round, bytes calldata signature) external nonReentrant {
        if (!isRelayer[msg.sender]) revert OnlyRelayer();
        if (signature.length != 64) revert InvalidSignatureLength();

        Request storage request = requests[requestId];
        if (request.status != RequestStatus.Pending) revert UnknownRequest();
        if (round != request.targetRound) revert WrongRound();
        if (block.timestamp < roundTimestamp(round)) revert RoundNotAvailable();

        bytes32 beaconRandomness = sha256(signature);
        uint256 derivedWord = uint256(
            keccak256(
                abi.encode(
                    DERIVATION_DOMAIN,
                    block.chainid,
                    address(this),
                    DRAND_CHAIN_HASH,
                    round,
                    requestId,
                    request.consumer,
                    beaconRandomness
                )
            )
        );

        request.status = RequestStatus.Fulfilled;
        fulfilledBeaconRandomness[requestId] = beaconRandomness;
        fulfilledWord[requestId] = derivedWord;
        pendingRequestCount -= 1;

        uint256[] memory words = new uint256[](1);
        words[0] = derivedWord;
        IDrandFWAConsumer(request.consumer).rawFulfillRandomWords(requestId, words);

        emit RandomnessFulfilled(requestId, round, msg.sender, beaconRandomness, derivedWord, signature);
    }

    function roundAtOrAfter(uint256 timestamp) public pure returns (uint64 round) {
        if (timestamp <= DRAND_GENESIS_TIME) return 1;
        uint256 elapsed = timestamp - DRAND_GENESIS_TIME;
        uint256 rawRound = ((elapsed + DRAND_PERIOD_SECONDS - 1) / DRAND_PERIOD_SECONDS) + 1;
        if (rawRound > type(uint64).max) revert InvalidRound();
        return uint64(rawRound);
    }

    function roundTimestamp(uint64 round) public pure returns (uint256) {
        if (round == 0) revert InvalidRound();
        return uint256(DRAND_GENESIS_TIME) + (uint256(round) - 1) * DRAND_PERIOD_SECONDS;
    }

    function requestState(uint256 requestId) external view returns (uint64 targetRound, RequestStatus status) {
        Request storage request = requests[requestId];
        return (request.targetRound, request.status);
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

    /// @notice Compatibility funding sink. No native currency is consumed by drand itself.
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
}
