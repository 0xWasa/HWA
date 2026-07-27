// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Ownable} from "solady/src/auth/Ownable.sol";
import {ReentrancyGuard} from "solady/src/utils/ReentrancyGuard.sol";
import {SafeTransferLib} from "solady/src/utils/SafeTransferLib.sol";
import {VRFV2PlusClient} from "@chainlink/contracts/src/v0.8/vrf/dev/libraries/VRFV2PlusClient.sol";

import {DrandEvmnetRegistry} from "./DrandEvmnetRegistry.sol";

interface IDrandBN254FWAConsumer {
    function rawFulfillRandomWords(uint256 requestId, uint256[] calldata randomWords) external;
}

/// @title DrandBN254Coordinator
/// @notice Chainlink-compatible coordinator backed by permissionlessly verified drand evmnet rounds.
/// @dev Transport is untrusted: any account or automation service can submit a signature, while the
///      pinned BN254 registry is the sole source of truth. Request expiry is permissionless and new
///      deployments accept a non-colliding starting request ID for safe coordinator rotation.
contract DrandBN254Coordinator is Ownable, ReentrancyGuard {
    uint256 public constant SUBSCRIPTION_ID = 1;
    bytes32 public constant DERIVATION_DOMAIN = keccak256("FWA_HYPEREVM_DRAND_BN254_V1");
    bytes32 public constant DRAND_CHAIN_HASH = 0x04f1e9062b8a81f848fded9c12306733282b2727ecced50032187751166ec8c3;
    uint64 public constant DRAND_GENESIS_TIME = 1_727_521_075;
    uint64 public constant DRAND_PERIOD_SECONDS = 3;
    /// @dev Mainnet safety margin between request creation and the selected drand round.
    ///      This is deliberately wider than one beacon period because HyperEVM does not
    ///      publish a bound on block.timestamp lag relative to wall-clock time.
    uint64 public constant MIN_DELAY_SECONDS = 30;
    uint64 public constant MAX_DELAY_SECONDS = 1 days;
    bytes4 public constant EXTRA_ARGS_V1_TAG = bytes4(keccak256("VRF ExtraArgsV1"));

    enum RequestStatus {
        None,
        Pending,
        Fulfilled,
        Expired
    }

    struct Request {
        address consumer;
        uint64 targetRound;
        uint64 requestedAtBlock;
        uint64 expiresAtBlock;
        uint32 callbackGasLimit;
        uint16 requestConfirmations;
        RequestStatus status;
    }

    DrandEvmnetRegistry public immutable REGISTRY;
    uint64 public immutable MIN_ROUND_DELAY_SECONDS;
    uint64 public immutable REQUEST_EXPIRY_BLOCKS;
    uint64 public immutable MAX_LIVENESS_AGE_SECONDS;
    uint256 public immutable START_REQUEST_ID;
    uint96 public immutable FULFILLMENT_BOUNTY_WEI;

    address public consumer;
    uint256 public nextRequestId;
    uint256 public pendingRequestCount;
    uint64 public requestCount;
    uint96 public nativeSubscriptionBalance;

    mapping(uint256 requestId => Request request) public requests;
    mapping(uint256 requestId => bytes32 beaconRandomness) public fulfilledBeaconRandomness;
    mapping(uint256 requestId => uint256 derivedWord) public fulfilledWord;

    event ConsumerSet(address indexed consumer);
    event RandomnessRequested(
        uint256 indexed requestId,
        uint64 indexed targetRound,
        address indexed consumer,
        uint64 expiresAtBlock,
        uint16 requestConfirmations,
        uint32 callbackGasLimit
    );
    event RandomnessFulfilled(
        uint256 indexed requestId,
        uint64 indexed round,
        address indexed submitter,
        bytes32 beaconRandomness,
        uint256 derivedWord
    );
    event RequestExpired(uint256 indexed requestId, uint64 indexed targetRound, address indexed caller);
    event SubscriptionFunded(uint256 indexed subId, address indexed funder, uint256 amount);
    event NativeWithdrawn(address indexed to, uint256 amount);
    event ForcedNativeSurplusWithdrawn(address indexed to, uint256 amount);
    event FulfillmentBountyPaid(uint256 indexed requestId, address indexed submitter, uint256 amount);

    error ZeroAddress();
    error ConsumerAlreadySet();
    error OnlyConsumer();
    error InvalidSubscription();
    error InvalidRequest();
    error InvalidDelay();
    error InvalidExpiry();
    error InvalidRound();
    error UnknownRequest();
    error WrongRound();
    error RoundNotAvailable();
    error TargetRoundAlreadyPublic();
    error ConfirmationsPending();
    error RequestNotExpired();
    error PendingRequests();
    error NativeBalanceOverflow();
    error InsufficientNativeBalance();
    error ConsumerCallbackFailed();

    constructor(
        address registry_,
        address owner_,
        uint64 minRoundDelaySeconds_,
        uint64 requestExpiryBlocks_,
        uint64 maxLivenessAgeSeconds_,
        uint96 fulfillmentBountyWei_
    ) {
        if (registry_ == address(0) || registry_.code.length == 0 || owner_ == address(0)) {
            revert ZeroAddress();
        }
        if (minRoundDelaySeconds_ < MIN_DELAY_SECONDS || minRoundDelaySeconds_ > MAX_DELAY_SECONDS) {
            revert InvalidDelay();
        }
        if (requestExpiryBlocks_ == 0 || maxLivenessAgeSeconds_ < DRAND_PERIOD_SECONDS) revert InvalidExpiry();

        REGISTRY = DrandEvmnetRegistry(registry_);
        MIN_ROUND_DELAY_SECONDS = minRoundDelaySeconds_;
        REQUEST_EXPIRY_BLOCKS = requestExpiryBlocks_;
        MAX_LIVENESS_AGE_SECONDS = maxLivenessAgeSeconds_;
        FULFILLMENT_BOUNTY_WEI = fulfillmentBountyWei_;
        // Coordinator rotations must never reuse IDs already consumed by FWA. Deriving the
        // namespace from this deployment removes the human/configuration foot-gun while keeping
        // the value deterministic and independently attestable.
        uint256 startRequestId_ =
            uint256(keccak256(abi.encode(DERIVATION_DOMAIN, block.chainid, address(this), registry_)));
        if (startRequestId_ == 0 || startRequestId_ == type(uint256).max) revert InvalidRequest();
        START_REQUEST_ID = startRequestId_;
        nextRequestId = startRequestId_;
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

        uint256 targetTimestamp = block.timestamp + MIN_ROUND_DELAY_SECONDS;
        uint64 targetRound = roundAtOrAfter(targetTimestamp);
        // A request is only unpredictable if its exact beacon round is still unavailable. This
        // makes the timestamp safety margin fail closed if chain time ever lags wall-clock time
        // far enough for submitters to have already proven the computed target round.
        if (targetRound <= REGISTRY.latestProvenRound() || REGISTRY.roundRandomness(targetRound) != bytes32(0)) {
            revert TargetRoundAlreadyPublic();
        }
        requestId = nextRequestId++;
        uint256 expiry = block.number + REQUEST_EXPIRY_BLOCKS;
        if (expiry > type(uint64).max) revert InvalidExpiry();

        requests[requestId] = Request({
            consumer: configuredConsumer,
            targetRound: targetRound,
            requestedAtBlock: uint64(block.number),
            expiresAtBlock: uint64(expiry),
            callbackGasLimit: req.callbackGasLimit,
            requestConfirmations: req.requestConfirmations,
            status: RequestStatus.Pending
        });
        pendingRequestCount += 1;
        requestCount += 1;

        emit RandomnessRequested(
            requestId, targetRound, configuredConsumer, uint64(expiry), req.requestConfirmations, req.callbackGasLimit
        );
    }

    /// @notice Permissionlessly proves the locked round and fulfills the exact pending request.
    /// @dev A failed consumer callback reverts this transaction and the registry proof, allowing retry.
    function fulfillRandomness(uint256 requestId, uint64 round, bytes calldata signature) external nonReentrant {
        Request storage request = requests[requestId];
        // Relayers deliver at least once. A duplicate successful delivery is a harmless no-op.
        if (request.status == RequestStatus.Fulfilled) return;
        if (request.status != RequestStatus.Pending) revert UnknownRequest();
        if (round != request.targetRound) revert WrongRound();
        if (block.number < uint256(request.requestedAtBlock) + request.requestConfirmations) {
            revert ConfirmationsPending();
        }
        if (block.timestamp < roundTimestamp(round)) revert RoundNotAvailable();

        bytes32 beaconRandomness = REGISTRY.roundRandomness(round);
        if (beaconRandomness == bytes32(0)) {
            beaconRandomness = REGISTRY.proveRound(signature, round);
        }

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
        (bool success,) = request.consumer.call{gas: request.callbackGasLimit}(
            abi.encodeCall(IDrandBN254FWAConsumer.rawFulfillRandomWords, (requestId, words))
        );
        if (!success) revert ConsumerCallbackFailed();

        uint256 bounty = FULFILLMENT_BOUNTY_WEI;
        uint256 reserve = nativeSubscriptionBalance;
        if (bounty > reserve) bounty = reserve;
        if (bounty != 0) {
            nativeSubscriptionBalance = uint96(reserve - bounty);
            SafeTransferLib.forceSafeTransferETH(msg.sender, bounty);
            emit FulfillmentBountyPaid(requestId, msg.sender, bounty);
        }

        emit RandomnessFulfilled(requestId, round, msg.sender, beaconRandomness, derivedWord);
    }

    /// @notice Terminal permissionless cleanup after the request's explicit liveness deadline.
    function expireRequest(uint256 requestId) external nonReentrant {
        Request storage request = requests[requestId];
        if (request.status != RequestStatus.Pending) revert UnknownRequest();
        if (block.number <= request.expiresAtBlock) revert RequestNotExpired();

        request.status = RequestStatus.Expired;
        pendingRequestCount -= 1;
        emit RequestExpired(requestId, request.targetRound, msg.sender);
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

    function requestState(uint256 requestId)
        external
        view
        returns (uint64 targetRound, uint64 expiresAtBlock, RequestStatus status)
    {
        Request storage request = requests[requestId];
        return (request.targetRound, request.expiresAtBlock, request.status);
    }

    /// @notice On-chain launch gate: a recent evmnet proof must already have succeeded on this chain.
    /// @dev FWA checks this selector whenever its one-way rewards-required launch latch is enabled.
    function launchReady() external view returns (bool) {
        uint64 latestRound = REGISTRY.latestProvenRound();
        if (latestRound == 0 || consumer == address(0) || pendingRequestCount != 0) return false;
        uint256 timestamp = roundTimestamp(latestRound);
        return timestamp <= block.timestamp && block.timestamp - timestamp <= MAX_LIVENESS_AGE_SECONDS
            && nativeSubscriptionBalance >= FULFILLMENT_BOUNTY_WEI;
    }

    function pendingRequestExists(uint256 subId) external view returns (bool) {
        if (subId != SUBSCRIPTION_ID) revert InvalidSubscription();
        return pendingRequestCount != 0;
    }

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

    /// @notice Compatibility reserve for the unmodified FWAVRFService.
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

    /// @notice Recover only native HYPE force-sent outside `fundSubscriptionWithNative`.
    /// @dev The accounted subscription reserve is never touched, including while requests exist.
    function withdrawForcedNativeSurplus(address to) external onlyOwner nonReentrant returns (uint256 amount) {
        if (to == address(0)) revert ZeroAddress();
        uint256 balance = address(this).balance;
        uint256 reserve = nativeSubscriptionBalance;
        if (balance <= reserve) revert InsufficientNativeBalance();
        amount = balance - reserve;
        SafeTransferLib.forceSafeTransferETH(to, amount);
        emit ForcedNativeSurplusWithdrawn(to, amount);
    }

    function _nativePaymentExtraArgs() internal pure returns (bytes memory) {
        return abi.encodeWithSelector(EXTRA_ARGS_V1_TAG, VRFV2PlusClient.ExtraArgsV1({nativePayment: true}));
    }
}
