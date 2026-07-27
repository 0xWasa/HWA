// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "solady/src/auth/Ownable.sol";
import {FixedPointMathLib} from "solady/src/utils/FixedPointMathLib.sol";
import {ReentrancyGuard} from "solady/src/utils/ReentrancyGuard.sol";
import {SafeTransferLib} from "solady/src/utils/SafeTransferLib.sol";

import {IVRFCoordinatorV2Plus} from "@chainlink/contracts/src/v0.8/vrf/dev/interfaces/IVRFCoordinatorV2Plus.sol";

/// @notice The narrow FWA surface needed by the external VRF funding and processing service.
interface IFWAVRFServiceHost {
    function processAcquisitions(uint256 maxCount) external returns (uint256 processed);
    function unfulfilledVrfCount() external view returns (uint256);
    function vrfCoordinatorAndSubId() external view returns (address coordinator, uint256 subId);
    function vrfRequestConfig() external view returns (bytes32 keyHash, uint32 callbackGasLimit);
    function configureVrfRequest(bytes32 keyHash, uint32 callbackGasLimit) external;
    function vrfService() external view returns (address);
}

/// @title FWAVRFService
/// @notice Holds purchaser-paid VRF service fees, keeps the native VRF subscription funded, and uses
///         only callback-safe surplus to reimburse owner-approved acquisition processors.
/// @dev FWA itself remains the VRF consumer and its `processAcquisitions` function remains directly
///      permissionless. This contract is only the optional sponsored route. The configured subscription
///      must be dedicated to FWA: another consumer could spend its balance outside this accounting.
contract FWAVRFService is Ownable, ReentrancyGuard {
    uint256 public constant BPS = 10_000;

    /// @notice The only FWA whose request fees and processing this service may handle. Bound once.
    IFWAVRFServiceHost public fwa;

    /// @notice Addresses allowed to use the reimbursed processing route. Direct FWA processing is public.
    mapping(address operator => bool allowed) public operators;

    /*//////////////////////////////////////////////////////////////
                              REQUEST PRICING
    //////////////////////////////////////////////////////////////*/

    /// @notice Expected billed gas used to quote one purchaser's VRF service fee.
    uint256 public serviceGasEstimate = 800_000;
    /// @notice Margin over expected gas cost, covering the native-payment premium and variance.
    uint256 public serviceMarginBps = 3_000;
    /// @notice Flat wei added to every request fee.
    uint256 public serviceFlatWei;

    /*//////////////////////////////////////////////////////////////
                            CALLBACK COVERAGE
    //////////////////////////////////////////////////////////////*/

    /// @notice Subscription balance retained independently of the number of outstanding callbacks.
    uint256 public minimumSubscriptionBuffer;
    /// @notice Conservative maximum native charge reserved for each callback not yet observed by FWA.
    uint256 public maxFulfillmentCostWei;

    /// @notice VRF request tuple approved together with its per-callback coverage floor.
    bytes32 public approvedVrfKeyHash;
    uint32 public approvedCallbackGasLimit;
    uint256 public requestConfigCoverageFloor;

    /*//////////////////////////////////////////////////////////////
                         PROCESSOR REIMBURSEMENT
    //////////////////////////////////////////////////////////////*/

    uint256 public maxSponsoredCount = 10;
    uint256 public maxReimbursementGas = 2_100_000;
    uint256 public reimbursementGasOverhead = 55_000;
    uint256 public maxReimbursementBaseFeeWei = 5 gwei;
    uint256 public maxReimbursementPriorityFeeWei = 1 gwei;
    uint256 public maxReimbursementWei = 0.02 ether;

    /*//////////////////////////////////////////////////////////////
                                  EVENTS
    //////////////////////////////////////////////////////////////*/

    event FWASet(address indexed fwa);
    event OperatorSet(address indexed operator, bool allowed);
    event FeeConfigSet(uint256 gasEstimate, uint256 marginBps, uint256 flatWei);
    event CoverageConfigSet(uint256 minimumSubscriptionBuffer, uint256 maxFulfillmentCostWei);
    event VrfRequestConfigSet(
        bytes32 indexed keyHash,
        uint32 callbackGasLimit,
        uint256 minimumSubscriptionBuffer,
        uint256 maxFulfillmentCostWei
    );
    event ReimbursementConfigSet(
        uint256 maxSponsoredCount,
        uint256 maxReimbursementGas,
        uint256 reimbursementGasOverhead,
        uint256 maxReimbursementBaseFeeWei,
        uint256 maxReimbursementPriorityFeeWei,
        uint256 maxReimbursementWei
    );
    event RequestFeesReceived(uint256 requestCount, uint256 amount);
    event SubscriptionFunded(uint256 indexed subId, uint256 amount, uint256 requiredBalance);
    event AcquisitionsSponsored(
        address indexed operator,
        uint256 processed,
        uint256 reimbursableGas,
        uint256 reimbursableGasPrice,
        uint256 reimbursement
    );
    event SurplusWithdrawn(address indexed to, uint256 amount);
    event TreasuryFunded(address indexed from, uint256 amount);

    /*//////////////////////////////////////////////////////////////
                                  ERRORS
    //////////////////////////////////////////////////////////////*/

    error ZeroAddress();
    error InvalidConfig();
    error OnlyFWA();
    error OnlyOperator();
    error FWAAlreadySet();
    error FWAConfigMismatch();
    error IncorrectRequestFee();
    error InsufficientVrfCoverage();
    error NoProcessorSurplus();
    error InsufficientProcessorSurplus();
    error OutstandingCallbacks();
    error UnapprovedVrfRequestConfig();

    constructor(uint256 minimumSubscriptionBuffer_, uint256 maxFulfillmentCostWei_) {
        if (minimumSubscriptionBuffer_ == 0 || maxFulfillmentCostWei_ == 0) revert InvalidConfig();
        _initializeOwner(msg.sender);

        minimumSubscriptionBuffer = minimumSubscriptionBuffer_;
        maxFulfillmentCostWei = maxFulfillmentCostWei_;
        operators[msg.sender] = true;

        emit OperatorSet(msg.sender, true);
        emit FeeConfigSet(serviceGasEstimate, serviceMarginBps, serviceFlatWei);
        emit CoverageConfigSet(minimumSubscriptionBuffer_, maxFulfillmentCostWei_);
        emit ReimbursementConfigSet(
            maxSponsoredCount,
            maxReimbursementGas,
            reimbursementGasOverhead,
            maxReimbursementBaseFeeWei,
            maxReimbursementPriorityFeeWei,
            maxReimbursementWei
        );
    }

    modifier onlyFWA() {
        if (msg.sender != address(fwa)) revert OnlyFWA();
        _;
    }

    modifier onlyOperator() {
        if (!operators[msg.sender]) revert OnlyOperator();
        _;
    }

    receive() external payable {
        emit TreasuryFunded(msg.sender, msg.value);
    }

    /*//////////////////////////////////////////////////////////////
                                CORE WIRING
    //////////////////////////////////////////////////////////////*/

    /// @notice Bind the service to its FWA exactly once. FWA must already point back to this service.
    function setFWA(address fwa_) external onlyOwner {
        if (address(fwa) != address(0)) revert FWAAlreadySet();
        if (fwa_ == address(0) || fwa_.code.length == 0) revert ZeroAddress();

        IFWAVRFServiceHost candidate = IFWAVRFServiceHost(fwa_);
        if (candidate.vrfService() != address(this)) revert FWAConfigMismatch();
        (bytes32 keyHash, uint32 callbackGasLimit) = candidate.vrfRequestConfig();
        if (keyHash == bytes32(0) || callbackGasLimit == 0) revert FWAConfigMismatch();
        fwa = candidate;
        approvedVrfKeyHash = keyHash;
        approvedCallbackGasLimit = callbackGasLimit;
        requestConfigCoverageFloor = maxFulfillmentCostWei;
        emit FWASet(fwa_);
        emit VrfRequestConfigSet(keyHash, callbackGasLimit, minimumSubscriptionBuffer, maxFulfillmentCostWei);
    }

    function setOperator(address operator, bool allowed) external onlyOwner {
        if (operator == address(0)) revert ZeroAddress();
        operators[operator] = allowed;
        emit OperatorSet(operator, allowed);
    }

    /*//////////////////////////////////////////////////////////////
                              FEE + COVERAGE
    //////////////////////////////////////////////////////////////*/

    /// @notice Purchaser charge for one request at the transaction gas price.
    /// @dev Callers quoting through `eth_call` should supply the gas price intended for the acquisition.
    function requestFee() public view returns (uint256) {
        return serviceGasEstimate * tx.gasprice * (BPS + serviceMarginBps) / BPS + serviceFlatWei;
    }

    /// @notice Receive exact purchaser fees and pre-fund coverage for requests FWA is about to issue.
    /// @dev Called before `requestRandomWords`. Any later revert rolls this funding back atomically.
    function prepareRequests(uint256 requestCount) external payable onlyFWA nonReentrant {
        if (requestCount == 0) revert InvalidConfig();
        if (msg.value != requestFee() * requestCount) revert IncorrectRequestFee();
        (bytes32 keyHash, uint32 callbackGasLimit) = fwa.vrfRequestConfig();
        if (keyHash != approvedVrfKeyHash || callbackGasLimit != approvedCallbackGasLimit) {
            revert UnapprovedVrfRequestConfig();
        }

        emit RequestFeesReceived(requestCount, msg.value);
        _ensureSubscriptionCoverage(requestCount);
    }

    /// @notice Required native subscription balance for current callbacks plus `additionalRequests`.
    function requiredSubscriptionBalance(uint256 additionalRequests) public view returns (uint256) {
        IFWAVRFServiceHost host = fwa;
        if (address(host) == address(0)) revert FWAConfigMismatch();
        return minimumSubscriptionBuffer + (host.unfulfilledVrfCount() + additionalRequests) * maxFulfillmentCostWei;
    }

    /// @notice Current native balance of FWA's configured VRF subscription.
    function subscriptionNativeBalance() public view returns (uint256 nativeBalance) {
        (address coordinator, uint256 subId) = _vrfConfig();
        (, uint96 balance,,,) = IVRFCoordinatorV2Plus(coordinator).getSubscription(subId);
        nativeBalance = balance;
    }

    /// @notice Liquid ETH that can be spent without reducing callback coverage.
    /// @dev A subscription shortfall reserves contract-held ETH first; only the remainder is surplus.
    function availableProcessorSurplus() public view returns (uint256 available) {
        uint256 liquid = address(this).balance;
        uint256 required = requiredSubscriptionBalance(0);
        if (required == 0) return liquid;

        uint256 subscriptionBalance = subscriptionNativeBalance();
        if (subscriptionBalance >= required) return liquid;

        uint256 shortfall = required - subscriptionBalance;
        if (liquid > shortfall) available = liquid - shortfall;
    }

    /// @notice Permissionlessly move enough liquid ETH to the subscription to restore current coverage.
    function topUpSubscription() external nonReentrant returns (uint256 amount) {
        amount = _ensureSubscriptionCoverage(0);
    }

    function _ensureSubscriptionCoverage(uint256 additionalRequests) internal returns (uint256 amount) {
        uint256 required = requiredSubscriptionBalance(additionalRequests);
        if (required == 0) return 0;

        uint256 current = subscriptionNativeBalance();
        if (current >= required) return 0;

        amount = required - current;
        if (amount > address(this).balance) revert InsufficientVrfCoverage();

        (address coordinator, uint256 subId) = _vrfConfig();
        IVRFCoordinatorV2Plus(coordinator).fundSubscriptionWithNative{value: amount}(subId);
        emit SubscriptionFunded(subId, amount, required);
    }

    function _vrfConfig() internal view returns (address coordinator, uint256 subId) {
        IFWAVRFServiceHost host = fwa;
        if (address(host) == address(0)) revert FWAConfigMismatch();
        (coordinator, subId) = host.vrfCoordinatorAndSubId();
        if (coordinator == address(0) || subId == 0) revert FWAConfigMismatch();
    }

    /*//////////////////////////////////////////////////////////////
                         SPONSORED PROCESSING
    //////////////////////////////////////////////////////////////*/

    /// @notice Process FWA's canonical prefix and directly reimburse an approved operator from safe surplus.
    /// @dev `gasleft` measures gross execution gas and excludes intrinsic/post-measurement gas; the configured
    ///      overhead and hard caps intentionally make this a bounded subsidy rather than exact receipt matching.
    ///      A reverting operator recipient rolls back only this sponsored transaction. Anyone can retry through
    ///      FWA's underlying permissionless processor without using this contract.
    function processAcquisitions(uint256 maxCount)
        external
        nonReentrant
        onlyOperator
        returns (uint256 processed, uint256 reimbursement)
    {
        if (maxCount == 0 || maxCount > maxSponsoredCount) revert InvalidConfig();
        uint256 gasStart = gasleft();

        // Chainlink can bill only subscription-held ETH. Restore the coordinator-side reserve before
        // classifying or paying any liquid ETH as processor surplus.
        _ensureSubscriptionCoverage(0);
        uint256 available = availableProcessorSurplus();
        if (available == 0) revert NoProcessorSurplus();

        processed = fwa.processAcquisitions(maxCount);
        if (processed == 0) {
            emit AcquisitionsSponsored(msg.sender, 0, 0, 0, 0);
            return (0, 0);
        }

        uint256 gasUnits = gasStart - gasleft() + reimbursementGasOverhead;
        if (gasUnits > maxReimbursementGas) gasUnits = maxReimbursementGas;

        uint256 baseFee = block.basefee;
        if (baseFee > maxReimbursementBaseFeeWei) baseFee = maxReimbursementBaseFeeWei;
        uint256 gasPriceCap = baseFee + maxReimbursementPriorityFeeWei;
        uint256 reimbursableGasPrice = tx.gasprice;
        if (reimbursableGasPrice > gasPriceCap) reimbursableGasPrice = gasPriceCap;

        reimbursement = gasUnits * reimbursableGasPrice;
        if (reimbursement > maxReimbursementWei) reimbursement = maxReimbursementWei;

        // Re-fund and re-read at the exact point of payment. Core processing does not spend this service's
        // funds, but keeping the invariant local makes future FWA changes fail closed.
        _ensureSubscriptionCoverage(0);
        available = availableProcessorSurplus();
        if (reimbursement > available) reimbursement = available;
        if (reimbursement != 0) SafeTransferLib.safeTransferETH(msg.sender, reimbursement);

        emit AcquisitionsSponsored(msg.sender, processed, gasUnits, reimbursableGasPrice, reimbursement);
    }

    /*//////////////////////////////////////////////////////////////
                              OWNER CONFIG
    //////////////////////////////////////////////////////////////*/

    function setFeeConfig(uint256 gasEstimate, uint256 marginBps, uint256 flatWei) external onlyOwner {
        if (gasEstimate == 0) revert InvalidConfig();
        serviceGasEstimate = gasEstimate;
        serviceMarginBps = marginBps;
        serviceFlatWei = flatWei;
        emit FeeConfigSet(gasEstimate, marginBps, flatWei);
    }

    /// @notice Increase coverage at any time (and fund it atomically); decrease it only after every
    ///         issued request called back and never below the floor approved for the current request tuple.
    function setCoverageConfig(uint256 minimumBuffer, uint256 maxFulfillmentCost) external onlyOwner nonReentrant {
        if (maxFulfillmentCost < requestConfigCoverageFloor) revert InvalidConfig();
        _setCoverageConfig(minimumBuffer, maxFulfillmentCost);
        _ensureSubscriptionCoverage(0);
    }

    /// @notice Atomically update FWA's gas lane/callback limit and the callback coverage underwriting it.
    /// @dev FWA accepts this call only while acquisitions are paused and no acquisition or VRF callback is
    ///      outstanding. A gas-limit increase must scale the old ceiling at least linearly; a lane change
    ///      may not reduce it. The owner must still choose a ceiling appropriate for the new lane's maximum
    ///      gas price and Chainlink premium because those coordinator parameters are not exposed here.
    function setVrfRequestConfig(
        bytes32 keyHash,
        uint32 callbackGasLimit,
        uint256 minimumBuffer,
        uint256 maxFulfillmentCost
    ) external onlyOwner nonReentrant {
        IFWAVRFServiceHost host = fwa;
        if (address(host) == address(0) || keyHash == bytes32(0) || callbackGasLimit == 0) revert InvalidConfig();

        uint256 currentMaximum = maxFulfillmentCostWei;
        bytes32 currentKeyHash = approvedVrfKeyHash;
        uint32 currentGasLimit = approvedCallbackGasLimit;
        if (keyHash != currentKeyHash && maxFulfillmentCost < currentMaximum) revert InvalidConfig();
        if (
            callbackGasLimit > currentGasLimit
                && maxFulfillmentCost < FixedPointMathLib.fullMulDivUp(currentMaximum, callbackGasLimit, currentGasLimit)
        ) revert InvalidConfig();

        _setCoverageConfig(minimumBuffer, maxFulfillmentCost);
        approvedVrfKeyHash = keyHash;
        approvedCallbackGasLimit = callbackGasLimit;
        requestConfigCoverageFloor = maxFulfillmentCost;
        _ensureSubscriptionCoverage(0);
        host.configureVrfRequest(keyHash, callbackGasLimit);

        emit VrfRequestConfigSet(keyHash, callbackGasLimit, minimumBuffer, maxFulfillmentCost);
    }

    function _setCoverageConfig(uint256 minimumBuffer, uint256 maxFulfillmentCost) internal {
        if (minimumBuffer == 0 || maxFulfillmentCost == 0) revert InvalidConfig();
        IFWAVRFServiceHost host = fwa;
        if (
            address(host) != address(0) && host.unfulfilledVrfCount() != 0
                && (minimumBuffer < minimumSubscriptionBuffer || maxFulfillmentCost < maxFulfillmentCostWei)
        ) revert OutstandingCallbacks();
        minimumSubscriptionBuffer = minimumBuffer;
        maxFulfillmentCostWei = maxFulfillmentCost;
        emit CoverageConfigSet(minimumBuffer, maxFulfillmentCost);
    }

    function setReimbursementConfig(
        uint256 sponsoredCount,
        uint256 reimbursementGas,
        uint256 gasOverhead,
        uint256 maxBaseFeeWei,
        uint256 maxPriorityFeeWei,
        uint256 reimbursementWei
    ) external onlyOwner {
        if (sponsoredCount == 0 || reimbursementGas == 0 || maxBaseFeeWei == 0 || reimbursementWei == 0) {
            revert InvalidConfig();
        }
        maxSponsoredCount = sponsoredCount;
        maxReimbursementGas = reimbursementGas;
        reimbursementGasOverhead = gasOverhead;
        maxReimbursementBaseFeeWei = maxBaseFeeWei;
        maxReimbursementPriorityFeeWei = maxPriorityFeeWei;
        maxReimbursementWei = reimbursementWei;
        emit ReimbursementConfigSet(
            sponsoredCount, reimbursementGas, gasOverhead, maxBaseFeeWei, maxPriorityFeeWei, reimbursementWei
        );
    }

    /// @notice Withdraw only ETH already classified as callback-safe surplus.
    function withdrawSurplus(address to, uint256 amount) external onlyOwner nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        _ensureSubscriptionCoverage(0);
        if (amount > availableProcessorSurplus()) revert InsufficientProcessorSurplus();
        SafeTransferLib.safeTransferETH(to, amount);
        emit SurplusWithdrawn(to, amount);
    }
}
